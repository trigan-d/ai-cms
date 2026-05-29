import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverToolCallsFromText } from "../src/tool-recovery.js";

test("recovers the exact malformed shape Qwen2.5-Coder:7b emits (unquoted name)", () => {
  const content =
    '{"function": fs_write, "arguments": {"path": "hello.html", "content": "<h1>Hi</h1>"}}';
  const calls = recoverToolCallsFromText(content);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.name, "fs_write");
  assert.deepEqual(JSON.parse(calls[0]!.arguments), {
    path: "hello.html",
    content: "<h1>Hi</h1>",
  });
});

test("recovers Hermes/Qwen <tool_call> tagged format", () => {
  const content =
    'Sure!\n<tool_call>{"name": "fs_edit", "arguments": {"path": "index.html", "old_string": "a", "new_string": "b"}}</tool_call>';
  const calls = recoverToolCallsFromText(content);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.name, "fs_edit");
});

test("recovers fenced ```json tool call", () => {
  const content = '```json\n{"name":"publish","arguments":{}}\n```';
  const calls = recoverToolCallsFromText(content);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.name, "publish");
  assert.equal(calls[0]!.arguments, "{}");
});

test("recovers multiple tagged calls and assigns distinct ids", () => {
  const content =
    '<tool_call>{"name":"fs_read","arguments":{"path":"a"}}</tool_call>' +
    '<tool_call>{"name":"fs_read","arguments":{"path":"b"}}</tool_call>';
  const calls = recoverToolCallsFromText(content);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0]!.id, calls[1]!.id);
});

test("recovers multiple back-to-back objects (the {...}{...} shape Studio hit)", () => {
  const content =
    '{"name": "fs_edit", "arguments": {"path": "css/styles.css", "old_string": ".menu {", "new_string": ".menu {\\n  display: flex;\\n}"}}' +
    '{"name": "fs_edit", "arguments": {"path": "index.html", "old_string": "a", "new_string": "b"}}';
  const calls = recoverToolCallsFromText(content);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.name, "fs_edit");
  assert.equal(calls[1]!.name, "fs_edit");
  // CSS braces inside the string value must not break balance scanning.
  assert.match(JSON.parse(calls[0]!.arguments).new_string, /display: flex/);
});

test("accepts 'parameters' as an alias for arguments", () => {
  const calls = recoverToolCallsFromText('{"name":"fs_list","parameters":{"dir":"css"}}');
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0]!.arguments), { dir: "css" });
});

test("returns nothing for plain prose", () => {
  assert.deepEqual(recoverToolCallsFromText("I changed the background to dark."), []);
  assert.deepEqual(recoverToolCallsFromText(""), []);
  assert.deepEqual(recoverToolCallsFromText(null), []);
});
