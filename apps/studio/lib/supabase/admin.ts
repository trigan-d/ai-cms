import { createClient } from "@supabase/supabase-js";

/** Service-role client. Server-only. Bypasses RLS — use sparingly. */
export function createAdminClient() {
  return createClient(
    process.env.SUPABASE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
