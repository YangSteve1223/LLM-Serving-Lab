import assert from "node:assert/strict";
import test from "node:test";
import { buildActualStreamingTrace } from "../../../src/agents/learningAssistant/serving/index.ts";

test("streaming trace computes TTFT, ITL, and percentiles", () => {
  const trace = buildActualStreamingTrace({
    requestStartMs: 100,
    firstChunkMs: 120,
    firstTokenMs: 150,
    perChunkTimestamps: [150, 170, 230, 260],
    lastChunkMs: 300,
    outputText: "hello world",
    actualStreaming: true
  });
  assert.equal(trace.ttftMs, 50);
  assert.deepEqual(trace.itlMs, [20, 60, 30]);
  assert.equal(trace.p90ItlMs, 60);
  assert.equal(trace.e2eMs, 200);
});
