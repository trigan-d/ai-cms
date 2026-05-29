"use client";
import { createBrowserClient } from "@supabase/ssr";

// Fix the cookie name explicitly so it does not depend on the URL hostname
// (kv12chat lesson: @supabase/ssr otherwise derives it from the host and the
// server/browser names diverge → session not found). Keep identical in
// server.ts and proxy.ts.
const COOKIE_NAME = "sb-ai-cms-auth-token";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { name: COOKIE_NAME } },
  );
}
