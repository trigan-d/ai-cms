# CLAUDE.md — контекст проекта для ассистента

> Этот файл Claude Code читает автоматически в начале сессии. Держи его коротким; детали — по ссылкам.

## Что это
**AI-CMS** — мультитенантная ИИ-платформа-замена CMS. Нетехнический клиент ведёт свой сайт,
разговаривая с ИИ-агентом обычным языком (текст), с живым превью и публикацией/откатом.
Синтез проектов *Siberian Motorbears* (статика + ИИ вместо CMS) и *kv12chat* (BaaS+PWA).

## Где что лежит
- **Полный план** (вся архитектура, фазы, риски, верификация): [`docs/PLAN.md`](./docs/PLAN.md)
- **Статус и следующие шаги** (читай первым при возобновлении): [`docs/STATUS.md`](./docs/STATUS.md)
- **Запуск для пользователя**: [`README.md`](./README.md)

## Зафиксированные решения (НЕ пересматривать без явной просьбы)
1. **Свободный код**, а не палитра компонентов/тем — ИИ правит произвольные HTML/CSS/JS+картинки.
2. Версии/undo/publish = **git на тенанта**; рантайм = отдача статики.
3. **MVP — только статика.** Динамика/BaaS, PWA, голос, своя дообученная модель — роадмап (см. PLAN).
4. LLM — готовая open-модель (Qwen2.5-Coder) через **OpenAI-совместимый** эндпоинт (vLLM/Ollama),
   без дообучения в MVP. Провайдер из ENV.
5. Vendor-neutral, основной таргет — self-host РФ.

## Структура кода
- `packages/agent-core/` — провайдер-нейтральное ядро: provider, sandbox (anti-traversal),
  tenant-repo (git: draft↔published, publish/revert/rollback), tools, loop, prompt, context, tool-recovery.
- `apps/cli/` — `pnpm chat` (single-tenant редактор), `pnpm spike` (гейт фазы 0).
- `apps/studio/` — Next.js 16, **мультитенант**: auth (Supabase/GoTrue по образцу kv12chat,
  `lib/supabase/*`, `proxy.ts`), дашборд `/`, редактор `/sites/[id]`, отдача по поддомену
  `/published/[sub]`. Supabase-ключи в `apps/studio/.env.local`.
- `supabase/` — control-plane: `config.toml` (порты 553xx), `migrations/` (profiles, tenants, RLS).
- `infra/` — self-host: `Dockerfile`(studio standalone), `Caddyfile`(wildcard TLS DNS-01),
  `docker-compose.yml`(supabase+studio+ollama+caddy), `deploy.sh`, `.env.example`, `README.md`.
- `templates/starter/` — **многостраничный** стартовый сайт (index+about). `eval/tasks.json` — задачи.

## Команды
`pnpm install` · `supabase start` (control-plane, порты 553xx) · `pnpm chat` · `pnpm spike` ·
`pnpm --filter @ai-cms/studio dev` (→ localhost:3000; сайты на `<sub>.localhost:3000`) ·
`pnpm -r typecheck` · `pnpm -r test`. ⚠️ после правок agent-core: `pnpm --filter @ai-cms/agent-core build`.

## Текущий следующий шаг
Фазы 0–5 готовы + роадмап **R3 (голос/STT)** и **R5 (кастомные домены)**. R2 (PWA) отложен (код есть,
не финализирован); R1 (динамика/BaaS), R4 (своя модель) — не начинались. Многостраничность починена
(дефолт `llama3.1:8b`). Дальше: ручной E2E в браузере; прод-деплой (Docker-образ на buildx + VPS);
R1. Полный статус — в `docs/STATUS.md`.

## Конвенции
- Node 22, ESM, TypeScript strict; в импортах source — спецификаторы `.js` (NodeNext).
- Тесты: `node:test` + `tsx` (не vitest). Перед коммитом: `pnpm -r typecheck && pnpm -r test`.
- Коммитить/инициализировать git и выполнять внешние действия — **только по явной просьбе**.
