import { NextResponse } from "next/server";
import {
  runAgentTurn,
  buildSiteContext,
  DEFAULT_SYSTEM_PROMPT,
  type AgentEvent,
  type ChatMessage,
} from "@ai-cms/agent-core";
import { getOwnedTenant, getTenantRuntime } from "@/lib/tenant";

export const runtime = "nodejs";
export const maxDuration = 600;

interface ChatBody {
  history?: ChatMessage[];
  message: string;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const tenant = await getOwnedTenant(id);
  if (!tenant) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const { history = [], message } = (await req.json()) as ChatBody;
  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const { provider, schemas, execute, sandbox } = await getTenantRuntime(
    tenant.id,
    tenant.subdomain,
  );
  const events: AgentEvent[] = [];
  const turnHistory: ChatMessage[] = [...history, { role: "user", content: message }];
  const system = DEFAULT_SYSTEM_PROMPT + "\n\n" + (await buildSiteContext(sandbox));

  try {
    const result = await runAgentTurn({
      provider,
      system,
      history: turnHistory,
      tools: schemas,
      execute,
      onEvent: (e) => events.push(e),
    });
    return NextResponse.json({ history: result.history, finalText: result.finalText, events });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
