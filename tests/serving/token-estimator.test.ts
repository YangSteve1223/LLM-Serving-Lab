import assert from "node:assert/strict";
import test from "node:test";
import { TokenEstimator } from "../../src/agents/learningAssistant/serving/index.ts";

test("token estimator is deterministic for Chinese, English, and mixed text", () => {
  const estimator = new TokenEstimator();
  const samples = ["人工智能三要素：数据、算法、算力", "Prefill decode separation improves serving efficiency.", "mAP50 和 F1 are detection metrics."];
  for (const sample of samples) {
    const first = estimator.estimateTokens(sample);
    const second = estimator.estimateTokens(sample);
    assert.ok(first > 0);
    assert.equal(first, second);
  }
});

test("longer text estimates more tokens", () => {
  const estimator = new TokenEstimator();
  const short = estimator.estimateTokens("数据决定模型知识边界。");
  const long = estimator.estimateTokens("数据决定模型知识边界。数据规模、质量和覆盖范围都会影响训练后的泛化能力。");
  assert.ok(long > short);
});
