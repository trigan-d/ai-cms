import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Must match lib/supabase/client.ts and server.ts — see comment there.
const COOKIE_NAME = "sb-ai-cms-auth-token";

// Public (no auth): auth pages + the Caddy on-demand TLS ask endpoint.
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/api/auth/logout",
  "/api/tls/allowed",
  "/demo", // scripted demo walkthrough (for the promo recording)
  "/demo-stages", // static stage pages used by the demo preview
];

const BASE = process.env.PLATFORM_BASE_DOMAIN || "platform.ru";
const SUFFIXES = [".localhost", "." + BASE];
// First labels that mean "the Studio app itself", not a tenant.
const APP_LABELS = new Set(["www", "app", "studio", "api", "admin"]);

/** A platform tenant subdomain (acme.platform.ru / acme.localhost), or null. */
function platformSubdomain(hostname: string): string | null {
  const host = hostname.split(":")[0]!;
  for (const suffix of SUFFIXES) {
    if (host.endsWith(suffix)) {
      const rem = host.slice(0, -suffix.length);
      if (!rem || rem.includes(".")) return null; // apex or nested
      return APP_LABELS.has(rem) ? null : rem;
    }
  }
  return null;
}

/** True when the host is the Studio app (apex / app / api / localhost), not a tenant site. */
function isAppHost(hostname: string): boolean {
  const host = hostname.split(":")[0]!;
  if (host === "localhost" || host === "127.0.0.1" || host === BASE) return true;
  for (const suffix of SUFFIXES) {
    if (host.endsWith(suffix)) {
      const rem = host.slice(0, -suffix.length);
      return !rem.includes(".") && APP_LABELS.has(rem);
    }
  }
  return false;
}

// Custom-domain → subdomain resolution (service role via PostgREST), briefly cached.
const domainCache = new Map<string, { sub: string | null; at: number }>();
const DOMAIN_TTL_MS = 30_000;

async function resolveCustomDomain(host: string): Promise<string | null> {
  const cached = domainCache.get(host);
  if (cached && Date.now() - cached.at < DOMAIN_TTL_MS) return cached.sub;

  const url = process.env.SUPABASE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let sub: string | null = null;
  if (url && key) {
    try {
      const q = `${url}/rest/v1/tenant_domains?host=eq.${encodeURIComponent(host)}&verified=eq.true&select=tenants(subdomain)`;
      const res = await fetch(q, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (res.ok) {
        const rows = (await res.json()) as Array<{ tenants?: { subdomain?: string } }>;
        sub = rows[0]?.tenants?.subdomain ?? null;
      }
    } catch {
      /* network/db hiccup → treat as unknown */
    }
  }
  domainCache.set(host, { sub, at: Date.now() });
  return sub;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const host = req.headers.get("host") ?? "";

  // 1) Platform tenant subdomain → serve its published site.
  const sub = platformSubdomain(host);
  if (sub) return rewriteToPublished(req, sub, pathname);

  // 2) Custom domain (not the Studio app, not a *.platform.ru subdomain).
  if (!isAppHost(host)) {
    const csub = await resolveCustomDomain(host);
    if (csub) return rewriteToPublished(req, csub, pathname);
    return new NextResponse("Unknown host", { status: 404 });
  }

  // 3) Studio app → auth gate.
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request: req });
  const supabase = createServerClient(
    process.env.SUPABASE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: COOKIE_NAME },
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          response = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

function rewriteToPublished(req: NextRequest, sub: string, pathname: string): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = `/published/${sub}${pathname === "/" ? "/index.html" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
