import { notFound } from "next/navigation";
import { getOwnedTenant } from "@/lib/tenant";
import { Editor } from "./Editor";

export const dynamic = "force-dynamic";

export default async function SiteEditorPage(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const tenant = await getOwnedTenant(id);
  if (!tenant) notFound();
  return <Editor tenantId={tenant.id} subdomain={tenant.subdomain} title={tenant.title} />;
}
