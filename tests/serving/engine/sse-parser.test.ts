import assert from "node:assert/strict";
import test from "node:test";
import { SSEParser, isDoneEvent, parseSSEEvent } from "../../../src/agents/learningAssistant/serving/index.ts";

test("SSE parser parses data JSON", () => {
  const event = parseSSEEvent('data: {"choices":[{"delta":{"content":"hi"}}]}');
  assert.equal(event?.data, '{"choices":[{"delta":{"content":"hi"}}]}');
});

test("SSE parser handles DONE", () => {
  const event = parseSSEEvent("data: [DONE]");
  assert.ok(event);
  assert.equal(isDoneEvent(event), true);
});

test("SSE parser handles multiple chunks", () => {
  const parser = new SSEParser();
  const events = parser.push('data: {"a":1}\n\ndata: {"b":2}\n\n');
  assert.equal(events.length, 2);
  assert.equal(events[0].data, '{"a":1}');
  assert.equal(events[1].data, '{"b":2}');
});

test("SSE parser ignores malformed or comment lines without crashing", () => {
  const parser = new SSEParser();
  const events = parser.push(": keepalive\n\nnot-a-field\n\n");
  assert.equal(events.length, 0);
});
