/**
 * Metrics Utility Functions
 * 
 * Common metric calculation functions shared across different engine adapters.
 */
import type { HistogramSnapshot } from "./EngineBenchmarkTypes.ts";
import type { PrometheusMetricMap } from "./PrometheusMetricsParser.ts";

/**
 * Sum all sample values for a metric.
 */
export function sumMetric(metrics: PrometheusMetricMap, name: string): number | undefined {
  const samples = metrics.get(name);
  if (!samples?.length) return undefined;
  return samples.reduce((sum, sample) => sum + sample.value, 0);
}

/**
 * Get the maximum value from all samples for a metric.
 */
export function maxMetric(metrics: PrometheusMetricMap, name: string): number | undefined {
  const samples = metrics.get(name);
  if (!samples?.length) return undefined;
  return Math.max(...samples.map((sample) => sample.value));
}

/**
 * Extract histogram data from Prometheus metric samples.
 * 
 * Builds a HistogramSnapshot by combining _bucket, _sum, and _count suffixes.
 */
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
