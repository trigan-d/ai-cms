import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Caddy on-demand TLS `ask` endpoint (R5). Caddy calls this before issuing a cert for
 * a custom domain: GET /api/tls/allowed?domain=<host>. We return 200 ONLY for a
 * verified custom domain, else 403 — this prevents cert issuance for arbitrary hosts.
 *
 * Must be public (no auth) — whitelisted in proxy.ts.
 */
export async function GET(req: Request) {
  const host = new URL(req.url).searchParams.get("domain")?.toLowerCase().trim();
  if (!host) return new Response("missing domain", { status: 400 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("tenant_domains")
    .select("verified")
    .eq("host", host)
    .eq("verified", true)
    .maybeSingle();

  return data ? new Response("ok", { status: 200 }) : new Response("not allowed", { status: 403 });
}
