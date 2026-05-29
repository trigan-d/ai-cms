import type { ToolCall } from "./types.js";

/**
 * Recover tool calls that a model emitted as TEXT instead of via the structured
 * `tool_calls` field.
 *
 * Small self-hosted models (our target) frequently "want" to call a tool but don't
 * follow the exact tool-call token format the backend parser expects. They produce
 * things like:
 *   {"function": fs_write, "arguments": {...}}        (note: unquoted name)
 *   <tool_call>{"name":"fs_edit","arguments":{...}}</tool_call>
 *   ```json\n{"name":"publish","arguments":{}}\n```
 *
 * This recovers those into proper ToolCall objects so the agent loop can still act.
 * It is intentionally lenient but conservative: it only emits a call when it finds a
 * recognizable name + arguments shape.
 */
export function recoverToolCallsFromText(content: string | null | undefined): ToolCall[] {
  if (!content) return [];

  const candidates = collectCandidates(content);
  const calls: ToolCall[] = [];

  for (const raw of candidates) {
    for (const obj of parseToolObjects(raw)) {
      const name = pickString(obj, ["name", "function", "tool", "tool_name"]);
      if (!name) continue;
      const argsValue = pickValue(obj, ["arguments", "parameters", "args", "input"]);
      const argsJson =
        argsValue === undefined
          ? "{}"
          : typeof argsValue === "string"
            ? argsValue
            : JSON.stringify(argsValue);
      calls.push({ id: `call_${calls.length + 1}`, name, arguments: argsJson });
    }
  }

  return dedupe(calls);
}

const TOOL_CALL_TAG = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
const FENCE = /```(?:json|tool_call|tool)?\s*([\s\S]*?)```/gi;

function collectCandidates(content: string): string[] {
  const out: string[] = [];

  let m: RegExpExecArray | null;
  TOOL_CALL_TAG.lastIndex = 0;
  while ((m = TOOL_CALL_TAG.exec(content))) out.push(m[1]!);
  if (out.length > 0) return out;

  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(content))) out.push(m[1]!);
  if (out.length > 0) return out;

  out.push(content.trim());
  return out;
}

function parseToolObjects(raw: string): Record<string, unknown>[] {
  const text = raw.trim();
  const out: Record<string, unknown>[] = [];

  const direct = lenientParse(text);
  if (direct !== null) {
    pushObjects(direct, out);
    if (out.length > 0) return out;
  }

  // Models often emit several tool-call objects back-to-back ({...}{...}) or embedded
  // in prose. Scan for every balanced top-level {...} span and parse each one.
  for (const span of scanBalancedObjects(text)) {
    const parsed = lenientParse(span);
    if (parsed !== null) pushObjects(parsed, out);
  }

  return out;
}

/** Return every balanced top-level `{...}` substring, respecting JSON strings/escapes. */
function scanBalancedObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let quote = "";
  let esc = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
    } else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          out.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}

function pushObjects(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const v of value) if (isObject(v)) out.push(v);
  } else if (isObject(value)) {
    out.push(value);
  }
}

function lenientParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    /* try repairs below */
  }
  // Quote unquoted identifier values for name/function/tool keys:
  //   "function": fs_write  ->  "function": "fs_write"
  const repaired = s.replace(
    /("(?:function|name|tool|tool_name)"\s*:\s*)([A-Za-z_][\w-]*)/g,
    '$1"$2"',
  );
  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickValue(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (k in obj) return obj[k];
  }
  return undefined;
}

function dedupe(calls: ToolCall[]): ToolCall[] {
  const seen = new Set<string>();
  const out: ToolCall[] = [];
  for (const c of calls) {
    const key = `${c.name}::${c.arguments}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...c, id: `call_${out.length + 1}` });
  }
  return out;
}
