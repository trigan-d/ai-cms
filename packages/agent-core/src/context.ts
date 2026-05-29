import fs from "node:fs/promises";
import path from "node:path";
import { Sandbox } from "./sandbox.js";

const TEXT_EXT = new Set([
  ".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".txt", ".md",
]);
const IGNORE_DIRS = new Set([".git", "node_modules"]);

export interface SiteContextOptions {
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

/**
 * Build a context block describing the current site: the file tree plus the contents
 * of text files. Prepended to the system prompt so the agent doesn't have to guess file
 * paths and can match exact strings for fs_edit — this is the single biggest reliability
 * lever for weaker self-hosted models (they otherwise invent paths or mis-match edits).
 */
export async function buildSiteContext(
  sandbox: Sandbox,
  opts: SiteContextOptions = {},
): Promise<string> {
  const maxFile = opts.maxFileBytes ?? 8192;
  const maxTotal = opts.maxTotalBytes ?? 32768;

  const files = await listFiles(sandbox.root);
  const lines: string[] = [];
  lines.push(
    "Below is the CURRENT state of the website you are editing. You already have these " +
      "file contents — usually you can edit directly with fs_edit (matching the exact text " +
      "shown) without calling fs_read first.",
  );
  lines.push("\nFiles:");
  for (const f of files) lines.push(`- ${f}`);

  let total = lines.join("\n").length;
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!TEXT_EXT.has(ext)) continue;
    if (total > maxTotal) {
      lines.push("\n(remaining file contents omitted for brevity — use fs_read if needed)");
      break;
    }
    try {
      const content = await fs.readFile(sandbox.resolve(f), "utf8");
      const slice =
        content.length > maxFile ? content.slice(0, maxFile) + "\n…(truncated)" : content;
      const block = `\n--- ${f} ---\n${slice}`;
      lines.push(block);
      total += block.length;
    } catch {
      /* skip unreadable */
    }
  }
  return lines.join("\n");
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        out.push(path.relative(root, path.join(dir, entry.name)));
      }
    }
  }
  await walk(root);
  return out.sort();
}
