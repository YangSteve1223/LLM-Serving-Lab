import assert from "node:assert/strict";
import test from "node:test";
import { CacheAwarePromptBuilder } from "../../../src/agents/learningAssistant/serving/index.ts";
import type { LearningContext } from "../../../src/agents/learningAssistant/index.ts";

function context(pageIndex = 1): LearningContext {
  return {
    material: { id: "deck-a", type: "pptx", title: "AI", pageCount: 2 },
    currentPage: {
      id: `p-${pageIndex}`,
      pageIndex,
      title: pageIndex === 1 ? "数据" : "算力",
      semanticTitle: pageIndex === 1 ? "数据" : "算力",
      text: pageIndex === 1 ? "数据是 AI 的知识来源。" : "算力支撑训练和推理。"
    },
    outline: { source: "inferred_from_deck", items: [{ id: "x", title: "AI 三要素" }] },
    teacherScript: { source: "platform", text: "注意证据边界。" },
    chatHistory: []
  };
}

test("stablePrefixHash is stable for same material/page", () => {
  const builder = new CacheAwarePromptBuilder();
  const a = builder.plan({ originalPrompt: "prompt A", query: "问题 A", context: context() });
  const b = builder.plan({ originalPrompt: "prompt B", query: "问题 B", context: context() });
  assert.equal(a.stablePrefixHash, b.stablePrefixHash);
});

test("different question does not change stablePrefixHash", () => {
  const builder = new CacheAwarePromptBuilder();
  const a = builder.plan({ originalPrompt: "prompt", query: "这页讲什么？", context: context() });
  const b = builder.plan({ originalPrompt: "prompt", query: "请举例", context: context() });
  assert.equal(a.stablePrefixHash, b.stablePrefixHash);
});

test("different current page changes stablePrefixHash", () => {
  const builder = new CacheAwarePromptBuilder();
  const a = builder.plan({ originalPrompt: "prompt", query: "问题", context: context(1) });
  const b = builder.plan({ originalPrompt: "prompt", query: "问题", context: context(2) });
  assert.notEqual(a.stablePrefixHash, b.stablePrefixHash);
});

test("stablePrefix strips requestId and timestamp", () => {
  const builder = new CacheAwarePromptBuilder();
  const plan = builder.plan({ originalPrompt: "requestId: abc timestamp: 2026-01-01", query: "问题", context: context() });
  const stableText = plan.components.filter((item) => item.cacheable).map((item) => item.text).join("\n");
  assert.doesNotMatch(stableText, /requestId:\s*abc/);
  assert.doesNotMatch(stableText, /2026-01-01/);
});

test("cache_first keeps grounding, refusal, and citation rules", () => {
  const builder = new CacheAwarePromptBuilder();
  const plan = builder.plan({ originalPrompt: "prompt", query: "问题", context: context(), mode: "cache_first" });
  assert.equal(plan.applied, true);
  assert.match(plan.canonicalPrompt, /Grounding\/refusal\/citation rules/);
  assert.match(plan.canonicalPrompt, /refuse to invent/i);
  assert.match(plan.canonicalPrompt, /Citations must support/);
});
