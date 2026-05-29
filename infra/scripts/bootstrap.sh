#!/usr/bin/env bash
# First-time setup on a fresh VPS. Idempotent: re-runs only fill missing pieces.
# Run as deploy user from repo root: sudo -u deploy bash infra/scripts/bootstrap.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/infra/.env"
ENV_EXAMPLE="$REPO_ROOT/infra/.env.example"
KONG_TEMPLATE="$REPO_ROOT/infra/volumes/api/kong.yml.template"
KONG_FILE="$REPO_ROOT/infra/volumes/api/kong.yml"
COMPOSE="docker compose -f $REPO_ROOT/infra/docker-compose.yml --env-file $ENV_FILE"

log() { echo -e "\033[1;34m[bootstrap]\033[0m $*"; }
die() { echo -e "\033[1;31m[bootstrap]\033[0m $*" >&2; exit 1; }

command -v docker >/dev/null || die "docker not installed — run cloud-init first"
command -v python3 >/dev/null || die "python3 missing"

rand() { openssl rand -hex "$1"; }

# Sign HS256 JWT with payload {role, iss, iat, exp}.
sign_jwt() {
  local secret="$1" role="$2"
  python3 - "$secret" "$role" <<'PY'
import base64, hmac, hashlib, json, sys, time
secret, role = sys.argv[1], sys.argv[2]
def b64(d): return base64.urlsafe_b64encode(d).rstrip(b'=').decode()
header = b64(json.dumps({"alg":"HS256","typ":"JWT"}, separators=(',',':')).encode())
payload = b64(json.dumps({
  "role": role,
  "iss": "supabase",
  "iat": int(time.time()),
  "exp": int(time.time()) + 10*365*24*3600,
}, separators=(',',':')).encode())
msg = f"{header}.{payload}".encode()
sig = b64(hmac.new(secret.encode(), msg, hashlib.sha256).digest())
print(f"{msg.decode()}.{sig}")
PY
}

# ─── 1. .env ──────────────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  log "generating infra/.env"
  cp "$ENV_EXAMPLE" "$ENV_FILE"

  POSTGRES_PASSWORD="$(rand 24)"
  JWT_SECRET="$(rand 32)"
  SECRET_KEY_BASE="$(rand 32)"
  ANON_KEY="$(sign_jwt "$JWT_SECRET" anon)"
  SERVICE_ROLE_KEY="$(sign_jwt "$JWT_SECRET" service_role)"
  S3_PROTOCOL_ACCESS_KEY_ID="$(rand 16)"
  S3_PROTOCOL_ACCESS_KEY_SECRET="$(rand 32)"

  # VAPID
  VAPID_JSON="$(docker run --rm node:22-alpine sh -c "npm i -g web-push >/dev/null 2>&1 && web-push generate-vapid-keys --json")"
  VAPID_PUBLIC_KEY="$(echo "$VAPID_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["publicKey"])')"
  VAPID_PRIVATE_KEY="$(echo "$VAPID_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["privateKey"])')"

  sed -i \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_PASSWORD|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" \
    -e "s|^SECRET_KEY_BASE=.*|SECRET_KEY_BASE=$SECRET_KEY_BASE|" \
    -e "s|^ANON_KEY=.*|ANON_KEY=$ANON_KEY|" \
    -e "s|^SERVICE_ROLE_KEY=.*|SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY|" \
    -e "s|^S3_PROTOCOL_ACCESS_KEY_ID=.*|S3_PROTOCOL_ACCESS_KEY_ID=$S3_PROTOCOL_ACCESS_KEY_ID|" \
    -e "s|^S3_PROTOCOL_ACCESS_KEY_SECRET=.*|S3_PROTOCOL_ACCESS_KEY_SECRET=$S3_PROTOCOL_ACCESS_KEY_SECRET|" \
    -e "s|^VAPID_PUBLIC_KEY=.*|VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY|" \
    -e "s|^VAPID_PRIVATE_KEY=.*|VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY|" \
    "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  log "infra/.env exists — keeping current secrets"
fi

set -a; source "$ENV_FILE"; set +a

# ─── 2. Kong config ──────────────────────────────────────────────────────────
log "rendering kong.yml"
sed -e "s|__ANON_KEY__|$ANON_KEY|g" \
    -e "s|__SERVICE_ROLE_KEY__|$SERVICE_ROLE_KEY|g" \
    "$KONG_TEMPLATE" > "$KONG_FILE"

# ─── 3. Pull images ──────────────────────────────────────────────────────────
log "pulling images"
$COMPOSE pull --quiet db kong auth rest realtime storage functions caddy || true

# ─── 4. Start DB, wait healthy, apply migrations ─────────────────────────────
log "starting db"
$COMPOSE up -d db

log "waiting for db healthy"
for i in {1..60}; do
  if $COMPOSE exec -T db pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 2
  [[ $i -eq 60 ]] && die "db did not become healthy"
done

# Подключаемся как supabase_admin — у postgres-юзера в supabase/postgres-образе нет прав
# на reserved-роли. Пароль supabase_admin образ ставит сам из POSTGRES_PASSWORD при initdb.
PSQL="$COMPOSE exec -T -e PGPASSWORD=$POSTGRES_PASSWORD db psql -U supabase_admin -d postgres"

# Defensive password re-sync. На первом init роли уже синхронизированы volumes/db/roles.sql
# + jwt.sql. На re-bootstrap (data volume уже создан) init-scripts не запускаются — здесь
# догоняем. supabase_admin не трогаем — он reserved и пароль уже выставлен entrypoint'ом.
log "syncing role passwords (defensive)"
$PSQL -v ON_ERROR_STOP=1 <<SQL
ALTER USER supabase_auth_admin WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER USER supabase_storage_admin WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER USER supabase_functions_admin WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER USER authenticator WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER USER pgbouncer WITH PASSWORD '$POSTGRES_PASSWORD';
ALTER DATABASE postgres SET "app.settings.jwt_secret" TO '$JWT_SECRET';
ALTER DATABASE postgres SET "app.settings.jwt_exp" TO '$JWT_EXPIRY';
SQL

# Сначала поднимаем backend-сервисы (auth/rest/realtime/storage/functions) — каждый
# мигрирует свою схему (storage добавляет колонки в storage.buckets, gotrue —
# auth.users и пр.). Только потом применяем наши миграции, которые от них зависят.
log "starting backend services for self-migration"
$COMPOSE up -d auth rest realtime storage functions

log "waiting for storage schema migration (storage.buckets.public column)"
for i in {1..60}; do
  has_col="$($PSQL -tA -c "SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='buckets' AND column_name='public'" 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ "$has_col" == "1" ]]; then
    break
  fi
  sleep 2
  [[ $i -eq 60 ]] && die "storage migration didn't complete in 120s — check 'docker compose logs storage'"
done

# Migrations tracker
$PSQL -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS public._migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

log "applying app migrations"
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  applied="$($PSQL -tA -c "SELECT 1 FROM public._migrations WHERE name='$name'" || true)"
  if [[ -z "$applied" ]]; then
    log "  → $name"
    $PSQL -v ON_ERROR_STOP=1 < "$f"
    $PSQL -c "INSERT INTO public._migrations(name) VALUES ('$name')"
  fi
done

# ─── 5. Start gateway ────────────────────────────────────────────────────────
log "starting gateway (kong)"
$COMPOSE up -d kong

# ─── 6. Build and start nextjs ───────────────────────────────────────────────
# Сборка локально на VPS — занимает ~2-3 минуты, нужен ~1.5-2 GB RAM (Postgres
# крутится, поможет swap из cloud-init). NEXT_PUBLIC_* инлайнятся в bundle через
# build-args, source — текущий клон репо.
log "building nextjs image (≈2-3 min, eats ~1.5 GB RAM)"
$COMPOSE build nextjs

log "starting nextjs"
$COMPOSE up -d nextjs

# ─── 7. First admin ──────────────────────────────────────────────────────────
# Делаем здесь, а не в SQL-миграции: GoTrue владеет auth.users и его схема
# меняется между релизами — безопаснее ходить через POST /auth/admin/users.
if [[ -n "${ADMIN_EMAIL:-}" && -n "${ADMIN_DISPLAY_NAME:-}" ]]; then
  log "ensuring first admin"
  bash "$REPO_ROOT/infra/scripts/create-admin.sh"
else
  log "ADMIN_EMAIL или ADMIN_DISPLAY_NAME пуст в infra/.env — пропустил создание админа."
  log "  Заполни их и запусти отдельно: bash infra/scripts/create-admin.sh"
fi

# ─── 8. Done ─────────────────────────────────────────────────────────────────
cat <<EOF

\033[1;32m[bootstrap] DONE\033[0m

Backend, gateway и Next.js подняты. Caddy НЕ запущен — его поднять отдельно когда
DNS пропагируется:

  docker compose -f infra/docker-compose.yml --env-file infra/.env up -d caddy

Дальнейшие деплои — git pull на VPS + bash infra/scripts/deploy.sh.
EOF
