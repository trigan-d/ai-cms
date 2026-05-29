# STATUS — состояние проекта и следующие шаги

> Рабочий трекер. Полный замысел — в [`PLAN.md`](./PLAN.md). Запуск — в [`../README.md`](../README.md).

Последнее обновление: 2026-05-29 (автономная сессия 2).

## Где мы в плане
Реализованы **фазы 0–5**: ядро агента, CLI/спайк, Studio-UI, мультитенантность (Supabase auth+RLS,
дашборд, провижининг, редактор, поддомены), **инфра self-host** (Caddy wildcard TLS + docker-compose
+ Dockerfile + deploy.sh) и **хардненинг свободного кода** (security-заголовки, изоляция, abuse-док).
Гейт фазы 0 пройден; многостраничность починена (дефолт llama3.1:8b = 75%).
Из роадмапа сделаны **R3 (голос/STT)** и **R5 (кастомные домены)**; R2 (PWA) отложен; R1/R4 — нет.
Следующее — ручной E2E в браузере + прод-деплой / R1 (динамика).

## Зафиксированные решения
1. Свободный код (любой HTML/CSS/JS+картинки), **без** палитры.
2. Версии/undo/publish = **git на тенанта**; рантайм = отдача статики.
3. **MVP — только статика**; динамика/BaaS, PWA, голос, дообучение — роадмап.
4. LLM — готовая open-модель с tool-calling через **OpenAI-совместимый** эндпоинт (vLLM/Ollama).
5. Vendor-neutral, основной таргет — self-host РФ.

## Сделано ✅
- Монорепо (pnpm, Node 22, TS strict). `agent-core` собирается в `dist` (его импортирует Studio).
- **`packages/agent-core`**: provider (OpenAI-совм., `fromEnv`), sandbox (anti-traversal),
  git-обёртка, `tenant-repo` (git: draft↔published, publish/revert/rollback), tools
  (fs_list/read/write/edit, list_history, publish, revert), loop, prompt, **`tool-recovery`**
  (восстановление tool-call'ов из текста), **`context`** (`buildSiteContext` — состояние сайта в
  промпт). Тесты: **14/14**.
- Ollama-модели на машине: `qwen2.5-coder:7b` (дефолт), `llama3.1:8b`.
- **Фаза 3 — мультитенантность (kv12chat-подход):**
  - Supabase self-hosted локально (`supabase/config.toml`, проект `ai-cms`, порты **553xx** —
    чтобы не конфликтовать с работающим стеком kv12chat на 543xx). Стек поднят.
  - Миграции `supabase/migrations/`: `profiles` (1:1 с auth.users), `tenants`
    (subdomain unique, owner_id), RLS owner-scoped, триггер автосоздания профиля при signup.
  - Studio: supabase-хелперы (`lib/supabase/{client,server,admin}.ts`, cookie `sb-ai-cms-auth-token`),
    `lib/auth.ts`, **`proxy.ts`** (Next 16 middleware): auth-гейт + резолв поддомена
    `<sub>.localhost`/`<sub>.platform.ru` → rewrite на `/published/<sub>/...`.
  - Страницы: `/login`, `/signup`, дашборд `/` (список сайтов владельца + создание),
    редактор `/sites/[id]` (проверка владения через RLS).
  - API: `POST /api/sites` (создать тенант + провижининг git-репо), `/api/sites/[id]/{chat,publish,revert}`,
    превью `/preview/[id]/...` (владелец), отдача опубликованного `/published/[sub]/...` (публично).
  - `apps/studio/.env.local` — локальные Supabase-ключи (553xx). Рантайм-смоук пройден:
    auth-гейт→/login, неавторизованный API→401, `acme.localhost` отдаёт опубликованный сайт+ассеты.
- **Многостраничность (фикс):** шаблон переделан в многостраничный (index+about, ссылки на файлы);
  `tools.ts` мягко приводит типы аргументов (`replace_all:"false"` и т.п.); дефолт-модель —
  **`llama3.1:8b`** (надёжно доводит fs_write+fs_edit). Спайк 75% (6/8). qwen2.5-coder:7b обрывал
  многошаговость — не дефолт.
- **Фаза 4 — инфра self-host** (`infra/`): `Dockerfile` (Next standalone, монорепо, git в runtime),
  `Caddyfile` (wildcard TLS DNS-01: `platform.ru`/`app`→studio, `api`→kong, `*.platform.ru`→studio),
  `docker-compose.yml` (db/auth/rest/realtime/storage/kong + studio + **ollama** + caddy; тома
  `tenant-data`/`ollama-data`), `deploy.sh` (git pull→миграции→build studio→up), `.env.example`,
  `README.md`, `.dockerignore`. `next.config` → `output: standalone`.
  ⚠️ **Проверено:** standalone-сборка Next ✓, YAML compose валиден ✓, контекст 488КБ ✓. **НЕ
  проверено:** полная сборка Docker-образа (legacy-билдер виснет на `apk` — сеть; buildx нет) и
  подъём прод-стека — это шаг на VPS.
- **Фаза 5 — хардненинг** (`lib/security.ts`): security-заголовки (CSP с `frame-ancestors`/`base-uri`,
  nosniff, referrer, X-Frame-Options) на `/published` и `/preview`; куки Studio host-only (не текут
  на поддомены тенантов); abuse-модель описана в `infra/README.md` (TODO-хук: не отдавать
  `suspended`-тенантов).
- **`apps/cli`**: `pnpm chat`, `pnpm spike` (гейт, со счётом % и diff'ами; не засчитывает «0 правок»).
- **`apps/studio`** (Next.js 16.2.6): `/` чат+iframe-превью+кнопки; `/api/chat` (петля агента),
  `/api/publish`, `/api/revert`, `/preview/[[...path]]` (отдаёт draft, no-store).
  `lib/tenant.ts` — синглтон демо-тенанта `studio-demo`, грузит корневой `.env`. **`next build` зелёный.**
  Рантайм-смоук: превью отдаёт draft, publish работает.
- `templates/starter/` — стартовый сайт; `eval/tasks.json` — ~10 SM-style задач.

## Гейт фазы 0 — РЕЗУЛЬТАТ ✅ (обнадёживающе)
Готовая 7B-модель на CPU **жизнеспособна** при грамотном харнесе. Ключевой рычаг — **давать агенту
контекст сайта** (список файлов + содержимое) в системный промпт (`buildSiteContext`): модель не
угадывает пути и попадает в точные строки для `fs_edit`.

| Модель (Ollama, CPU) | базовый | + контекст | + многостр. шаблон + coercion |
|---|---|---|---|
| `qwen2.5-coder:7b` | ~13–38% | 63% (5/8) | — (обрывает многошаговость) |
| `llama3.1:8b` | 25% | 50% (4/8) | **75% (6/8)** ← дефолт |

**Многостраничность (важный фикс 2026-05-29):** редактор раньше не делал многостраничные сайты.
3 причины, все устранены: (1) стартовый шаблон был одностраничник с якорной навигацией (`#about`) →
переделан в многостраничный (index+about, ссылки на файлы); (2) `replace_all`/`limit` приходили
строками и отклонялись zod → добавлено мягкое приведение типов в `tools.ts`; (3) qwen 7b обрывает
многошаговые задачи после 1-го вызова инструмента → **дефолт сменён на `llama3.1:8b`** (надёжно
доводит цепочки fs_write+fs_edit; нативные tool_calls). Проверено: создаёт страницу + ставит реальную
ссылку в меню.

Нюансы, заложенные в код:
- **qwen** часто кладёт tool-call в текст кривым JSON (имя без кавычек, склейка `{...}{...}`,
  HTML с неэкранированными кавычками) → лечит `tool-recovery.ts` (сканер сбалансированных `{...}`,
  починка имени, теги `<tool_call>`, ```-блоки). qwen — code-specialized, делает мелкие точные правки.
- **llama3.1** отдаёт нативные структурные `tool_calls` (форматирует Ollama) — чище, но как редактор
  кода чуть слабее на этих задачах.
- Дефолт в `.env` — `qwen2.5-coder:7b` (лучший %). Контекст сайта включён в spike/chat/studio.

Оставшиеся провалы — многошаговые (создать файл + сослаться) и часть правок, где модель ответила
текстом. Это потолок 7B; поднимается дальнейшими улучшениями петли (ретрай при неудачном `fs_edit`,
поощрение многошаговости) и/или моделью побольше (`qwen2.5-coder:14b`, если освободить RAM) либо
гибридом с сильной хостед-моделью (см. PLAN).

## Следующий шаг 🔜
1. **E2E через Studio вручную (в браузере)** — главная непройденная проверка (требует SSR-куки,
   не скриптуется curl'ом):
   - Запустить: Ollama (`ollama serve`), Supabase (`supabase start` если не поднят),
     `pnpm --filter @ai-cms/studio dev` → http://localhost:3000
   - Зарегистрироваться (/signup) → создать сайт (поддомен) → в редакторе «сделай фон тёмным и
     добавь пункт меню Контакты» → превью → «Опубликовать» → открыть `http://<sub>.localhost:3000`
     (видеть опубликованный сайт) → «Отменить черновик».
2. **Фаза 4 — инфра self-host**: Caddy wildcard TLS (DNS-01), `docker-compose(.selfhost/.cloud).yml`,
   `deploy.sh` (ssh+git pull+миграции+rebuild), бэкапы PITR. (Сейчас всё локально через CLI.)

## Роадмап — статус
- ✅ **R3 — голос (STT):** кнопка-микрофон в редакторе. **Локально работает через Web Speech API
  браузера** (Chrome, ru-RU, без бэкенда) — основной путь. Фоллбэк: запись→`/api/stt`
  (OpenAI-совм. транскрипция, self-hosted Whisper через `STT_BASE_URL`; auth-gated) +
  закомментированный сервис `whisper` в compose для прода.
  ⚠️ Self-hosted Whisper в этой dev-среде поднять не удалось: образ `faster-whisper-server:latest-cpu`
  доустанавливает зависимости с PyPI на старте, а сеть из контейнеров тут флакает (та же беда, что
  с apk/npm). Для прода — стабильная сеть + предсобранный образ/модель. Web Speech API закрывает
  локальный сценарий.
- ✅ **R5 — кастомные домены:** миграция `tenant_domains` (+RLS), `/api/tls/allowed` (Caddy
  on-demand `ask`), `/api/sites/[id]/domains` (добавить+DNS-верификация / список), резолв
  кастом-хоста→тенант в `proxy.ts` (PostgREST service role, кеш), Caddyfile `on_demand_tls` +
  catch-all `https://`. **Проверено end-to-end:** ask 200/403, кастомный домен отдаёт сайт тенанта,
  suspended-тенант блокируется, неизвестный хост→404.
- ⏸️ **R2 — PWA:** ОТЛОЖЕНО пользователем. Код есть (`lib/pwa.ts`, инъекция в `/published`) и
  компилируется; инъекция `rel="manifest"` подтвердилась попутно, но как фича не финализирована.
- [ ] **R1 — динамика/BaaS** (комменты/отзывы/формы → магазин) и **R4 — своя дообученная модель** —
  не начинались.
- [ ] Прод-деплой: сборка Docker-образа на машине с buildx; подъём стека на VPS; wildcard DNS +
  Caddy с DNS-плагином.
- [ ] (Опц.) ретрай при ошибке `fs_edit`; проба `qwen2.5-coder:14b`.

## Как запускать
- Модель: Ollama (`ollama serve`), модель из `.env` (`LLM_MODEL`).
- **Supabase (control-plane):** `supabase start` (из корня ai-cms). Порты 553xx. Studio UI БД:
  http://127.0.0.1:55323. Остановить: `supabase stop`. Ключи уже в `apps/studio/.env.local`.
- `pnpm spike` — гейт модели. `pnpm chat` — CLI-редактор (single-tenant, без БД).
- **Studio (мультитенант):** `pnpm --filter @ai-cms/studio dev` → http://localhost:3000.
  Опубликованные сайты — на `http://<sub>.localhost:3000`.
- Тенанты на диске: `./data/tenants/<tenantId>` (git), опубликованное: `./data/sites/<subdomain>`
  (в `.gitignore`).
- ⚠️ После правок в `agent-core` пересобирать: `pnpm --filter @ai-cms/agent-core build`
  (Studio/CLI импортируют `dist`). Для итераций UI удобнее `studio dev`. После удаления/переноса
  роутов чистить кэш типов: `rm -rf apps/studio/.next` перед typecheck/build.

## Открытые вопросы
- Выбор модели (см. гейт). Если ни одна self-hosted на этом железе не тянет — гибрид с хостед.
- `serverExternalPackages` Next: при `next build` агент-кор может вшиваться в бандл — после правок
  agent-core делать `next build` заново или гонять `studio dev`.

## Презентационные артефакты (хакатон) — 2026-05-29
- `docs/hackathon/README.ru.md` / `README.en.md` — идея, архитектура, фичи, роадмап.
- `docs/hackathon/blog.ru.md` / `blog.en.md` — блог-пост (~750 слов).
- `demo/out/demo-ru.mp4` / `demo-en.mp4` — видео ~75с, без звука, субтитры внизу. Контент сайтов и
  промпты локализованы под язык. Сценарий: дашборд (переключение между сайтами) → редактирование
  двух РАЗНЫХ сайтов (светлая «редакторская» пекарня на засечках vs тёмный неоновый постер клуба
  PULSE — общий старт, разный результат) → просмотр на bakery.localhost / pulse.localhost.
- Инструменты записи (можно перегенерировать): `demo/setup.mjs` (контент-стадии + публикация),
  `demo/record.mjs` (Playwright→webm), `apps/studio/app/demo/page.tsx` (скриптовый прогон, `?lang=ru|en`).
  Видео — скриптовый прогон реального UI со стадиями контента (паузы модели исключены by design).
