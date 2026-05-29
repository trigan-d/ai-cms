import fs from "node:fs/promises";
import path from "node:path";
import { getOwnedTenant, getTenantRuntime } from "@/lib/tenant";
import { withSecurityHeaders } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** Serve the DRAFT working tree of a tenant the current user owns (no-store). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; path?: string[] }> },
) {
  const { id, path: segments } = await ctx.params;
  const tenant = await getOwnedTenant(id);
  if (!tenant) return new Response("Not found", { status: 404 });

  const { sandbox } = await getTenantRuntime(tenant.id, tenant.subdomain);
  let rel = (segments ?? []).join("/");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";

  let abs: string;
  try {
    abs = sandbox.resolve(rel);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    const body = await fs.readFile(abs);
    return new Response(new Uint8Array(body), {
      headers: withSecurityHeaders({
        "content-type": TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-store",
      }),
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
