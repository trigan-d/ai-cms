# How we "killed" the CMS: a static site managed by AI

We run a motorhome workshop in Novosibirsk, Russia — Siberian Motorbears — with a
real website: model pages, rentals, a routes section with an interactive map, a blog
of ~150 entries, and a complete English version. I used to build all of this on a
popular CMS, and it was a constant struggle. Every task became a hunt through a
palette of pre-built blocks — and usually I had to bend the task to fit the CMS
instead of the other way around.

Today the site is built on a fundamentally different principle, and I want to break
down why this is, in my view, the end of the CMS for a whole class of small sites.

## The idea in one paragraph

The site is just a folder of static HTML/CSS/JS files. Hosting is free GitHub Pages.
And the "content management system" is an AI agent in the console (for me that's
Claude Code and Cursor). I describe a task in plain language — the agent implements
it in code, walks every page, fixes the layout, writes helper scripts, fills the
blog, translates to English and publishes. No CMS, no templating engine, no backend,
no server.

## What became unnecessary

**The CMS.** Its main value was letting a non-programmer assemble a page from ready
blocks. But AI removes that limitation entirely: I don't pick from a palette — I just
say what I want and get the component I need. A photo carousel, a fullscreen viewer,
an interactive Leaflet routes map — all of it lives on static pages and was written
by the agent for the specific task, not shoehorned into someone's plugin.

**The templating engine and the backend.** You'd think that without templates the
shared blocks (menu, footer, breadcrumbs) would drift apart across pages. In
practice the agent keeps them consistent: when something changes, it synchronizes
every page. And where repetitive logic really is heavy — the blog, the English
version, the routes — the agent itself wrote small Python scripts that generate the
final HTML. The output is still static.

**The server.** Static files can be served by anything. GitHub Pages serves them
from a CDN, and deployment is a `git push`: a GitHub Action copies the site folder
into the Pages root, and a couple of minutes later everything is updated. There is
no server to configure or maintain at all. As a bonus, static content has almost
nothing to hack and can't be knocked over by load.

## But what about "dynamic" content and integrations?

The most interesting part is that even quasi-dynamic things fit static perfectly, as
long as the integration doesn't have to be instant. Our blog is kept on VK. I tell
the agent: "update the blog — there's a new post on VK, translate to English
yourself, no external API." A script pulls the latest posts, downloads photos, adds
new entries, removes deleted ones, regenerates the pages and the sitemap, while the
agent invents meaningful titles and translates the text by hand. Data becomes ready
HTML once — at update time. The webmaster is happy to trigger this manually, and
that's enough.

And if you'd rather not trigger it by hand, it can run on a scheduled cloud agent:
cheap mechanics on a daily cron, and the "smart" part (titles, quality translation)
only when a new post actually appears.

## The AI doesn't just build markup — it designs content

The clearest example is the routes section with its interactive maps. I write: "add a
route to Lake Teletskoye via the Chuysky tract, as a loop, about three days." The agent
doesn't reach for a palette of blocks — it **designs the route itself**: it picks real
waypoints (passes, reserves, specific landmarks and stops in driving order), adds the
track, builds the geometry along actual roads via OSRM with one command, drops
annotated markers on the map, and slots the route card into the list by trip length.
The result is a working interactive map — again with no server, just static files.

## Internationalization — also handled by AI

The complete English `/en/` version is assembled by scripts. Bulk translation is
machine translation with a cache (cheap), while important text is translated by the
AI itself, with no external services. Even the dynamic parts — blog titles and entry
bodies — are translated and stored next to the original. SEO doesn't suffer: the
agent sets hreflang, canonical, sitemap and JSON-LD on its own.


## Three ways to get a simple website

A person who needed a simple site used to have two options: hire a webmaster or a web
studio, or go into some CMS and assemble the site from blocks themselves. I've
described a third: create and run the site through AI.

But let's be honest — all three still require at least minimal technical literacy
from the client. You need some idea of what hosting and DNS are, what HTML and "AI"
even are, how to talk to the AI and what to expect from it. For a large share of
people that's already a barrier: they just want a site, not a reason to learn how the
internet works.

## Where the business for an agency is

Now imagine an agency removes that last barrier too. To do it, you bundle three
things into one product:

1. **Your own LLM**, fine-tuned for these tasks and deployed in-house — so you don't
   pay third-party models per token and keep your unit cost under control.
2. **Your own GitHub-Pages-style hosting** — static serving plus auto-deploy.
3. **Third-level domains** on the agency's own domain, handed to the client in one click.

The result is a turnkey system for people who don't understand the tech at all. All
the client has to do is pick a subdomain name. After that they simply open a chat
with the agency's AI — text or even voice — and say what they want on their site.

## What it looks like for the client

You pick up your phone. On screen is a live preview of your site. You say into the
mic: "make the background red, increase the font, and add a CONTACTS item to the
menu." The changes appear on screen instantly. You like it — you say "confirm,
publish," and your real site at your address updates immediately. You don't — "undo"
or "put it back." No admin panels, plugins, themes or templates — just a conversation
and a result in real time.

## Why it's commercially interesting

A product like this removes the last barrier — technical literacy — and opens up the
part of the market that neither studios (expensive and slow) nor CMS products (you
still have to sit down and learn them) could reach. The client pays a subscription for
"a site you can run by voice"; the agency's marginal cost is near zero — its own LLM,
its own static hosting, its own deploy. That's both eating CMS market share and a new
revenue stream. In essence it's what the CMS was for the "assemble from blocks" era —
only now for the "just say what you want" era.

Obviously this wont kill complex portals with real server-side logic. But for
business cards, landing pages, small-business sites and blogs, the customer base of
classic CMS products will, I believe, drop significantly over the next few years.
We've already moved our site over — and we're not going back.

*Site: siberian-motorbears.ru — built and maintained exactly as described.*
