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
  assert.equal(metrics.engine, "vllm");
  assert.equal(metrics.promptTokensTotal, 100);
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
  assert.equal(metrics.engine, "sglang");
  assert.equal(metrics.promptTokensTotal, 50);
  assert.equal(metrics.cacheHitRate, 0.3);
  assert.equal(metrics.tpotOrItlHistogram?.count, 4);
});

test("missing engine metrics do not throw", () => {
  const client = new EngineMetricsClient();
  const metrics = client.normalize("custom_metric 1", "vllm");
  assert.equal(metrics.promptTokensTotal, undefined);
  assert.ok(metrics.rawMetricNamesSeen.includes("custom_metric"));
});
