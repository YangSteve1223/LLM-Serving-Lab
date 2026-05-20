import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { RequestTraceStore, type ServingPhaseTrace } from "../../src/agents/learningAssistant/serving/index.ts";

function trace(id: string): ServingPhaseTrace {
  return {
    requestId: id,
    createdAt: new Date(0).toISOString(),
    queryHash: `hash-${id}`,
    answerGenerationMode: "template_fallback",
    tokenEstimate: {
      systemTokens: 1,
      userPromptTokens: 2,
      currentPageTokens: 3,
      teacherScriptTokens: 0,
      outlineTokens: 0,
      neighborPageTokens: 0,
      knowledgeBaseTokens: 0,
      selectedEvidenceTokens: 3,
      estimatedPrefillTokens: 3,
      estimatedDecodeTokens: 4,
      cacheablePrefixTokens: 1,
      nonCacheableTokens: 2
    },
    latencyMs: { total: 10 },
    selectedEvidenceCount: 1,
    rejectedEvidenceCount: 0,
    confidence: 0.6
  };
}

test("ring buffer limit is enforced", async () => {
  const store = new RequestTraceStore({ limit: 2, enabledJsonl: false });
  await store.add(trace("1"));
  await store.add(trace("2"));
  await store.add(trace("3"));
  assert.deepEqual(store.list({ limit: 10 }).map((item) => item.requestId), ["3", "2"]);
});

test("JSONL trace does not contain raw API key, raw prompt, or raw answer", async () => {
  const tracePath = path.join("tests", "serving-output", `trace-${Date.now()}.jsonl`);
  const store = new RequestTraceStore({ limit: 5, tracePath, enabledJsonl: true });
  await store.add(trace("safe"));
  const text = await fs.readFile(tracePath, "utf8");
  assert.equal(text.includes("sk-THISSHOULDNOTAPPEAR"), false);
  assert.equal(text.includes("rawPrompt"), false);
  assert.equal(text.includes("rawAnswer"), false);
});
