import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnedTenant } from "@/lib/tenant";
import { verifyDomainPointsHere } from "@/lib/domain-verify";

export const runtime = "nodejs";

const HOST_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** List custom domains for a tenant the user owns. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const tenant = await getOwnedTenant(id);
  if (!tenant) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const supabase = await createClient();
  const { data } = await supabase
    .from("tenant_domains")
    .select("id, host, verified, created_at")
    .eq("tenant_id", id)
    .order("created_at", { ascending: true });
  return NextResponse.json({ domains: data ?? [] });
}

/** Attach a custom domain to the tenant, then attempt DNS verification. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const tenant = await getOwnedTenant(id);
  if (!tenant) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const { host } = (await req.json().catch(() => ({}))) as { host?: string };
  const h = host?.trim().toLowerCase().replace(/\.$/, "");
  if (!h || !HOST_RE.test(h)) {
    return NextResponse.json({ error: "Некорректный домен." }, { status: 400 });
  }
  if (h.endsWith(".platform.ru") || h === "platform.ru") {
    return NextResponse.json({ error: "Это домен платформы." }, { status: 400 });
  }

  // Insert under the owner's RLS (owns the tenant).
  const supabase = await createClient();
  const { error } = await supabase.from("tenant_domains").insert({ tenant_id: id, host: h });
  if (error) {
    const taken = error.code === "23505" || /duplicate|unique/i.test(error.message);
    return NextResponse.json(
      { error: taken ? "Домен уже привязан." : error.message },
      { status: taken ? 409 : 500 },
    );
  }

  // Verify DNS points here; flip verified via service role (bypasses RLS).
  const verified = await verifyDomainPointsHere(h);
  if (verified) {
    await createAdminClient().from("tenant_domains").update({ verified: true }).eq("host", h);
  }

  return NextResponse.json({
    host: h,
    verified,
    hint: verified
      ? "Домен подтверждён — TLS-сертификат выпустится автоматически при первом заходе."
      : "Домен добавлен. Направьте на платформу (CNAME/A) и нажмите «Проверить».",
  });
}
