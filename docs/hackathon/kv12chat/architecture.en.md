# kv12chat — architecture, development & operations

> Hackathon hand-out. Audience: engineers at an outstaff/outsource agency.
> Core thesis: **for a typical product you don't need to write a backend — Supabase (BaaS) covers that role, and a PWA replaces the native app.** Below is how this plays out on a real, live project.

Russian version: [`architecture.ru.md`](./architecture.ru.md)

---

## 1. What the project is

**kv12chat** is a private chat for the residents of a country settlement, "Kvartal-12". It feels like WhatsApp/Telegram but runs on our own server. Scale: up to ~1000 users, ≤1000 messages/day. Production went live on 2026-05-26 on a single Selectel VPS (Novosibirsk) under `kv12chat.ru`.

Features: channels, real-time messages, "discussion" threads, reactions (likes), polls, image attachments, @-mentions, edit/delete, search, a settlement map with plots and residents, registration requests + admin panel, web push, and install-as-PWA on a phone.

Stack (fixed):

- **Frontend / API**: Next.js 16 (App Router, React 19, Server Components by default), strict TypeScript, Tailwind 4.
- **Backend = Supabase (self-hosted)**: Postgres, GoTrue (Auth), PostgREST (REST over the DB), Realtime (WebSocket), Storage, Edge Runtime (Deno functions).
- **Push**: Web Push API + VAPID; the dispatcher is an Edge Function triggered by `pg_cron` every 10 seconds.
- **Hosting**: a single VPS, the whole stack in Docker Compose, TLS via Caddy + Let's Encrypt. No managed services, no CI, no vendor lock-in.

---

## 2. The core idea: Supabase instead of a hand-written backend

In a typical project the backend is "auth + authorization + CRUD API + realtime + files + background jobs + notifications". Each piece is usually written by hand. Supabase gives all of it as ready-made building blocks on top of **a single Postgres database**:

| "Classic" backend task | How Supabase covers it in kv12chat |
| --- | --- |
| Registration & authentication | **GoTrue**: stores `auth.users`, issues JWTs. Login by email **or** phone — we resolve the identifier to an email on the server and call `signInWithPassword`. No custom auth service. |
| Authorization (who sees what) | **Postgres RLS policies**: `auth.uid()` + `is_admin`/`is_banned` flags are checked in the DB on every query. You can't "forget the check" in a controller. |
| CRUD data API | **PostgREST**: REST endpoints generated from the schema. Where logic is needed — thin Next.js Route Handlers or Postgres RPCs. |
| Real-time delivery | **Realtime**: subscribe to `postgres_changes` (INSERT/UPDATE/DELETE) on `messages`, `reactions`, `poll_votes` over WebSocket. |
| Files & images | **Storage**: buckets `avatars` (public) and `files` (private + signed URLs). All access goes through the `@/lib/storage.ts` wrapper. |
| Background jobs / cron | **pg_cron**: every 10 s it triggers the push-dispatcher Edge Function. |
| Notification queue | A `notification_queue` table + fan-out triggers on message/mention/thread-reply inserts. |
| Full-text search | Postgres FTS (`tsvector`, Russian dictionary) + a GIN index; `pg_trgm` for name autocomplete. |
| Schema migrations | SQL files in `supabase/migrations/`, applied on deploy. |

**Takeaway**: there's almost no "backend code" in the usual sense. There's Next.js (UI + thin API routes) and Postgres (schema + RLS + triggers). Supabase *is* the backend.

---

## 3. Topology

```
Residents ─► Caddy (TLS Let's Encrypt) ─┬─► nextjs:3000      (kv12chat.ru)
                                        └─► kong:8000        (api.kv12chat.ru)
                                               ├─ auth      (GoTrue)
                                               ├─ rest      (PostgREST)
                                               ├─ realtime  (WebSocket / WSS)
                                               ├─ storage
                                               └─ functions (push-dispatcher, Deno)
                                                      │
                                                      ▼
                                                    Postgres
                                                    + pg_cron every 10s → push-dispatcher
```

Everything is containers in a single `infra/docker-compose.yml`. Only Caddy is exposed (80/443); all Supabase services talk over the internal docker network.

A self-hosting subtlety that cost some time: the server reaches Kong by the internal name `http://kong:8000`, while the browser uses `https://api.kv12chat.ru`. `@supabase/ssr` derives the cookie name from the host, so the auth cookie name is pinned (`sb-kv12chat-auth-token`) in `client.ts`/`server.ts`/`proxy.ts` — otherwise the token doesn't carry between server and client rendering and you get a redirect loop.

### Local dev vs production

| | Local | Production |
| --- | --- | --- |
| Supabase | `supabase start` (Docker) | Docker Compose in `infra/` |
| API URL | `http://localhost:54321` | `https://api.kv12chat.ru` (via Kong) |
| Next.js | `pnpm dev` | built on the VPS itself |
| TLS | none | Caddy + Let's Encrypt |

---

## 4. How the key features are built

**Registration request → approval → login.** There is no self-signup (it suits a closed community and is easier to moderate). Flow:
1. A guest fills the form at `/register` (full name, phone, email, address/plot, two consents required by Russian data-protection law). `POST /api/registration-request` writes a row to `registration_requests` (RLS: admin-only read), with 24h phone de-duplication and a recorded consent timestamp.
2. The admin sees it at `/admin/registration-requests`, clicks "Create user" — a form opens pre-filled from the request. They pick a plot and get a **generated temporary password**. `POST /api/admin/people` calls `auth.admin.createUser()` (service role) and inserts a `profiles` row; the request is marked resolved.
3. The resident signs in at `/login` with email **or** phone + the temporary password. On first login they see a welcome/PWA-install screen.

**Real-time messages.** On send, the client (`MessageList`/`ThreadPane`) does an optimistic insert and `POST /api/messages`. In parallel, `subscribeToChannel()` (`@/lib/realtime.ts`) listens to channel `postgres_changes` — the message appears for the other person with no reload. Reactions (`reactions`) and votes (`poll_votes`) arrive over the same subscriptions.

**Discussions (threads).** A root message has `thread_root_id IS NULL`. A reply sets `thread_root_id` to the root. On mobile a thread opens full-screen; on desktop it's a right-hand pane.

**Polls.** A button in the composer menu opens poll creation; `polls` + `poll_options` + `poll_votes` (a 3-column PK prevents double voting). Results update for everyone in real time.

**Image attachments.** The client compresses the image in a canvas to ≤1 MB, uploads via `POST /api/uploads` into the `files` bucket, then attaches it to the message. Private files are served via a 1-hour signed URL.

**Editing.** Message menu → "Edit" → composer with the old text → `PATCH /api/messages/:id`, sets `edited_at`, and the UI shows an "(edited)" marker. Deletion is soft (`deleted_at`), keeping history.

**Settlement map.** `plots` stores plot polygons (JSONB coordinates) as an SVG overlay over a raster base map. Search by name / plot number / address: on a single match the map auto-focuses on the plot and lists its residents. Zoom/pan/pinch work on a phone.

**Push + PWA.** `manifest.ts` + a service worker (`public/sw.js`) provide home-screen install and an unread-count badge on the icon. The Web Push (VAPID) subscription is stored in `push_subscriptions`. Message-insert triggers enqueue jobs into `notification_queue`; `pg_cron` calls the Edge Function every 10 s, which sends the push and marks it sent.

---

## 5. Development & deployment

**Development.** The whole project was built in tandem with an AI assistant (Claude Code): the human states tasks in plain language and reviews the result; the assistant writes the schema, RLS, routes, and components. UI/UX requirements are convenient to describe in prose — exactly the part a non-engineer can specify (see the prompt examples in §6).

**Deployment — deliberately primitive, no CI:**

```
ssh deploy@VPS 'cd kv12chat && bash infra/scripts/deploy.sh'
```

On the VPS, `deploy.sh` does: `git pull` → apply new SQL migrations → `docker compose build nextjs` (Next.js is built **on the server**; the image is never published anywhere) → `docker compose up -d nextjs`. Downtime ~5 seconds. No GitHub Actions, no GHCR, no Vercel.

The same code, unchanged, also runs in the cloud (Supabase Cloud + Vercel) — so there is no vendor lock-in: you can start in the cloud and later move to your own server (which is exactly what happened here, because in Russia `*.supabase.co`/`*.vercel.app` get blocked).

---

## 6. The author's real prompts (by theme)

Extracted from this project's Claude Code session history (~254 human prompts; 12 representative ones chosen). Quotes are verbatim Russian, with an English gloss.

### PWA instead of a native app
> Я могу сделать браузерное приложение, которое юзеры смогут сохранить на телефон как иконку на рабочем столе, и получать с него пуш-уведомлния?
>
> *(Can I make a browser app that users can save to the phone as a home-screen icon and get push notifications from?)*

> мне не очень нравится иконка приложения. […] Давай попробуем заменить иконку на число 12 стилизованное под электронный циферблат с толстыми линиями
>
> *(I don't really like the app icon […] let's try a "12" styled like a thick-stroke digital clock display.)*

### Backend on Supabase / BaaS
> для чего нам в этом проекте supabase?
>
> *(what do we even need Supabase for in this project?)*

> а как работает наша кастомная авторизация по двум полям: телефон или email? Supabase умеет что-то такое из коробки?
>
> *(how does our custom login by two fields — phone or email — work? Does Supabase do something like that out of the box?)*

### RLS / data security
> Немного измени права в каналах. В публичных каналах все могут всё […]. И только один служебный канал "объявления" имеет особенность: в нём писать новые сообщения могут только админы, но все остальные жители могут их комментировать в тредах. Кстати, замени в UI везде слово "тред" на "обсуждение".
>
> *(Tweak channel permissions. In public channels everyone can do everything […]. Only the service channel "announcements" is special: only admins post there, but all residents may comment in threads. Also, replace "thread" with "discussion" everywhere in the UI.)*

> этот чат хранит персональные данные пользователей: имена, телефоны, адреса. Значит я попадаю под действие какого-то там федерального закона. Что я должен с этим делать?
>
> *(this chat stores personal data — names, phones, addresses. So I fall under some federal law. What do I have to do about it?)*

### Realtime / WebSockets
> похоже, в этом приложении не работают вебсокеты
>
> *(looks like websockets aren't working in this app)*

> websocket не работает. Все запросы на wss://api.kv12chat.ru/realtime/v1/websocket получают ответ 403
>
> *(websocket is broken. All requests to wss://…/realtime/v1/websocket get a 403.)*

### Web Push + pg_cron
> мы можем на иконке чата на рабочем столе телефона отобразить количество новых сообщений?
>
> *(can we show the number of new messages on the home-screen chat icon?)*

### Self-hosting & deploy without CI
> Использование supabase в качестве бэкенда не подошло: трафик из России к нему блокируется. Какая может быть альтернатива?
>
> *(Using Supabase as the backend didn't work: traffic from Russia is blocked. What's the alternative?)*

> а можно вообще обойтись без github actions?
>
> *(can we do without GitHub Actions altogether?)*

### UI/UX in plain language
> Давай сделаем карту […] масштабируемой […]. Лэйаут: сверху строка поиска — под ней найденные результаты — под ними карта — а под ней информация о выбранном участке. Если поиск вернул ровно один участок — карта сразу фокусируется на нём […]
>
> *(Let's make the map zoomable […]. Layout: search bar on top — results below it — the map below that — info on the selected plot below that. If search returns exactly one plot, the map focuses on it immediately […])*

> проблемы мобильного UI отправки сообщений: кнопка отправки чуть ниже поля ввода — выровняй центры; поле ввода не растёт в высоту; две иконки "файл" и "опрос" занимают много места — объедини их в одно контекстное меню […]
>
> *(mobile composer UX issues: the send button sits below the input — center them; the input doesn't grow taller; the "file" and "poll" icons take too much space — merge them into one menu […])*

---

## 7. What to take away from the hackathon

1. **For typical tasks you can skip writing a backend.** Auth, authorization (RLS), CRUD, realtime, files, cron, a notification queue, full-text search — Supabase provides all of it over a single Postgres. What's left is UI and a little business logic in thin routes.
2. **A PWA covers most needs of a mobile app**: push, home-screen install, an unread badge, an offline shell, WebSockets — without the App Store/Google Play or a separate codebase.
3. **No vendor lock-in.** The same code runs in the cloud (Supabase + Vercel) and on your own VPS. CI/CD can be full-blown (GitHub Actions) or as simple as "scp + deploy.sh".
4. **The remaining work is mostly UI/UX**, and that's convenient to specify in plain language. It shifts the project's center of gravity from infrastructure to product.

---

See also: [`blog.en.md`](./blog.en.md) (blog post), demo video at [`video/demo-en.mp4`](./video/demo-en.mp4).
