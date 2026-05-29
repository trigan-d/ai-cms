import OpenAI from "openai";
import type {
  ChatRequest,
  LLMProvider,
  LLMResponse,
  ChatMessage,
  ToolCall,
  ToolSchema,
} from "./types.js";
import { recoverToolCallsFromText } from "./tool-recovery.js";

export interface OpenAICompatibleOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  /** Friendly name for logs/telemetry. Defaults to the model id. */
  name?: string;
  defaultTemperature?: number;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
}

/**
 * Provider backed by any OpenAI-compatible chat-completions endpoint.
 *
 * Works against vLLM (`/v1`), Ollama (`/v1`), or a hosted gateway — selected purely
 * by `baseURL`/`apiKey`/`model`, so the rest of the system never hard-codes a vendor.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly defaultTemperature: number;

  constructor(opts: OpenAICompatibleOptions) {
    this.client = new OpenAI({
      baseURL: opts.baseURL,
      apiKey: opts.apiKey,
      timeout: opts.timeoutMs ?? 120_000,
    });
    this.model = opts.model;
    this.name = opts.name ?? opts.model;
    this.defaultTemperature = opts.defaultTemperature ?? 0.2;
  }

  /** Build a provider from environment variables (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL / LLM_TEMPERATURE). */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): OpenAICompatibleProvider {
    const baseURL = env.LLM_BASE_URL;
    const model = env.LLM_MODEL;
    if (!baseURL) throw new Error("LLM_BASE_URL is not set");
    if (!model) throw new Error("LLM_MODEL is not set");
    return new OpenAICompatibleProvider({
      baseURL,
      apiKey: env.LLM_API_KEY ?? "sk-no-key-required",
      model,
      defaultTemperature: env.LLM_TEMPERATURE ? Number(env.LLM_TEMPERATURE) : undefined,
    });
  }

  async chat(req: ChatRequest): Promise<LLMResponse> {
    const messages = toOpenAIMessages(req.system, req.messages);
    const tools = req.tools?.map(toOpenAITool);

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: req.temperature ?? this.defaultTemperature,
      ...(tools && tools.length > 0
        ? { tools, tool_choice: req.toolChoice ?? "auto" }
        : {}),
    });

    const choice = completion.choices[0];
    if (!choice) {
      return { content: null, toolCalls: [], finishReason: "empty" };
    }

    let toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
      .filter((tc) => tc.type === "function")
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments || "{}",
      }));

    let content = choice.message.content ?? null;

    // Fallback: some local models emit tool calls as text instead of the structured
    // field. Recover them so the agent can still act, and clear the textual remnant.
    if (toolCalls.length === 0 && content) {
      const recovered = recoverToolCallsFromText(content);
      if (recovered.length > 0) {
        toolCalls = recovered;
        content = null;
      }
    }

    return {
      content,
      toolCalls,
      finishReason: toolCalls.length > 0 ? "tool_calls" : (choice.finish_reason ?? "stop"),
      usage: completion.usage
        ? {
            prompt: completion.usage.prompt_tokens,
            completion: completion.usage.completion_tokens,
          }
        : undefined,
    };
  }
}

function toOpenAITool(t: ToolSchema): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  };
}

function toOpenAIMessages(
  system: string | undefined,
  messages: ChatMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (system) out.push({ role: "system", content: system });

  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });
    } else if (m.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: m.tool_call_id ?? "",
        content: m.content,
      });
    } else if (m.role === "system") {
      out.push({ role: "system", content: m.content });
    } else if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else {
      out.push({ role: "assistant", content: m.content });
    }
  }
  return out;
}
