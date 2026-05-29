import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  OpenAICompatibleProvider,
  Sandbox,
  TenantRepo,
  createTools,
  type LLMProvider,
  type ToolSchema,
} from "@ai-cms/agent-core";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");
// Overridable for containers (where cwd differs from the monorepo layout).
const TEMPLATE_DIR = process.env.TEMPLATE_DIR ?? path.join(REPO_ROOT, "templates", "starter");

/** Subdomains we never hand out to clients. */
export const RESERVED_SUBDOMAINS = new Set([
  "www", "app", "api", "studio", "admin", "preview", "static", "assets", "mail",
]);

/** Load LLM_* / *_ROOT vars from the repo-root .env (Next only reads app-local env). */
function loadRootEnv(): void {
  const envPath = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function tenantsRoot(): string {
  loadRootEnv();
  return resolveFromRoot(process.env.TENANTS_ROOT ?? "./data/tenants");
}
function sitesRoot(): string {
  loadRootEnv();
  return resolveFromRoot(process.env.SITES_ROOT ?? "./data/sites");
}
function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
}

let providerSingleton: LLMProvider | null = null;
function getProvider(): LLMProvider {
  loadRootEnv();
  if (!providerSingleton) providerSingleton = OpenAICompatibleProvider.fromEnv();
  return providerSingleton;
}

export interface TenantRuntime {
  repo: TenantRepo;
  sandbox: Sandbox;
  provider: LLMProvider;
  schemas: ToolSchema[];
  execute: (name: string, argsJson: string) => Promise<string>;
  workdir: string;
}

const cache = new Map<string, TenantRuntime>();

/** Initialize a fresh git repo for a tenant from the starter template (once). */
export async function provisionTenant(tenantId: string, subdomain: string): Promise<void> {
  const workdir = path.join(tenantsRoot(), tenantId);
  if (fs.existsSync(path.join(workdir, ".git"))) return;
  const publishDir = path.join(sitesRoot(), subdomain);
  await TenantRepo.initFromTemplate(workdir, TEMPLATE_DIR, publishDir);
}

/** Get (or lazily open/create) the editing runtime for one tenant's site. */
export async function getTenantRuntime(
  tenantId: string,
  subdomain: string,
): Promise<TenantRuntime> {
  const cached = cache.get(tenantId);
  if (cached) return cached;

  const workdir = path.join(tenantsRoot(), tenantId);
  const publishDir = path.join(sitesRoot(), subdomain);

  const repo = fs.existsSync(path.join(workdir, ".git"))
    ? TenantRepo.open(workdir, publishDir)
    : await TenantRepo.initFromTemplate(workdir, TEMPLATE_DIR, publishDir);

  const sandbox = new Sandbox(workdir);
  const { schemas, execute } = createTools({ sandbox, repo });
  const runtime: TenantRuntime = {
    repo,
    sandbox,
    provider: getProvider(),
    schemas,
    execute,
    workdir,
  };
  cache.set(tenantId, runtime);
  return runtime;
}

const PUBLISHED_TYPES: Record<string, string> = {
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

/** Read a file from a tenant's PUBLISHED directory (served on its subdomain). Public. */
export async function readPublishedFile(
  subdomain: string,
  relPath: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const dir = path.join(sitesRoot(), subdomain);
  if (!fs.existsSync(dir)) return null;
  let abs: string;
  try {
    abs = new Sandbox(dir).resolve(relPath);
  } catch {
    return null;
  }
  try {
    const body = await fsp.readFile(abs);
    return {
      body,
      contentType: PUBLISHED_TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

export interface PublicTenant {
  id: string;
  subdomain: string;
  title: string;
  status: string;
}

// Small TTL cache so serving an asset-heavy page doesn't hit the DB per request.
const tenantCache = new Map<string, { value: PublicTenant | null; at: number }>();
const TENANT_TTL_MS = 30_000;

/**
 * Resolve a tenant by subdomain using the service role (bypasses RLS — this is the
 * PUBLIC serving path, no logged-in user). Cached briefly. Returns null if unknown.
 */
export async function getTenantBySubdomain(subdomain: string): Promise<PublicTenant | null> {
  const cached = tenantCache.get(subdomain);
  if (cached && Date.now() - cached.at < TENANT_TTL_MS) return cached.value;

  const admin = createAdminClient();
  const { data } = await admin
    .from("tenants")
    .select("id, subdomain, title, status")
    .eq("subdomain", subdomain)
    .maybeSingle();
  const value = (data as PublicTenant) ?? null;
  tenantCache.set(subdomain, { value, at: Date.now() });
  return value;
}

export interface OwnedTenant {
  id: string;
  subdomain: string;
  title: string;
}

/**
 * Return the tenant with this id IF the current user owns it (RLS enforces ownership),
 * else null. Use in every tenant-scoped route/page as the authorization check.
 */
export async function getOwnedTenant(tenantId: string): Promise<OwnedTenant | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenants")
    .select("id, subdomain, title")
    .eq("id", tenantId)
    .maybeSingle();
  return (data as OwnedTenant) ?? null;
}
