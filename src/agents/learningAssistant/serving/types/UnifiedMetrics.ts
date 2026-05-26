/**
 * Unified Metrics Types for LLM Serving
 * 
 * Standardizes measurement units across the serving system:
 * - Latency: milliseconds (ms)
 * - Throughput: tokens per second (tokens/s)
 * - Efficiency: percentage (0-100)
 */

/**
 * Standard latency measurements in milliseconds.
 */
export interface LatencyMetrics {
  /** Time to First Token in milliseconds */
  ttftMs: number;
  /** Time Per Output Token in milliseconds */
  tpotMs: number;
  /** End-to-End latency in milliseconds */
  e2eMs: number;
}

/**
 * Standard throughput measurement in tokens per second.
 */
export interface ThroughputMetrics {
  /** Input tokens per second */
  inputTokensPerSec: number;
  /** Output tokens per second */
  outputTokensPerSec: number;
  /** Total tokens per second (input + output) */
  totalTokensPerSec: number;
  /** Requests per second */
  requestsPerSec: number;
}

/**
 * Standard efficiency metrics as percentages (0-100).
 */
export interface EfficiencyMetrics {
  /** GPU utilization percentage (0-100) */
  gpuUtilization: number;
  /** Memory utilization percentage (0-100) */
  memoryUtilization: number;
  /** Cache hit rate percentage (0-100) */
  cacheHitRate: number;
  /** Prefill efficiency percentage (0-100) */
  prefillEfficiency: number;
}

/**
 * Complete unified metrics snapshot.
 */
export interface UnifiedMetrics {
  latency: LatencyMetrics;
  throughput: ThroughputMetrics;
  efficiency: EfficiencyMetrics;
  timestamp: number;
}

/**
 * Latency percentiles.
 */
export interface LatencyPercentiles {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
}

/**
 * Unified percentile metrics.
 */
export interface UnifiedPercentileMetrics {
  ttft: LatencyPercentiles;
  tpot: LatencyPercentiles;
  e2e: LatencyPercentiles;
  throughput: {
    tokensPerSec: LatencyPercentiles;
  };
}

/**
 * Statistical summary of metrics.
 */
export interface MetricsSummary {
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  count: number;
}

/**
 * Unified metrics statistics.
 */
export interface UnifiedMetricsStats {
  latency: {
    ttft: MetricsSummary;
    tpot: MetricsSummary;
    e2e: MetricsSummary;
  };
  throughput: {
    tokensPerSec: MetricsSummary;
    requestsPerSec: MetricsSummary;
  };
  efficiency: {
    gpuUtilization: MetricsSummary;
    memoryUtilization: MetricsSummary;
    cacheHitRate: MetricsSummary;
  };
}

// ==================== Conversion Helpers ====================

/**
 * Convert seconds to milliseconds.
 */
export function secondsToMs(seconds: number): number {
  return seconds * 1000;
}

/**
 * Convert milliseconds to seconds.
 */
export function msToSeconds(ms: number): number {
  return ms / 1000;
}

/**
 * Convert ratio (0-1) to percentage (0-100).
 */
export function ratioToPercent(ratio: number): number {
  return ratio * 100;
}

/**
 * Convert percentage (0-100) to ratio (0-1).
 */
export function percentToRatio(percent: number): number {
  return percent / 100;
}

/**
 * Create unified metrics from raw values.
 */
export function createUnifiedMetrics(
  latency: {
    ttftMs: number;
    tpotMs: number;
    e2eMs: number;
  },
  throughput: {
    inputTokensPerSec: number;
    outputTokensPerSec: number;
    requestsPerSec: number;
  },
  efficiency: {
    gpuUtilization: number;
    memoryUtilization: number;
    cacheHitRate: number;
  }
): UnifiedMetrics {
  return {
    latency: {
      ttftMs: latency.ttftMs,
      tpotMs: latency.tpotMs,
      e2eMs: latency.e2eMs,
    },
    throughput: {
      inputTokensPerSec: throughput.inputTokensPerSec,
      outputTokensPerSec: throughput.outputTokensPerSec,
      totalTokensPerSec: throughput.inputTokensPerSec + throughput.outputTokensPerSec,
      requestsPerSec: throughput.requestsPerSec,
    },
    efficiency: {
      gpuUtilization: Math.min(100, Math.max(0, efficiency.gpuUtilization)),
      memoryUtilization: Math.min(100, Math.max(0, efficiency.memoryUtilization)),
      cacheHitRate: Math.min(100, Math.max(0, efficiency.cacheHitRate)),
      prefillEfficiency: 0, // Calculated separately
    },
    timestamp: Date.now(),
  };
}

/**
 * Validate that a metrics object conforms to unified standards.
 */
export function validateMetrics(metrics: Partial<UnifiedMetrics>): string[] {
  const errors: string[] = [];

  if (metrics.latency) {
    if (metrics.latency.ttftMs < 0) {
      errors.push("TTFT must be non-negative (in ms)");
    }
    if (metrics.latency.tpotMs < 0) {
      errors.push("TPOT must be non-negative (in ms)");
    }
    if (metrics.latency.e2eMs < 0) {
      errors.push("E2E latency must be non-negative (in ms)");
    }
  }

  if (metrics.throughput) {
    if (metrics.throughput.inputTokensPerSec < 0) {
      errors.push("Input throughput must be non-negative (tokens/s)");
    }
    if (metrics.throughput.outputTokensPerSec < 0) {
      errors.push("Output throughput must be non-negative (tokens/s)");
    }
    if (metrics.throughput.requestsPerSec < 0) {
      errors.push("Request throughput must be non-negative (req/s)");
    }
  }

  if (metrics.efficiency) {
    if (metrics.efficiency.gpuUtilization < 0 || metrics.efficiency.gpuUtilization > 100) {
      errors.push("GPU utilization must be in range 0-100");
    }
    if (metrics.efficiency.memoryUtilization < 0 || metrics.efficiency.memoryUtilization > 100) {
      errors.push("Memory utilization must be in range 0-100");
    }
    if (metrics.efficiency.cacheHitRate < 0 || metrics.efficiency.cacheHitRate > 100) {
      errors.push("Cache hit rate must be in range 0-100");
    }
  }

  return errors;
}
