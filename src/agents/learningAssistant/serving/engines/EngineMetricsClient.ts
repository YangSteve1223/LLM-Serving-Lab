/**
 * Safe metrics scraper for optional local engine benchmarks.
 *
 * The server endpoint restricts metrics URLs to localhost unless explicitly
 * allowed, reducing SSRF risk while still supporting vLLM/SGLang /metrics.
 */
import type { EngineMetricsDelta, NormalizedEngineMetrics } from "./EngineBenchmarkTypes.ts";
import { normalizeEngineKind, type EngineProviderConfig } from "./EngineProvider.ts";
import { PrometheusMetricsParser } from "./PrometheusMetricsParser.ts";
import { normalizeSglangMetrics } from "./SglangMetricsAdapter.ts";
import { normalizeVllmMetrics } from "./VllmMetricsAdapter.ts";

export class EngineMetricsClient {
  private parser = new PrometheusMetricsParser();

  async scrape(input: { metricsUrl: string; engine?: EngineProviderConfig["engine"] }): Promise<NormalizedEngineMetrics> {
    const response = await fetch(input.metricsUrl);
    if (!response.ok) throw new Error(`metrics scrape failed: HTTP ${response.status}`);
    return this.normalize(await response.text(), input.engine);
  }

  normalize(text: string, engine: EngineProviderConfig["engine"] = "auto" as EngineProviderConfig["engine"]): NormalizedEngineMetrics {
    const metrics = this.parser.parse(text);
    const kind = normalizeEngineKind(engine === "auto" ? undefined : engine);
    if (kind === "vllm") return normalizeVllmMetrics(metrics);
    if (kind === "sglang") return normalizeSglangMetrics(metrics);
    const names = [...metrics.keys()];
    if (names.some((name) => name.startsWith("vllm:"))) return normalizeVllmMetrics(metrics);
    if (names.some((name) => name.startsWith("sglang:"))) return normalizeSglangMetrics(metrics);
    return {
      engine: "unknown",
      scrapedAt: new Date().toISOString(),
      rawMetricNamesSeen: names
    };
  }
}

export function diffEngineMetrics(before?: NormalizedEngineMetrics, after?: NormalizedEngineMetrics): EngineMetricsDelta | undefined {
  if (!before || !after) return undefined;
  const hitsDelta = delta(before.prefixCacheHitsTotal, after.prefixCacheHitsTotal);
  const queriesDelta = delta(before.prefixCacheQueriesTotal, after.prefixCacheQueriesTotal);
  return {
    engine: after.engine,
    beforeScrapedAt: before.scrapedAt,
    afterScrapedAt: after.scrapedAt,
    promptTokensDelta: delta(before.promptTokensTotal, after.promptTokensTotal),
    generationTokensDelta: delta(before.generationTokensTotal, after.generationTokensTotal),
    cachedPromptTokensDelta: delta(before.promptTokensCachedTotal, after.promptTokensCachedTotal),
    prefixCacheHitsDelta: hitsDelta,
    prefixCacheQueriesDelta: queriesDelta,
    estimatedCacheHitRateDelta: hitsDelta !== undefined && queriesDelta ? hitsDelta / queriesDelta : rateDelta(before.cacheHitRate, after.cacheHitRate),
    nixlBytesTransferredDelta: delta(before.nixlBytesTransferred, after.nixlBytesTransferred),
    runningRequestsBefore: before.numRequestsRunning,
    runningRequestsAfter: after.numRequestsRunning,
    waitingRequestsBefore: before.numRequestsWaiting,
    waitingRequestsAfter: after.numRequestsWaiting
  };
}

function delta(before?: number, after?: number): number | undefined {
  if (before === undefined || after === undefined) return undefined;
  return after - before;
}

function rateDelta(before?: number, after?: number): number | undefined {
  if (before === undefined || after === undefined) return undefined;
  return after - before;
}
