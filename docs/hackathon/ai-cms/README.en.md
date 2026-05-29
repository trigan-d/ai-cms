# AI-CMS — a website you run by talking to an AI

> A replacement for the traditional CMS: a non-technical client builds and runs their
> small website just by **talking** (text or voice) to an AI agent. No admin panels,
> themes, plugins or block builders — only a conversation and a live preview.

🇷🇺 Русская версия: [README.ru.md](README.ru.md)

---

## TL;DR

For a huge class of small sites (business cards, landing pages, small-business sites,
blogs) you don't need a CMS with a palette of prefab blocks. It's enough to give the
client a **chat with an AI** that edits the site from a plain-language description, shows
changes in real time, and publishes on a "ship it" command. The platform is multi-tenant:
each client gets a site on a 3rd-level subdomain (`mysite.platform.ru`) in one click, with
automatic HTTPS.

It's a synthesis of two ideas proven on real projects:
- **Siberian Motorbears** — a site is just a folder of static files, and the "CMS" is an
  AI agent in the console that edits the code from requests in your native language.
- **kv12chat** — you don't need to write a typical backend: a BaaS (Supabase) covers it,
  and a PWA replaces native apps; all self-hosted, vendor-neutral, works in Russia.

---

## 1. What makes the approach different

In a normal CMS the client assembles a page from prefab blocks and hits their ceiling.
Here there is **no fixed palette**: the AI edits arbitrary code (any HTML/CSS/JS + images).
"Make the background dark", "add a Contacts page and a menu item", "make the heading
bigger", "lay the price list out in three columns" — the agent writes the markup the task
needs, instead of bending it to fit someone's plugin.

Meanwhile the hard parts that a CMS bakes into its admin panel are here handled by
infrastructure:
- **versions, undo, "put it back"** — that's git, per tenant;
- **publishing** — an atomic copy into the served folder;
- **subdomains, HTTPS, multi-tenancy** — Caddy + Supabase + middleware.

---

## 2. Architecture

```
                *.platform.ru   (wildcard DNS + wildcard TLS)
                          │ 443
                    ┌─────▼─────┐  ← the only public entrypoint
                    │   CADDY   │  TLS, security headers
                    └──┬─────┬──┘
   platform.ru / app   │     │ *.platform.ru (tenant sites) · api.platform.ru
              ┌─────────▼─┐ ┌─▼──── KONG ───────────────┐
              │  STUDIO   │ │ GoTrue · PostgREST · ...   │  (Supabase)
              │ Next.js16 │ └──────────────┬────────────┘
              │ chat+prev │                │
              │ proxy.ts  │         ┌──────▼──────┐
              └──┬─────┬──┘         │  POSTGRES   │ ← all tenants, isolation = RLS
                 │     │            │  + RLS      │
          ┌──────▼─┐ ┌─▼────────┐   └─────────────┘
          │ OLLAMA │ │ (kong)   │
          │  LLM   │ └──────────┘
          └────────┘
   A tenant's site = a git repo: draft (agent edits) ↔ published (served).
```

**Stack:** Next.js 16 (App Router, RSC, TypeScript strict), self-hosted Supabase
(Postgres + GoTrue + PostgREST + Realtime + Storage + RLS), Ollama for the self-hosted
LLM, Caddy (TLS/routing), all in Docker Compose. Services are reached only via ENV, so the
same code runs locally, in the cloud, and on your own VPS in Russia (vendor-neutral).

---

## 3. How editing works (the heart of the project)

It's "Claude Code / Cursor for one client's static folder", but on a self-hosted model:

1. The client types (or speaks) a request into the chat.
2. The agent loops, calling tools: `fs_list`, `fs_read`, `fs_write`, `fs_edit`,
   `publish`, `revert`. File operations are **locked to the tenant's root** (a sandbox,
   traversal-proof) — one client's agent physically can't see another's files.
3. So the agent doesn't have to guess the structure, the **current site state** is put
   into its system prompt (`buildSiteContext`) — this sharply raises edit accuracy.
4. Changes go into a **draft** and appear instantly in the live preview.
5. "Ship it" → atomic publish (commit + copy into the served folder).
   "Undo" / "put it back" → rollback via git.

**How it's implemented (git under the hood).** Every site is a real git repository; a tenant
has two folders: `data/tenants/<id>/` — the working tree the agent edits (the **draft**, also
what the preview shows), and `data/sites/<subdomain>/` — the published copy (what the server
serves). Mapping to git: creating a site = `git init` + the first commit; "Publish" =
`git commit` (**a new version**) + an atomic copy into the served folder; "Discard draft" =
`git checkout`/`clean`; "put it back" = a forward `git revert` (history is preserved); the
version list = `git log`. No custom "versioning system" had to be written — git covers that
role, and the content lives as plain files. Postgres holds only the control plane (owner,
subdomain, status), not site content.

**The LLM is self-hosted.** A ready open model with tool-calling is used; the default is
`llama3.1:8b` (reliably completes multi-step edits — create a page *and* add the menu
link). The provider is abstracted (OpenAI-compatible endpoint: Ollama/vLLM or hosted), so
the model can be swapped or fine-tuned for the task.

---

## 4. Multi-tenancy and dynamics without backend code

- **One Supabase instance, isolation via `tenant_id` + RLS** (not "a project per client").
  An owner sees and edits only their own sites — guaranteed by the database, not by some
  controller check.
- **Subdomain in one click**: a row in `tenants` + initializing a git repo from a
  template. Wildcard DNS and wildcard TLS already cover everyone — DNS/Caddy aren't touched.
- **Authentication** — GoTrue (email+password), cookie sessions via `@supabase/ssr`
  (the kv12chat pattern). Clients self-register.

---

## 5. Features (implemented)

- **AI editor**: chat + live draft preview + "Publish" / "Discard draft".
- **Free-form code**: any HTML/CSS/JS, multi-page sites with navigation.
- **Multi-tenancy**: owner's site dashboard, subdomain provisioning, RLS isolation.
- **Subdomain serving**: `name.platform.ru` serves the published site with auto-HTTPS.
- **Voice (R3)**: a mic button — locally via the browser's Web Speech API, in production
  via self-hosted Whisper (`/api/stt`, OpenAI-compatible).
- **Custom domains (R5)**: a client attaches their own domain (`www.shop.com`); Caddy
  issues a cert on-demand only for verified domains (`/api/tls/allowed`).
- **Hardening**: security headers/CSP on served sites, host-only cookies (the owner's
  session never leaks to tenant sites), sandboxed file operations.
- **Infrastructure**: Docker Compose (Supabase + Studio + Ollama + Caddy), CI-less deploy
  (`deploy.sh`: git pull → migrations → rebuild → up), vendor-neutral.

---

## 6. Next steps

- **Dynamics / BaaS (R1):** a blog with comments, reviews, forms — tables with `tenant_id`
  and RLS (the pattern is already in place); anonymous writes through a thin server proxy
  with anti-spam; the seam with the markup via platform web components
  (`<aicms-comments>`) so the freedom of layout is preserved. Then an online store
  (products, cart, orders).
- **Per-tenant PWA (R2):** auto manifest/service-worker/icon and installing the client's
  site onto a visitor's phone (the code scaffold exists).
- **Own fine-tuned model (R4):** a dataset from real editing sessions
  (input: files+request, output: applied edits) → fine-tune a small model (QLoRA) →
  switch inference over, with the ready/hosted model as fallback. Goal — cost control and
  working in Russia.
- **Production deploy**: a VPS in Russia, wildcard DNS, Caddy with the provider's DNS
  plugin; a GPU for inference to make edits fast.
- **Business model**: a subscription for "a website you run by voice"; the agency's
  marginal cost is near zero — own LLM, own static hosting, own deploy.

---

## Run it locally

```bash
# 1. Model: Ollama + a model
ollama serve && ollama pull llama3.1:8b
# 2. Control plane: Supabase (ports 553xx)
supabase start
# 3. Studio
pnpm --filter @ai-cms/studio dev        # → http://localhost:3000
# Published sites are at http://<subdomain>.localhost:3000
```
Details and status — in [`../STATUS.md`](../STATUS.md) and [`../../CLAUDE.md`](../../CLAUDE.md).
