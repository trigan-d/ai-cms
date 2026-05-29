# infra/ — self-hosted prod stack (Caddy + Supabase + Studio + Ollama)

Весь прод ai-cms на одной машине, без managed-сервисов и vendor-lock (подход kv12chat).
Наружу торчит только Caddy; всё остальное — во внутренней docker-сети.

```
                 *.platform.ru / platform.ru / api.platform.ru   (wildcard A → VPS)
                                   │ 80/443
                            ┌──────▼──────┐
                            │    CADDY    │  wildcard TLS (DNS-01) + security headers
                            └──┬───────┬──┘
              platform.ru/app  │       │ api.platform.ru, *.platform.ru
                        ┌───────▼─┐   ┌─▼──── KONG ──────────────────┐
                        │ STUDIO  │   │ auth · rest · realtime · storage │
                        │ Next 16 │   └──────────────┬────────────────┘
                        └──┬───┬──┘                  │
                  ollama   │   │ supabase             ▼
                  ┌────────▼┐ ┌▼──────────┐      ┌─────────┐
                  │ OLLAMA  │ │  (kong)   │      │ POSTGRES│
                  └─────────┘ └───────────┘      └─────────┘
```

Сервисы (`docker-compose.yml`): `db, auth, rest, realtime, storage, kong` (Supabase) +
`studio` (наш Next.js, `apps/studio/Dockerfile`, standalone) + `ollama` (инференс) + `caddy`.

## Маршрутизация (Caddyfile)
- `platform.ru`, `app.platform.ru` → Studio (дашборд/редактор, auth внутри).
- `api.platform.ru` → Kong (Supabase API для браузера; ws для Realtime).
- `*.platform.ru` → Studio; его `proxy.ts` резолвит поддомен и отдаёт опубликованный сайт
  тенанта (`/published/<sub>`). **Один wildcard-сертификат** покрывает всех тенантов →
  новый сайт «в один клик» не трогает DNS/Caddy/сертификат.

## Предварительно (на VPS)
1. **DNS** (один раз): `A platform.ru → IP`, `A *.platform.ru → IP`.
2. **Caddy с DNS-плагином**: wildcard-сертификат требует DNS-01, а значит образ Caddy,
   собранный с плагином провайдера: `xcaddy build --with github.com/caddy-dns/<provider>`
   (Cloudflare, или плагин вашего регистратора). Замените `cloudflare` в Caddyfile и задайте
   `DNS_API_TOKEN` в `infra/.env`. (Для apex/`app`/`api` хватает обычного HTTP-01.)
3. **Docker** + (для скорости сборки) buildx; иначе соберётся и legacy-билдером.

## Запуск
```bash
cp infra/.env.example infra/.env      # заполнить секреты (bootstrap.sh умеет генерить)
bash infra/scripts/bootstrap.sh       # первый подъём всего стека
docker compose -f infra/docker-compose.yml --env-file infra/.env exec ollama \
  ollama pull llama3.1:8b             # подтянуть модель редактора
```
Обновления (без CI): `ssh deploy@VPS 'cd ai-cms && bash infra/scripts/deploy.sh'`
(git pull → накат миграций `supabase/migrations/*.sql` → `docker compose build studio` → `up -d`).

## Облако / dev (vendor-neutral)
Тот же код едет в облако (Supabase Cloud + Vercel) — меняются только ENV. Локально:
`supabase start` (порты 553xx) + `pnpm --filter @ai-cms/studio dev`.

## Бэкапы (критично — все тенанты в одной БД)
- Postgres: WAL-archiving (wal-g) + PITR, off-site, регулярные restore-drills.
- Сайты тенантов: том `tenant-data` (git-репозитории) — бэкапить вместе с БД.

---

## Безопасность свободного кода (фаза 5)
Сайты — произвольные HTML/CSS/JS. Защита — **изоляция**, а не валидация контента:

- **Origin-изоляция:** каждый тенант на своём поддомене = отдельный origin (Same-Origin Policy
  бесплатно разделяет хранилище, куки, скрипты между сайтами).
- **Куки сессии Studio — host-only** (`@supabase/ssr` ставит cookie без атрибута `Domain`),
  поэтому сессия владельца **не утекает** на поддомены тенантов.
- **Security-заголовки** на отдаче сайтов (`lib/security.ts`): CSP с `frame-ancestors`/`base-uri`
  (анти-clickjacking/анти-base-hijack), `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `X-Frame-Options`. CSP намеренно **разрешает** inline/eval/external-https — иначе сломается
  свободная вёрстка; вредоносный *умысел* отсекается модерацией, а не CSP.
- **Abuse-модель:** у тенанта есть `status` (`active|suspended|deleted`). Приостановка сайта =
  перевод в `suspended` (TODO-хук: отдача `/published/<sub>` должна проверять статус и не
  обслуживать неактивные — добавить с кэшем, чтобы не ходить в БД на каждый ассет).
- **Песочница редактора:** файловые операции агента заперты в корне тенанта (`Sandbox`,
  anti-traversal), агент одного тенанта физически не видит файлы другого.
