import assert from "node:assert/strict";
import test from "node:test";
import { PrometheusMetricsParser } from "../../../src/agents/learningAssistant/serving/index.ts";

test("Prometheus parser parses counter, gauge, and histogram buckets", () => {
  const parser = new PrometheusMetricsParser();
  const metrics = parser.parse(`
# HELP vllm:prompt_tokens_total total
vllm:prompt_tokens 42
vllm:kv_cache_usage_perc{gpu="0"} 0.75
vllm:time_to_first_token_seconds_bucket{le="0.1"} 3
vllm:time_to_first_token_seconds_bucket{le="+Inf"} 5
vllm:time_to_first_token_seconds_sum 0.8
vllm:time_to_first_token_seconds_count 5
`);
  assert.equal(metrics.get("vllm:prompt_tokens")?.[0].value, 42);
  assert.equal(metrics.get("vllm:kv_cache_usage_perc")?.[0].labels.gpu, "0");
  assert.equal(metrics.get("vllm:time_to_first_token_seconds_bucket")?.length, 2);
});
