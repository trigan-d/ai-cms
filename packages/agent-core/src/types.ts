/**
 * Core message/tool types for the editing agent.
 *
 * These mirror the OpenAI chat-completions tool-calling shape closely enough that
 * any OpenAI-compatible endpoint (vLLM, Ollama, hosted) can drive the loop, while
 * staying provider-neutral so we can later swap in a self-hosted fine-tuned model.
 */

export type Role = "system" | "user" | "assistant" | "tool";

/** A single tool/function call requested by the model. `arguments` is a raw JSON string. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatMessage {
  role: Role;
  /** Text content. May be empty when the assistant turn only contains tool calls. */
  content: string;
  /** Present on assistant turns that request tools. */
  tool_calls?: ToolCall[];
  /** Present on `tool` messages: which call this result answers. */
  tool_call_id?: string;
  /** Present on `tool` messages: the tool name (some backends require it). */
  name?: string;
}

/** JSON-Schema-described tool exposed to the model. */
export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema object for the tool arguments. */
  parameters: Record<string, unknown>;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
}

export interface LLMResponse {
  /** Final assistant text for this turn (may be null when only tool calls are returned). */
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
  usage?: TokenUsage;
}

export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  toolChoice?: "auto" | "required" | "none";
  temperature?: number;
}

/** Provider-neutral LLM interface. One implementation per backend. */
export interface LLMProvider {
  readonly name: string;
  chat(req: ChatRequest): Promise<LLMResponse>;
}
