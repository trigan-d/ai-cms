import type { ChatMessage, LLMProvider, ToolSchema } from "./types.js";

export type AgentEvent =
  | { type: "assistant_text"; text: string }
  | { type: "tool_call"; name: string; arguments: string }
  | { type: "tool_result"; name: string; result: string; ok: boolean };

export interface RunAgentTurnOptions {
  provider: LLMProvider;
  system: string;
  /** Conversation so far, INCLUDING the latest user message. Not mutated. */
  history: ChatMessage[];
  tools: ToolSchema[];
  execute: (name: string, argsJson: string) => Promise<string>;
  /** Safety cap on tool round-trips per user turn. */
  maxSteps?: number;
  temperature?: number;
  onEvent?: (e: AgentEvent) => void;
}

export interface RunAgentTurnResult {
  /** New conversation history with assistant + tool messages appended. */
  history: ChatMessage[];
  /** The assistant's final natural-language reply for this turn. */
  finalText: string;
  steps: number;
}

/**
 * Run one user turn to completion: repeatedly call the model, execute any tool calls,
 * feed results back, until the model returns a plain text answer (or maxSteps is hit).
 */
export async function runAgentTurn(opts: RunAgentTurnOptions): Promise<RunAgentTurnResult> {
  const maxSteps = opts.maxSteps ?? 16;
  const history: ChatMessage[] = [...opts.history];
  let finalText = "";
  let steps = 0;

  for (; steps < maxSteps; steps++) {
    const res = await opts.provider.chat({
      system: opts.system,
      messages: history,
      tools: opts.tools,
      toolChoice: "auto",
      temperature: opts.temperature,
    });

    if (res.toolCalls.length === 0) {
      finalText = res.content ?? "";
      history.push({ role: "assistant", content: finalText });
      if (finalText) opts.onEvent?.({ type: "assistant_text", text: finalText });
      return { history, finalText, steps: steps + 1 };
    }

    // Assistant turn that requests tools — record it verbatim so the next call has context.
    history.push({
      role: "assistant",
      content: res.content ?? "",
      tool_calls: res.toolCalls,
    });
    if (res.content) opts.onEvent?.({ type: "assistant_text", text: res.content });

    for (const call of res.toolCalls) {
      opts.onEvent?.({ type: "tool_call", name: call.name, arguments: call.arguments });
      const result = await opts.execute(call.name, call.arguments);
      const ok = !result.startsWith("ERROR");
      opts.onEvent?.({ type: "tool_result", name: call.name, result, ok });
      history.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: result,
      });
    }
  }

  // Hit the step cap — surface a graceful message rather than looping forever.
  finalText =
    "Достигнут предел шагов на один запрос. Уточните задачу или разбейте её на части.";
  history.push({ role: "assistant", content: finalText });
  return { history, finalText, steps };
}
