import { NextResponse } from "next/server";
import { getOwnedTenant, getTenantRuntime } from "@/lib/tenant";

export const runtime = "nodejs";

interface RevertBody {
  target?: string;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const tenant = await getOwnedTenant(id);
  if (!tenant) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const { target } = (await req.json().catch(() => ({}))) as RevertBody;
  const { repo } = await getTenantRuntime(tenant.id, tenant.subdomain);
  try {
    if (!target || target === "draft") {
      await repo.revertDraft();
      return NextResponse.json({ ok: true, action: "discarded draft changes" });
    }
    const head = await repo.rollbackTo(target);
    return NextResponse.json({ ok: true, action: "rolled back", head });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
