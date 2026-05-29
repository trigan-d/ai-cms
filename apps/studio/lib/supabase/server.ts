import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Must match client.ts / proxy.ts — see comment in client.ts.
const COOKIE_NAME = "sb-ai-cms-auth-token";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.SUPABASE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: COOKIE_NAME },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll from a Server Component — proxy middleware refreshes instead
          }
        },
      },
    },
  );
}
