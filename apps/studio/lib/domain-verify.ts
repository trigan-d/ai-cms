import dns from "node:dns/promises";

/**
 * Best-effort ownership check for a custom domain: does it point at our platform?
 * Compares CNAME against CUSTOM_DOMAIN_CNAME and/or A records against PLATFORM_IP.
 * If neither env is set, verification can't be confirmed → returns false (stays pending).
 */
export async function verifyDomainPointsHere(host: string): Promise<boolean> {
  const cname = process.env.CUSTOM_DOMAIN_CNAME?.toLowerCase().replace(/\.$/, "");
  const ip = process.env.PLATFORM_IP;
  if (cname) {
    const recs = await dns.resolveCname(host).catch(() => [] as string[]);
    if (recs.some((c) => c.toLowerCase().replace(/\.$/, "") === cname)) return true;
  }
  if (ip) {
    const a = await dns.resolve4(host).catch(() => [] as string[]);
    if (a.includes(ip)) return true;
  }
  return false;
}
