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
  type ChatMessage,
} from "@ai-cms/agent-core";
import { loadDotenv, REPO_ROOT, TEMPLATE_DIR } from "./env.js";

/**
 * Diagnostic: run ONE agent turn on a fresh tenant and print every tool call + result,
 * then list the resulting files. Used to see exactly how the model handles a request.
 *
 * Usage: tsx src/diag.ts "your prompt here"
 */
async function main() {
  loadDotenv();
  const provider = OpenAICompatibleProvider.fromEnv();
  const prompt =
    process.argv[2] ??
    "Создай отдельную страницу «Контакты» в файле contacts.html (адрес и телефон) и добавь ссылку на неё в меню на главной странице index.html.";

  const work = path.join(REPO_ROOT, "data", ".scratch", "diag");
  await fsp.rm(work, { recursive: true, force: true });
  const repo = await TenantRepo.initFromTemplate(work, TEMPLATE_DIR);
  const sandbox = new Sandbox(work);
  const { schemas, execute } = createTools({ sandbox, repo });

  console.log(`Model: ${provider.name}`);
  console.log(`Prompt: ${prompt}\n`);

  const history: ChatMessage[] = [{ role: "user", content: prompt }];
  const system = DEFAULT_SYSTEM_PROMPT + "\n\n" + (await buildSiteContext(sandbox));

  const res = await runAgentTurn({
    provider,
    system,
    history,
    tools: schemas,
    execute,
    onEvent: (e) => {
      if (e.type === "tool_call") {
        console.log(`\n→ TOOL ${e.name}`);
        console.log(`  args: ${truncate(e.arguments, 300)}`);
      } else if (e.type === "tool_result") {
        console.log(`  ${e.ok ? "✓" : "✗"} ${truncate(e.result, 200)}`);
      } else if (e.type === "assistant_text") {
        console.log(`\n[assistant text] ${truncate(e.text, 300)}`);
      }
    },
  });

  console.log(`\n=== final text ===\n${res.finalText}`);
  console.log(`\n=== files after turn ===`);
  console.log(await execute("fs_list", "{}"));
}

function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
