import assert from "node:assert/strict";
import test from "node:test";
import { EngineMetricsClient } from "../../../src/agents/learningAssistant/serving/index.ts";

test("vLLM sample metrics normalize", () => {
  const client = new EngineMetricsClient();
  const metrics = client.normalize(`
vllm:prompt_tokens 100
vllm:generation_tokens 20
vllm:prefix_cache_hits 8
vllm:prefix_cache_queries 10
vllm:prompt_tokens_cached 60
vllm:kv_cache_usage_perc 0.5
vllm:num_requests_running 1
vllm:num_requests_waiting 2
vllm:time_to_first_token_seconds_bucket{le="0.5"} 1
vllm:time_to_first_token_seconds_count 1
`, "vllm");
  // STRENGTHENED: Verify specific metric types and value ranges
  assert.strictEqual(typeof metrics.engine, "string", "Engine should be string");
  assert.strictEqual(metrics.engine, "vllm");
  assert.strictEqual(typeof metrics.promptTokensTotal, "number", "Prompt tokens should be number");
  assert.equal(metrics.promptTokensTotal, 100);
  assert.ok(metrics.cacheHitRate >= 0 && metrics.cacheHitRate <= 1, "Cache hit rate should be 0-1");
  assert.equal(metrics.cacheHitRate, 0.8);
  assert.equal(metrics.ttftHistogram?.count, 1);
});

test("SGLang sample metrics normalize", () => {
  const client = new EngineMetricsClient();
  const metrics = client.normalize(`
sglang:prompt_tokens_total 50
sglang:generation_tokens_total 10
sglang:cache_hit_rate 0.3
sglang:num_running_reqs 2
sglang:time_per_output_token_seconds_bucket{le="0.05"} 4
sglang:time_per_output_token_seconds_count 4
`, "sglang");
  // STRENGTHENED: Verify specific metric types and value ranges
  assert.strictEqual(typeof metrics.engine, "string", "Engine should be string");
  assert.strictEqual(metrics.engine, "sglang");
  assert.strictEqual(typeof metrics.promptTokensTotal, "number", "Prompt tokens should be number");
  assert.equal(metrics.promptTokensTotal, 50);
  assert.ok(metrics.cacheHitRate >= 0 && metrics.cacheHitRate <= 1, "Cache hit rate should be 0-1");
  assert.equal(metrics.cacheHitRate, 0.3);
  assert.equal(metrics.tpotOrItlHistogram?.count, 4);
});

test("missing engine metrics do not throw", () => {
  const client = new EngineMetricsClient();
  const metrics = client.normalize("custom_metric 1", "vllm");
  // STRENGTHENED: Verify undefined handling
  assert.strictEqual(metrics.promptTokensTotal, undefined, "Missing metric should be undefined");
  assert.ok(Array.isArray(metrics.rawMetricNamesSeen), "Should have raw metric names array");
  assert.ok(metrics.rawMetricNamesSeen.includes("custom_metric"));
});

test("metrics values should be within valid ranges", () => {
  const client = new EngineMetricsClient();
  const metrics = client.normalize(`
vllm:prompt_tokens 1000
vllm:generation_tokens 500
vllm:prefix_cache_hits 600
vllm:prefix_cache_queries 1000
`, "vllm");
  
  // STRENGTHENED: Verify prompt tokens type
  assert.strictEqual(typeof metrics.promptTokensTotal, "number", "Prompt tokens should be number");
  assert.ok(metrics.promptTokensTotal >= 0, "Prompt tokens should be >= 0");
  
  // STRENGTHENED: Verify cache hit rate if present (vLLM calculates from prefix_cache_hits/queries)
  if (metrics.cacheHitRate !== undefined) {
    assert.strictEqual(typeof metrics.cacheHitRate, "number", "Cache hit rate should be number");
    assert.ok(metrics.cacheHitRate >= 0, "Cache hit rate should be >= 0");
    assert.ok(metrics.cacheHitRate <= 1, "Cache hit rate should be <= 1");
  }
  
  // STRENGTHENED: Verify KV cache usage if present
  if (metrics.kvCacheUsage !== undefined) {
    assert.strictEqual(typeof metrics.kvCacheUsage, "number", "KV cache usage should be number");
    assert.ok(metrics.kvCacheUsage >= 0, "KV cache usage should be >= 0");
    assert.ok(metrics.kvCacheUsage <= 1, "KV cache usage should be <= 1");
  }
});
