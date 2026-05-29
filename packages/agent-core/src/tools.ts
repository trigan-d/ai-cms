import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolSchema } from "./types.js";
import { Sandbox } from "./sandbox.js";
import { TenantRepo } from "./tenant-repo.js";

export interface ToolEvent {
  tool: string;
  args: unknown;
  result: string;
  ok: boolean;
}

export interface ToolContext {
  sandbox: Sandbox;
  repo: TenantRepo;
  /** Called after every tool execution — used by Studio to refresh preview, by spike to log. */
  onEvent?: (e: ToolEvent) => void;
}

const MAX_READ_BYTES = 256 * 1024;
const IGNORE_DIRS = new Set([".git", "node_modules"]);

/** JSON-Schema definitions advertised to the model. */
export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "fs_list",
    description:
      "List the files of the site (recursively). Use this first to understand the site structure.",
    parameters: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Subdirectory to list. Defaults to the site root." },
      },
    },
  },
  {
    name: "fs_read",
    description: "Read a text file from the site and return its full contents.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative file path." } },
      required: ["path"],
    },
  },
  {
    name: "fs_write",
    description:
      "Create or fully overwrite a text file with new contents. Use for new files or large rewrites.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path." },
        content: { type: "string", description: "Full new file contents." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "fs_edit",
    description:
      "Replace an exact substring in a file. Prefer this for small, targeted edits. " +
      "old_string must match exactly and uniquely unless replace_all is true.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path." },
        old_string: { type: "string", description: "Exact text to find." },
        new_string: { type: "string", description: "Replacement text." },
        replace_all: { type: "boolean", description: "Replace every occurrence (default false)." },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "list_history",
    description: "List recent versions (git commits) of the site, newest first.",
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "Max entries (default 20)." } },
    },
  },
  {
    name: "publish",
    description:
      "Publish the current draft to the live site. ONLY call this when the user explicitly " +
      "confirms (e.g. says 'заливай' / 'publish' / 'confirm').",
    parameters: {
      type: "object",
      properties: { message: { type: "string", description: "Short summary of the change." } },
    },
  },
  {
    name: "revert",
    description:
      "Undo changes. target='draft' discards uncommitted draft edits (back to last version). " +
      "A commit hash rolls the site back to that past version. ONLY call when the user asks to undo.",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "'draft' to discard current edits, or a commit hash to roll back to.",
        },
      },
    },
  },
];

// Models frequently send booleans/numbers as strings ("false", "20"). Coerce leniently
// so a tool call isn't rejected on a type technicality.
const looseBool = z.preprocess((v) => {
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no" || s === "") return false;
  }
  return v;
}, z.boolean());

const looseNumber = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v),
  z.number(),
);

const argSchemas = {
  fs_list: z.object({ dir: z.string().optional() }),
  fs_read: z.object({ path: z.string() }),
  fs_write: z.object({ path: z.string(), content: z.string() }),
  fs_edit: z.object({
    path: z.string(),
    old_string: z.string(),
    new_string: z.string(),
    replace_all: looseBool.optional(),
  }),
  list_history: z.object({ limit: looseNumber.optional() }),
  publish: z.object({ message: z.string().optional() }),
  revert: z.object({ target: z.string().optional() }),
} as const;

/**
 * Build the tool executor bound to one tenant's sandbox + repo.
 * Returns the schemas (for the model) and an `execute(name, argsJson)` function.
 */
export function createTools(ctx: ToolContext): {
  schemas: ToolSchema[];
  execute: (name: string, argsJson: string) => Promise<string>;
} {
  async function run(name: string, argsJson: string): Promise<string> {
    let parsed: unknown;
    try {
      parsed = argsJson.trim() ? JSON.parse(argsJson) : {};
    } catch {
      return `ERROR: arguments were not valid JSON: ${argsJson}`;
    }

    switch (name) {
      case "fs_list": {
        const { dir } = argSchemas.fs_list.parse(parsed);
        const base = ctx.sandbox.resolve(dir && dir !== "." ? dir : ".");
        const files = await listFiles(base, ctx.sandbox.root);
        return files.length ? files.join("\n") : "(empty)";
      }
      case "fs_read": {
        const { path: p } = argSchemas.fs_read.parse(parsed);
        const abs = ctx.sandbox.resolve(p);
        const stat = await fs.stat(abs);
        if (stat.size > MAX_READ_BYTES) {
          return `ERROR: file too large to read (${stat.size} bytes)`;
        }
        return await fs.readFile(abs, "utf8");
      }
      case "fs_write": {
        const { path: p, content } = argSchemas.fs_write.parse(parsed);
        const abs = ctx.sandbox.resolve(p);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, "utf8");
        return `OK: wrote ${p} (${Buffer.byteLength(content)} bytes)`;
      }
      case "fs_edit": {
        const { path: p, old_string, new_string, replace_all } =
          argSchemas.fs_edit.parse(parsed);
        const abs = ctx.sandbox.resolve(p);
        const original = await fs.readFile(abs, "utf8");
        const count = countOccurrences(original, old_string);
        if (count === 0) return `ERROR: old_string not found in ${p}`;
        if (count > 1 && !replace_all) {
          return `ERROR: old_string is not unique in ${p} (${count} matches). Set replace_all or add more context.`;
        }
        const updated = replace_all
          ? original.split(old_string).join(new_string)
          : original.replace(old_string, new_string);
        await fs.writeFile(abs, updated, "utf8");
        return `OK: edited ${p} (${count} replacement${count > 1 ? "s" : ""})`;
      }
      case "list_history": {
        const { limit } = argSchemas.list_history.parse(parsed);
        const commits = await ctx.repo.log(limit ?? 20);
        return commits
          .map((c) => `${c.hash.slice(0, 8)}  ${c.date}  ${c.subject}`)
          .join("\n");
      }
      case "publish": {
        const { message } = argSchemas.publish.parse(parsed);
        const res = await ctx.repo.publish(message ?? "Publish via agent");
        return `OK: published commit ${res.commit.slice(0, 8)} to ${res.deployedTo}`;
      }
      case "revert": {
        const { target } = argSchemas.revert.parse(parsed);
        if (!target || target === "draft") {
          await ctx.repo.revertDraft();
          return "OK: discarded uncommitted draft changes";
        }
        const hash = await ctx.repo.rollbackTo(target);
        return `OK: rolled back; new head ${hash.slice(0, 8)}`;
      }
      default:
        return `ERROR: unknown tool '${name}'`;
    }
  }

  async function execute(name: string, argsJson: string): Promise<string> {
    let result: string;
    let ok = true;
    try {
      result = await run(name, argsJson);
      ok = !result.startsWith("ERROR");
    } catch (err) {
      ok = false;
      result = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
    ctx.onEvent?.({ tool: name, args: safeParse(argsJson), result, ok });
    return result;
  }

  return { schemas: TOOL_SCHEMAS, execute };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

async function listFiles(base: string, root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        out.push(path.relative(root, abs));
      }
    }
  }
  await walk(base);
  return out.sort();
}
