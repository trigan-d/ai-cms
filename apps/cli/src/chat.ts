import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  OpenAICompatibleProvider,
  Sandbox,
  TenantRepo,
  createTools,
  runAgentTurn,
  buildSiteContext,
  DEFAULT_SYSTEM_PROMPT,
  type ChatMessage,
} from "@ai-cms/agent-core";
import { loadDotenv, resolveFromRoot, TEMPLATE_DIR } from "./env.js";

/**
 * Interactive REPL that drives the editing agent against a single scratch tenant.
 * Lets you exercise the full loop locally before there is any Studio UI.
 */
async function main() {
  loadDotenv();
  const provider = OpenAICompatibleProvider.fromEnv();

  const tenantsRoot = resolveFromRoot(process.env.TENANTS_ROOT ?? "./data/tenants");
  const sitesRoot = resolveFromRoot(process.env.SITES_ROOT ?? "./data/sites");
  const workdir = path.join(tenantsRoot, "cli-demo");
  const publishDir = path.join(sitesRoot, "cli-demo");

  let repo: TenantRepo;
  if (fs.existsSync(path.join(workdir, ".git"))) {
    repo = TenantRepo.open(workdir, publishDir);
    console.log(`Reusing tenant at ${workdir}`);
  } else {
    repo = await TenantRepo.initFromTemplate(workdir, TEMPLATE_DIR, publishDir);
    console.log(`Created tenant from template at ${workdir}`);
  }

  const sandbox = new Sandbox(workdir);
  const { schemas, execute } = createTools({ sandbox, repo });

  console.log(`Model: ${provider.name}`);
  console.log(
    "Type a request (e.g. «сделай фон тёмным и добавь пункт меню Контакты»).\n" +
      "Commands: /files, /log, /reset, /exit\n",
  );

  let history: ChatMessage[] = [];
  const rl = readline.createInterface({ input: stdin, output: stdout });

  for (;;) {
    const input = (await rl.question("you › ")).trim();
    if (!input) continue;
    if (input === "/exit") break;
    if (input === "/reset") {
      history = [];
      console.log("(history cleared)\n");
      continue;
    }
    if (input === "/files") {
      console.log(await execute("fs_list", "{}"), "\n");
      continue;
    }
    if (input === "/log") {
      console.log(await execute("list_history", "{}"), "\n");
      continue;
    }

    history.push({ role: "user", content: input });
    try {
      const system = DEFAULT_SYSTEM_PROMPT + "\n\n" + (await buildSiteContext(sandbox));
      const result = await runAgentTurn({
        provider,
        system,
        history,
        tools: schemas,
        execute,
        onEvent: (e) => {
          if (e.type === "tool_call") console.log(`  · ${e.name}(${truncate(e.arguments)})`);
          else if (e.type === "tool_result")
            console.log(`    ${e.ok ? "✓" : "✗"} ${truncate(e.result, 120)}`);
        },
      });
      history = result.history;
      console.log(`\nai  › ${result.finalText}\n`);
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  rl.close();
}

function truncate(s: string, n = 80): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > n ? oneLine.slice(0, n) + "…" : oneLine;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
