#!/usr/bin/env bash
# Create-or-update the first admin on a self-hosted Supabase stack.
# Idempotent:
#   - юзер ещё не создан       → POST /admin/users + INSERT profiles
#   - юзер уже есть            → PUT  /admin/users/{id} (сбросить пароль)
#                                + UPSERT profiles (is_admin=true)
# Если ADMIN_PASSWORD пустой — сгенерит случайный, впишет обратно в infra/.env
# и напечатает в конце.
#
# Запуск:
#   bash infra/scripts/create-admin.sh
#
# Требования: docker compose-стек поднят (bootstrap.sh уже отработал), curl+jq+openssl на хосте.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/infra/.env"
COMPOSE="docker compose -f $REPO_ROOT/infra/docker-compose.yml --env-file $ENV_FILE"
NET="ai-cms_internal"
CURL_IMAGE="curlimages/curl:8.10.1"

log() { echo -e "\033[1;34m[create-admin]\033[0m $*"; }
die() { echo -e "\033[1;31m[create-admin]\033[0m $*" >&2; exit 1; }

[[ -f "$ENV_FILE" ]] || die "$ENV_FILE не найден — сначала запусти infra/scripts/bootstrap.sh"
set -a; source "$ENV_FILE"; set +a

: "${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY пуст — bootstrap не доработал}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD пуст}"

if [[ -z "${ADMIN_EMAIL:-}" ]]; then
  die "ADMIN_EMAIL не задан в infra/.env. Открой файл, заполни ADMIN_EMAIL/ADMIN_DISPLAY_NAME и перезапусти."
fi
if [[ -z "${ADMIN_DISPLAY_NAME:-}" ]]; then
  die "ADMIN_DISPLAY_NAME не задан в infra/.env."
fi

# Сгенерим пароль, если пустой, и допишем обратно в .env.
PASSWORD_GENERATED=0
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  ADMIN_PASSWORD="$(openssl rand -hex 12)"
  PASSWORD_GENERATED=1
  # Заменяем строку ADMIN_PASSWORD= в infra/.env, если она есть; иначе дописываем.
  if grep -q '^ADMIN_PASSWORD=' "$ENV_FILE"; then
    sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$ADMIN_PASSWORD|" "$ENV_FILE"
  else
    printf '\nADMIN_PASSWORD=%s\n' "$ADMIN_PASSWORD" >> "$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"
  log "ADMIN_PASSWORD сгенерён и записан в infra/.env"
fi
ADMIN_PHONE="${ADMIN_PHONE:-—}"

# Helpers ---------------------------------------------------------------------
PSQL=( $COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD"
       db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -tA )

# Одноразовый curl-контейнер на внутренней сети — единственный способ достучаться
# до GoTrue (auth:9999) без зависимости от Caddy/DNS.
curl_internal() {
  docker run --rm --network "$NET" "$CURL_IMAGE" "$@"
}

# 1. Дождаться auth healthy ---------------------------------------------------
log "waiting for auth (GoTrue) на http://auth:9999/health"
for i in {1..30}; do
  if curl_internal -fsS -o /dev/null --max-time 2 "http://auth:9999/health" 2>/dev/null; then
    break
  fi
  sleep 2
  [[ $i -eq 30 ]] && die "auth не отвечает на /health за 60s — проверь 'docker compose logs auth'"
done

# 2. Гарантировать наличие plot (profiles.plot_id NOT NULL) -------------------
PLOT_ID="$("${PSQL[@]}" -c "SELECT id FROM public.plots ORDER BY sort_order, label LIMIT 1" | tr -d '[:space:]')"
if [[ -z "$PLOT_ID" ]]; then
  log "public.plots пуст → вставляю заглушку '?' (поменяешь в /admin/plot-editor)"
  PLOT_ID="$("${PSQL[@]}" -c "INSERT INTO public.plots(label,address,polygon,sort_order) VALUES('?','—','[]'::jsonb,0) RETURNING id" | tr -d '[:space:]')"
fi
log "plot_id=$PLOT_ID"

# 3. POST /admin/users --------------------------------------------------------
CREATE_BODY="$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" \
  '{email:$e, password:$p, email_confirm:true}')"

RESP="$(curl_internal -sS -X POST "http://auth:9999/admin/users" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "$CREATE_BODY" \
  -w '\n%{http_code}')"
HTTP_CODE="$(printf '%s' "$RESP" | tail -n1)"
BODY="$(printf '%s' "$RESP" | sed '$d')"

USER_ID=""
PASSWORD_RESET=0
case "$HTTP_CODE" in
  200|201)
    USER_ID="$(printf '%s' "$BODY" | jq -r '.id // empty')"
    [[ -z "$USER_ID" ]] && die "auth не вернул id; ответ: $BODY"
    log "auth user СОЗДАН: $USER_ID"
    ;;
  422)
    if [[ "$BODY" == *email_exists* || "$BODY" == *already*registered* || "$BODY" == *email_address_taken* ]]; then
      USER_ID="$("${PSQL[@]}" -v email="$ADMIN_EMAIL" -c "SELECT id FROM auth.users WHERE email = :'email'" | tr -d '[:space:]')"
      [[ -z "$USER_ID" ]] && die "auth ответил 422 «уже существует», но в auth.users $ADMIN_EMAIL нет; тело: $BODY"
      log "auth user уже был: $USER_ID — обновляю пароль"
      UPDATE_BODY="$(jq -nc --arg p "$ADMIN_PASSWORD" '{password:$p}')"
      RESP2="$(curl_internal -sS -X PUT "http://auth:9999/admin/users/$USER_ID" \
        -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
        -H "Content-Type: application/json" \
        -d "$UPDATE_BODY" \
        -w '\n%{http_code}')"
      HC2="$(printf '%s' "$RESP2" | tail -n1)"
      BODY2="$(printf '%s' "$RESP2" | sed '$d')"
      [[ "$HC2" != "200" ]] && die "PUT /admin/users/$USER_ID → HTTP $HC2: $BODY2"
      PASSWORD_RESET=1
    else
      die "GoTrue admin API вернул 422, но это не email_exists: $BODY"
    fi
    ;;
  *)
    die "GoTrue admin API вернул HTTP $HTTP_CODE: $BODY"
    ;;
esac

# 4. Upsert profiles (is_admin=true) -----------------------------------------
"${PSQL[@]}" \
  -v userid="$USER_ID" \
  -v display="$ADMIN_DISPLAY_NAME" \
  -v plotid="$PLOT_ID" \
  -v phone="$ADMIN_PHONE" \
  -v email="$ADMIN_EMAIL" \
  <<'SQL'
INSERT INTO public.profiles (id, display_name, plot_id, phone, email_public, is_admin, is_banned)
VALUES (:'userid', :'display', :'plotid', :'phone', :'email', true, false)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  email_public = EXCLUDED.email_public,
  is_admin     = true,
  is_banned    = false;
SQL
log "profiles upserted, is_admin=true"

# 5. Summary ------------------------------------------------------------------
echo
echo "================ ADMIN READY ================"
echo "  email:    $ADMIN_EMAIL"
if (( PASSWORD_GENERATED )); then
  echo "  password: $ADMIN_PASSWORD   ← СГЕНЕРЁН, лежит в infra/.env"
elif (( PASSWORD_RESET )); then
  echo "  password: (из infra/.env, ТОЛЬКО ЧТО СБРОШЕН)"
else
  echo "  password: (из infra/.env, не менялся)"
fi
echo "  user_id:  $USER_ID"
echo "  plot_id:  $PLOT_ID"
echo "  login:    https://${APP_PUBLIC_URL#https://}/login"
