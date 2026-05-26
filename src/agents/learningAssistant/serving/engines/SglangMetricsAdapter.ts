/**
 * SGLang metrics adapter.
 *
 * It normalizes cache, token, queue, and latency metrics when available and
 * remains tolerant of missing fields across SGLang versions/configurations.
 */
import { inferEngineFromMetricNames } from "./EngineProvider.ts";
import type { NormalizedEngineMetrics } from "./EngineBenchmarkTypes.ts";
import type { PrometheusMetricMap } from "./PrometheusMetricsParser.ts";
import { histogram, maxMetric, sumMetric } from "./MetricsUtils.ts";

export function normalizeSglangMetrics(metrics: PrometheusMetricMap, scrapedAt = new Date().toISOString()): NormalizedEngineMetrics {
  const names = [...metrics.keys()];
  return {
    engine: inferEngineFromMetricNames(names) === "sglang" ? "sglang" : "unknown",
    scrapedAt,
    promptTokensTotal: sumMetric(metrics, "sglang:prompt_tokens_total"),
    generationTokensTotal: sumMetric(metrics, "sglang:generation_tokens_total"),
    cacheHitRate: maxMetric(metrics, "sglang:cache_hit_rate"),
    kvCacheUsagePerc: maxMetric(metrics, "sglang:token_usage"),
    numRequestsRunning: sumMetric(metrics, "sglang:num_running_reqs"),
    e2eLatencyHistogram: histogram(metrics, "sglang:e2e_request_latency_seconds"),
    ttftHistogram: histogram(metrics, "sglang:time_to_first_token_seconds"),
    tpotOrItlHistogram: histogram(metrics, "sglang:time_per_output_token_seconds"),
    rawMetricNamesSeen: names
  };
}
