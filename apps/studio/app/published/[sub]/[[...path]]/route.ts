import { getTenantBySubdomain, readPublishedFile } from "@/lib/tenant";
import { withSecurityHeaders } from "@/lib/security";
import { PWA_PATHS, isPwaPath, manifestJson, serviceWorkerJs, iconSvg, injectPwaTags } from "@/lib/pwa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve a tenant's PUBLISHED site. Reached via a proxy rewrite from
 * `<sub>.platform.ru/<path>` → `/published/<sub>/<path>`. Public, no auth.
 *
 * Also serves the platform PWA layer (manifest / service worker / icon) and injects
 * PWA tags into HTML so every tenant site is installable for free.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ sub: string; path?: string[] }> },
) {
  const { sub, path: segments } = await ctx.params;

  // Abuse / lifecycle: only serve active tenants (closes the suspended-tenant hook).
  const tenant = await getTenantBySubdomain(sub);
  if (!tenant || tenant.status !== "active") {
    return notFound();
  }

  let rel = (segments ?? []).join("/");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";

  // Platform-generated PWA assets (not tenant files).
  if (isPwaPath(rel)) {
    if (rel === PWA_PATHS.manifest) {
      return text(manifestJson(tenant.title || sub), "application/manifest+json");
    }
    if (rel === PWA_PATHS.sw) {
      return text(serviceWorkerJs(), "text/javascript; charset=utf-8");
    }
    return text(iconSvg(tenant.title || sub), "image/svg+xml");
  }

  const file = await readPublishedFile(sub, rel);
  if (!file) return notFound();

  // Inject PWA tags into HTML documents.
  const isHtml = file.contentType.startsWith("text/html");
  const body = isHtml ? Buffer.from(injectPwaTags(file.body.toString("utf8")), "utf8") : file.body;

  return new Response(new Uint8Array(body), {
    headers: withSecurityHeaders({
      "content-type": file.contentType,
      "cache-control": "no-store",
    }),
  });
}

function text(body: string, contentType: string): Response {
  return new Response(body, {
    headers: withSecurityHeaders({ "content-type": contentType, "cache-control": "no-store" }),
  });
}

function notFound(): Response {
  return new Response("Сайт не найден, не опубликован или приостановлен.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
