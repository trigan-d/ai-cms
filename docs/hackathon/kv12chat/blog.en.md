# A whole settlement chat with zero backend code: the kv12chat story


A private chat for a whole settlement: channels, real-time messages, access control, attachments, push, search, a map of the plots, a sign-up flow, and an admin panel. Picture the old-school estimate — a backend engineer for auth, permissions, the API, realtime, the notification queue, cron and push; a frontend engineer for the web; a mobile developer each for iOS and Android; some devops. A team of 4–6 people, several months, a budget in the millions. A familiar picture for any agency.

Now, how it actually went. **kv12chat was built by one person in roughly a day.** He designed the main task and handed it to a team of AI subagents overnight; the next day he made spot fixes in between things — "during smoke breaks," without stepping away from his day job. Where does that orders-of-magnitude difference come from? From two decisions worth talking about.

## The thesis

For the vast majority of typical products you **don't need to write a backend**. The whole "auth + authorization + CRUD API + realtime + files + background jobs + notifications" bundle is covered by the backend-as-a-service approach. We used Supabase — a layer around plain Postgres: GoTrue for authentication, PostgREST for a REST API generated from the schema, Realtime for WebSocket subscriptions, Storage for files, Edge Functions for server logic, pg_cron for schedules. All of it sits on top of **one database** you have full access to.

## What exactly "disappeared"

Let's look at what you usually hand-write — and what replaced it in kv12chat.

**Authentication.** We needed login by phone *or* email, no 2FA. There's no custom auth service: GoTrue stores the users and issues JWTs; we just resolve the entered identifier to an email on the server and call `signInWithPassword`. A couple dozen lines instead of an entire service with password hashing and token rotation.

**Authorization.** The most valuable part. The rule "in public channels everyone can post; in the 'Announcements' service channel only the admin posts new messages, but everyone can comment in discussions" was described in plain words — and turned into Postgres RLS policies. Permission checks live inside the database itself — you can't "forget" them in some controller, because there essentially are no controllers. A banned user won't read messages even through an API hole: the database simply won't return the rows.

**Realtime.** Instead of a WebSocket server and Redis pub/sub, we subscribe to `postgres_changes` on the messages, reactions, and votes tables. Your neighbour sees your message, your like, and the poll result instantly — it's just a reflection of changes in the DB.

**Files, push, search, background jobs.** Images go to Storage (private bucket + signed URLs). Push is Web Push with VAPID: DB triggers enqueue jobs into a queue table, and `pg_cron` wakes an Edge Function every 10 seconds to send them. Full-text search is a `tsvector` with a Russian dictionary and a GIN index — no Elasticsearch. Not a single extra service.

## The app is a PWA, not a "native"

The second observation: a product like this doesn't need a separate mobile app or a trip to the App Store/Google Play. A Progressive Web App (PWA) covers almost everything: push notifications, a home-screen icon, an unread-count badge on that icon, an offline shell, WebSockets. Residents add the chat "to their phone" in two taps, and we maintain one codebase instead of three (web + iOS + Android).

## What about vendor lock-in?

None. The exact same code runs both in the cloud (Supabase Cloud + Vercel) and on your own server. We started in the cloud, but in Russia `*.supabase.co` and `*.vercel.app` get blocked from time to time — so we moved to a single VPS in Novosibirsk under a `.ru` domain. The whole stack — Postgres, Auth, Realtime, Storage, functions, Next.js, TLS — is containers in one `docker-compose.yml`. We can swap the provider, the Postgres version, or the file storage whenever we want.

CI/CD is up to you: a full GitHub Actions pipeline, or what we did — `ssh` in and run `bash deploy.sh` (`git pull`, apply migrations, rebuild Next.js on the VPS). Five seconds of downtime, no external build services.

## What's left — and who does it

Once you remove the backend, the infrastructure, and the vendor lock-in, what remains is the essential thing: **UI and UX** — and that's the easiest thing to phrase in plain human language, even for a non-engineer. All of kv12chat was built in tandem with an AI assistant: the human says "make the map zoomable — search on top, results below it, the map under that," and the assistant writes the code. Interface requirements are prose, not tickets describing SQL joins.

The result is a shift in the project's center of gravity. The backend and infrastructure used to eat the lion's share of the time; now they're ready-made blocks, and the energy goes where the user actually sees it.

## A beautiful paradox

If you think about it, there's an almost philosophical irony in all this. For decades backend developers did their job so well — designing authentication, access models, replication, queues, realtime — that at some point they perfected it and packaged it into ready-made tools and frameworks. And in doing so they largely worked themselves out of a job: everything routine is already built, you just take it and use it. This isn't a devaluation of the profession — it's its highest form, work polished to the point where it no longer needs repeating. What used to be the heart of a project has become the foundation you don't even look at.

## The bottom line

kv12chat is live: residents chat in real time, leave likes, argue in discussions, launch polls, drop photos, find neighbours on the map, and get push notifications. Behind all of it there isn't a single hand-written backend service. If you're building a typical product, try starting not with "which backend framework should I pick" but with "do I even need one?" The answer is often no.
