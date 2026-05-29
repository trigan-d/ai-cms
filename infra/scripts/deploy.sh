#!/usr/bin/env bash
# Local deploy on the VPS. Usage:
#   ssh deploy@VPS 'cd ai-cms && bash infra/scripts/deploy.sh'
# Or interactively after `git pull`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/infra/.env"
COMPOSE="docker compose -f $REPO_ROOT/infra/docker-compose.yml --env-file $ENV_FILE"
PSQL="$COMPOSE exec -T -e PGPASSWORD=$(grep ^POSTGRES_PASSWORD $ENV_FILE | cut -d= -f2) db psql -U supabase_admin -d postgres"

log() { echo -e "\033[1;34m[deploy]\033[0m $*"; }

log "git pull"
git fetch --quiet origin main
git reset --hard origin/main

log "applying any new migrations"
$PSQL -c "CREATE TABLE IF NOT EXISTS public._migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())" >/dev/null
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  applied="$($PSQL -tA -c "SELECT 1 FROM public._migrations WHERE name='$name'" 2>/dev/null || true)"
  if [[ -z "$applied" ]]; then
    log "  → $name"
    $PSQL -v ON_ERROR_STOP=1 < "$f"
    $PSQL -c "INSERT INTO public._migrations(name) VALUES ('$name')"
  fi
done

log "building studio image"
$COMPOSE build studio

log "recreating studio container"
$COMPOSE up -d studio

log "pruning unused images + build cache (>24h old)"
# Раньше тут стоял фильтр 168h только на image prune, без чистки build-cache.
# За пару месяцев деплоев это копило ~15 ГБ в /var/lib/containerd + overlayfs.
# Активные образы (запущенные контейнеры) prune не тронет.
docker image prune -af --filter "until=24h" || true
docker builder prune -af --filter "until=24h" || true

log "done"
