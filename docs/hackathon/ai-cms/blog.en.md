# A website you run by voice: how we're building a CMS replacement

Imagine your mom runs a small bakery and needs a website. Today she has three options.
Hire an agency — expensive and slow. Use a site builder — she'll have to sit down and
figure it out: blocks, themes, settings, domains, hosting. Or ask a programmer friend —
and depend forever on his free evening. All three demand at least some technical courage
from her. But she just wants a website, not a reason to study how the internet works.

We're building a fourth way: **a website you run by conversation**. You open a chat, type
or say "make a bakery site in warm tones, the homepage about fresh bread every morning",
and a few seconds later you see the result in a live preview. "Add a page with the address
and phone, and a Contacts menu item" — done. "Ship it" — and the site is already live at
`bakery.platform.ru`. No admin panels, themes, or blocks. Just a conversation.

## Thesis: a CMS is no longer needed for a whole class of sites

The core value of a traditional CMS was that a non-programmer can assemble a page from
prefab blocks. But that very palette of blocks is also the ceiling: the component you need
is never quite there, and you end up bending your task to the system's abilities rather
than the other way around. AI removes that limit entirely. It doesn't pick from a palette —
it writes the markup your specific request needs. A dark theme, a three-column price list,
a separate page, a tidy menu — that's all just the text of a request, not a hunt for a
plugin.

The idea isn't ours in a vacuum — we stand on two previous projects. In one, we ran a
commercial site with no CMS at all: the site was a folder of static files, and the
"management system" was an AI agent in the console you'd task in your native language. In
the other, we built a live chat for a thousand people **without a single line of custom
backend** — a BaaS (Supabase) covered that role, and a PWA replaced the native app. AI-CMS
combines both lessons and removes the last barrier — the client's technical literacy.

## What "disappeared" under the hood

When you see a chat and a preview, you don't see how much ordinary CMS work simply wasn't
needed here.

**The editor is an AI agent.** It's essentially "Claude Code for one client's folder", but
on our own self-hosted model. The client writes a request — the agent loops, reading and
editing files through a set of tools (read, write, edit, publish, revert). All file
operations are locked to that site's root: one client's agent physically can't see
another's files. And so it doesn't have to guess the structure and lands edits on the first
try, the current state of the site is placed into its context in full.

**Versions and "put it back" are git.** Every publish is a commit. "Undo" reverts the
draft; "put it back" restores a previous version. We didn't have to write a separate
versioning system — git does it better.

**Multi-tenancy is Supabase and one database.** All clients live in one database, and the
separation is enforced by RLS — rules right inside Postgres: an owner sees and edits only
their own sites, and that's a database guarantee, not a check in code that's easy to
forget. A subdomain is granted in one click: a row in a table plus initializing a git repo
from a template. A wildcard domain and wildcard certificate already cover everyone — no DNS
or web-server config is touched when a new client signs up.

**HTTPS, routing, isolation are Caddy and middleware.** A request to `bakery.platform.ru`
serves the published site; an owner's request to the studio passes through auth. And since
each site lives on its own subdomain (its own origin), the browser isolates them from each
other, and the owner's session never leaks onto client sites.

## Voice and custom domains

Voice control isn't marketing gloss — it's a natural extension of the idea: if you run the
site with words, why not out loud. The editor has a mic button; locally, recognition runs
right in the browser, and in production via self-hosted Whisper. Voice becomes the same
text request — no separate "voice engine".

And when a client grows into their own domain (`www.bakery.com`), they attach it in a
couple of clicks: the platform verifies the domain points to it, and a certificate is
issued automatically — but only for verified domains, so no one can mint certs for someone
else's.

## Why it's interesting as a business

The marginal cost of such a product trends to zero: our own model (no paying for someone
else's tokens), our own static hosting, our own deploy. Everything is self-hosted and
vendor-neutral — the same code runs in the cloud and on our own server in Russia, which
matters to us. The client pays a subscription for "a website you can run by voice", and the
agency gets a market neither agencies (too expensive) nor builders (you still have to sit
and learn) could reach.

## What's next

The core works today: an AI editor with live preview and publishing, multi-tenancy with
subdomains, voice, custom domains, the whole infrastructure in Docker. The next big step is
typical dynamics on top of static: a blog with comments, reviews, forms, and then an online
store with a cart and orders. Here the RLS + ready-made web-components combo will help
again, adding interactivity without taking away the freedom of layout. And down the line —
fine-tuning our own small model exactly for the task of "describe it in words — get an
edit", so that both quality and cost are fully under our control.

## What it cost to build

One curious detail to close on. The whole project — from idea to a working prototype with
multi-tenancy, voice and custom domains — was built in a single AI pair-programming session. The
"builder" was the frontier model **Claude Opus 4.8**: roughly ~250k output tokens with a working
context approaching a million, which at API rates comes to about **$60–100** (an estimate — we don't
have exact billing; most of the volume is cheap repeated context reads thanks to caching). The local
models the product itself runs on (**llama3.1:8b** and **qwen2.5-coder:7b** via Ollama) are
self-hosted, and in dollars that's **zero**.

And that contrast is the whole economics of the idea. An expensive frontier model helped build it
once. After that, every edit to a client's site goes through a free local model on our own hardware,
and the cost of running a website trends toward the price of electricity. Mom, by the way, doesn't
need to know any of this — she just says what she wants her website to look like.
