import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  OpenAICompatibleProvider,
  Sandbox,
  TenantRepo,
  createTools,
  runAgentTurn,
  buildSiteContext,
  DEFAULT_SYSTEM_PROMPT,
  git,
  type ChatMessage,
} from "@ai-cms/agent-core";
import { loadDotenv, resolveFromRoot, REPO_ROOT, TEMPLATE_DIR } from "./env.js";

/**
 * Phase-0 spike harness (the gate before further work).
 *
 * For each Siberian-Motorbears-style request it provisions a fresh tenant from the
 * template, runs ONE agent turn, then checks the resulting files with lenient smoke
 * assertions and prints the git diff for human review. Reports an auto success rate.
 */

interface Expect {
  path: string;
  includesAny?: string[];
  regex?: string;
  absent?: string;
}
interface Task {
  id: string;
  prompt: string;
  manual?: boolean;
  expect?: Expect[];
}

async function main() {
  loadDotenv();
  const provider = OpenAICompatibleProvider.fromEnv();

  const tasksFile = resolveFromRoot("eval/tasks.json");
  const { tasks } = JSON.parse(fs.readFileSync(tasksFile, "utf8")) as { tasks: Task[] };

  const scratch = path.join(REPO_ROOT, "data", ".scratch", "spike");
  await fsp.rm(scratch, { recursive: true, force: true });
  await fsp.mkdir(scratch, { recursive: true });

  console.log(`Spike — model: ${provider.name}, tasks: ${tasks.length}\n`);

  let autoTotal = 0;
  let autoPassed = 0;
  const manual: string[] = [];

  for (const task of tasks) {
    const workdir = path.join(scratch, task.id);
    const repo = await TenantRepo.initFromTemplate(workdir, TEMPLATE_DIR);
    const sandbox = new Sandbox(workdir);
    const { schemas, execute } = createTools({ sandbox, repo });

    const history: ChatMessage[] = [{ role: "user", content: task.prompt }];
    const system = DEFAULT_SYSTEM_PROMPT + "\n\n" + (await buildSiteContext(sandbox));
    let toolCalls = 0;
    let error: string | undefined;
    let finalText = "";
    try {
      const res = await runAgentTurn({
        provider,
        system,
        history,
        tools: schemas,
        execute,
        onEvent: (e) => {
          if (e.type === "tool_call") toolCalls++;
        },
      });
      finalText = res.finalText;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const diff = await safeDiff(workdir);
    const diffStat = countDiff(diff);
    const changed = diff.trim().length > 0;

    if (error) {
      console.log(`✗ ${task.id} — ERROR: ${error}`);
      if (!task.manual) {
        autoTotal++;
      }
      continue;
    }

    if (task.manual) {
      manual.push(task.id);
      console.log(`~ ${task.id} [manual] — ${toolCalls} tool calls, ${diffStat}`);
      console.log(indent(diff || "(no changes)"));
      console.log("");
      continue;
    }

    autoTotal++;
    const failures = changed
      ? await checkExpects(workdir, task.expect ?? [])
      : ["no changes made (model did not edit any file)"];
    if (failures.length === 0) {
      autoPassed++;
      console.log(`✓ ${task.id} — ${toolCalls} tool calls, ${diffStat}`);
    } else {
      console.log(`✗ ${task.id} — ${failures.join("; ")}`);
      if (!changed && finalText) console.log(indent(`model said: ${finalText}`));
      else console.log(indent(diff || "(no changes)"));
      console.log("");
    }
  }

  const rate = autoTotal ? Math.round((autoPassed / autoTotal) * 100) : 0;
  console.log("\n──────────────────────────────");
  console.log(`Auto-scored: ${autoPassed}/${autoTotal} passed (${rate}%)`);
  if (manual.length) {
    console.log(`Manual review needed: ${manual.join(", ")}`);
  }
  console.log(`Scratch tenants kept at: ${scratch}`);
}

async function checkExpects(workdir: string, expects: Expect[]): Promise<string[]> {
  const failures: string[] = [];
  for (const e of expects) {
    const abs = path.join(workdir, e.path);
    let content: string;
    try {
      content = await fsp.readFile(abs, "utf8");
    } catch {
      failures.push(`${e.path} missing`);
      continue;
    }
    const lower = content.toLowerCase();
    if (e.includesAny && !e.includesAny.some((s) => lower.includes(s.toLowerCase()))) {
      failures.push(`${e.path} lacks any of [${e.includesAny.join(", ")}]`);
    }
    if (e.regex && !new RegExp(e.regex, "i").test(content)) {
      failures.push(`${e.path} doesn't match /${e.regex}/i`);
    }
    if (e.absent && lower.includes(e.absent.toLowerCase())) {
      failures.push(`${e.path} still contains "${e.absent}"`);
    }
  }
  return failures;
}

async function safeDiff(workdir: string): Promise<string> {
  try {
    const { stdout } = await git(workdir, ["diff", "--stat", "HEAD"]);
    const { stdout: full } = await git(workdir, ["diff", "HEAD"]);
    return (stdout + "\n" + full).trim();
  } catch {
    return "";
  }
}

function countDiff(diff: string): string {
  const m = diff.match(/(\d+) insertion.*?(\d+) deletion/);
  if (m) return `+${m[1]}/-${m[2]}`;
  const files = diff.split("\n").filter((l) => l.includes("|")).length;
  return files ? `${files} file(s) changed` : "no changes";
}

function indent(s: string): string {
  return s
    .split("\n")
    .slice(0, 60)
    .map((l) => "    " + l)
    .join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
