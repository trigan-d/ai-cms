import { NextResponse } from "next/server";
import { getOwnedTenant, getTenantRuntime } from "@/lib/tenant";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const tenant = await getOwnedTenant(id);
  if (!tenant) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const { repo } = await getTenantRuntime(tenant.id, tenant.subdomain);
  try {
    const res = await repo.publish("Publish from Studio");
    return NextResponse.json({ ok: true, commit: res.commit, deployedTo: res.deployedTo });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
