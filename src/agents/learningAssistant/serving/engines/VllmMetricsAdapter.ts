/**
 * vLLM metrics adapter.
 *
 * It normalizes best-effort Prometheus metrics into a common shape; missing
 * metrics stay undefined because vLLM versions expose slightly different names.
 */
import { inferEngineFromMetricNames } from "./EngineProvider.ts";
import type { HistogramSnapshot, NormalizedEngineMetrics } from "./EngineBenchmarkTypes.ts";
import type { PrometheusMetricMap } from "./PrometheusMetricsParser.ts";

export function normalizeVllmMetrics(metrics: PrometheusMetricMap, scrapedAt = new Date().toISOString()): NormalizedEngineMetrics {
  const names = [...metrics.keys()];
  return {
    engine: inferEngineFromMetricNames(names) === "vllm" ? "vllm" : "unknown",
    scrapedAt,
    promptTokensTotal: sumMetric(metrics, "vllm:prompt_tokens"),
    generationTokensTotal: sumMetric(metrics, "vllm:generation_tokens"),
    promptTokensCachedTotal: sumMetric(metrics, "vllm:prompt_tokens_cached"),
    prefixCacheHitsTotal: sumMetric(metrics, "vllm:prefix_cache_hits"),
    prefixCacheQueriesTotal: sumMetric(metrics, "vllm:prefix_cache_queries"),
    cacheHitRate: ratio(sumMetric(metrics, "vllm:prefix_cache_hits"), sumMetric(metrics, "vllm:prefix_cache_queries")),
    kvCacheUsagePerc: maxMetric(metrics, "vllm:kv_cache_usage_perc"),
    numRequestsRunning: sumMetric(metrics, "vllm:num_requests_running"),
    numRequestsWaiting: sumMetric(metrics, "vllm:num_requests_waiting"),
    e2eLatencyHistogram: histogram(metrics, "vllm:e2e_request_latency_seconds"),
    ttftHistogram: histogram(metrics, "vllm:time_to_first_token_seconds"),
    tpotOrItlHistogram: histogram(metrics, "vllm:inter_token_latency_seconds"),
    requestPrefillTimeHistogram: histogram(metrics, "vllm:request_prefill_time_seconds"),
    requestDecodeTimeHistogram: histogram(metrics, "vllm:request_decode_time_seconds"),
    requestQueueTimeHistogram: histogram(metrics, "vllm:request_queue_time_seconds"),
    nixlBytesTransferred: sumMetric(metrics, "vllm:nixl_bytes_transferred"),
    nixlTransferTimeHistogram: histogram(metrics, "vllm:nixl_xfer_time_seconds"),
    rawMetricNamesSeen: names
  };
}

export function sumMetric(metrics: PrometheusMetricMap, name: string): number | undefined {
  const samples = metrics.get(name);
  if (!samples?.length) return undefined;
  return samples.reduce((sum, sample) => sum + sample.value, 0);
}

export function maxMetric(metrics: PrometheusMetricMap, name: string): number | undefined {
  const samples = metrics.get(name);
  if (!samples?.length) return undefined;
  return Math.max(...samples.map((sample) => sample.value));
}

export function histogram(metrics: PrometheusMetricMap, baseName: string): HistogramSnapshot | undefined {
  const buckets = (metrics.get(`${baseName}_bucket`) ?? [])
    .map((sample) => ({ le: sample.labels.le === "+Inf" ? Infinity : Number(sample.labels.le), value: sample.value }))
    .filter((bucket) => Number.isFinite(bucket.le) || bucket.le === Infinity)
    .sort((a, b) => a.le - b.le);
  const sum = sumMetric(metrics, `${baseName}_sum`);
  const count = sumMetric(metrics, `${baseName}_count`);
  if (!buckets.length && sum === undefined && count === undefined) return undefined;
  return { buckets, sum, count };
}

function ratio(numerator: number | undefined, denominator: number | undefined): number | undefined {
  if (numerator === undefined || !denominator) return undefined;
  return numerator / denominator;
}
