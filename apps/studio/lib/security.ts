/**
 * Security headers for tenant sites (free-form HTML/CSS/JS).
 *
 * The real isolation between tenants is the per-tenant ORIGIN (each site on its own
 * subdomain) plus host-only auth cookies (the Studio session cookie has no Domain, so
 * it is never sent to a tenant subdomain). These headers add defense-in-depth:
 *
 * - CSP is intentionally PERMISSIVE for resources (sites legitimately use inline
 *   styles/scripts, data: URIs, and external https assets — a fixed allowlist would
 *   break free-form sites). It still locks `frame-ancestors` (anti-clickjacking) and
 *   `base-uri` (anti base-tag hijack). Malicious *intent* is handled by abuse
 *   moderation + tenant suspension, not by CSP — see infra/README.md.
 */
export const PUBLISHED_SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; " +
    "frame-ancestors 'self'; base-uri 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "SAMEORIGIN",
};

/** Merge security headers onto a content-type + cache header set. */
export function withSecurityHeaders(headers: Record<string, string>): Record<string, string> {
  return { ...PUBLISHED_SECURITY_HEADERS, ...headers };
}
