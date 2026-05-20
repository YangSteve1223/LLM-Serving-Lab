/**
 * Types for the SOTA engine bridge benchmark.
 *
 * The summary fields separate workload success, actual goodput, estimated
 * goodput, latency availability, and token accounting to avoid apples-to-oranges
 * benchmark interpretation.
 */
import type { ServingSLO } from "../ServingTrace.ts";

export type EngineKind = "vllm" | "sglang" | "openai-compatible" | "unknown";

export type HistogramSnapshot = {
  buckets: Array<{ le: number; value: number }>;
  sum?: number;
  count?: number;
};

export type NormalizedEngineMetrics = {
  engine: "vllm" | "sglang" | "unknown";
  scrapedAt: string;
  promptTokensTotal?: number;
  generationTokensTotal?: number;
  promptTokensCachedTotal?: number;
  prefixCacheHitsTotal?: number;
  prefixCacheQueriesTotal?: number;
  cacheHitRate?: number;
  kvCacheUsagePerc?: number;
  numRequestsRunning?: number;
  numRequestsWaiting?: number;
  e2eLatencyHistogram?: HistogramSnapshot;
  ttftHistogram?: HistogramSnapshot;
  tpotOrItlHistogram?: HistogramSnapshot;
  requestPrefillTimeHistogram?: HistogramSnapshot;
  requestDecodeTimeHistogram?: HistogramSnapshot;
  requestQueueTimeHistogram?: HistogramSnapshot;
  nixlBytesTransferred?: number;
  nixlTransferTimeHistogram?: HistogramSnapshot;
  rawMetricNamesSeen: string[];
};

export type EngineMetricsDelta = {
  engine: NormalizedEngineMetrics["engine"];
  beforeScrapedAt?: string;
  afterScrapedAt?: string;
  promptTokensDelta?: number;
  generationTokensDelta?: number;
  cachedPromptTokensDelta?: number;
  prefixCacheHitsDelta?: number;
  prefixCacheQueriesDelta?: number;
  estimatedCacheHitRateDelta?: number;
  nixlBytesTransferredDelta?: number;
  runningRequestsBefore?: number;
  runningRequestsAfter?: number;
  waitingRequestsBefore?: number;
  waitingRequestsAfter?: number;
};

export type EngineBenchmarkPolicy = "full" | "evidence_top_k" | "current_page_only" | "cache_first";

export type LatencyMeasurementMode = "actual_streaming" | "full_response_wall_clock" | "dry_run_unmeasured" | "simulated";

export type MetricAvailability = "actual" | "estimated" | "simulated" | "unavailable";

export type LatencyAvailability = {
  ttft: MetricAvailability;
  itl: MetricAvailability;
  e2e: MetricAvailability;
};

export type PromptTokenAccounting = {
  originalPromptTokens?: number;
  canonicalPromptTokens?: number;
  rawPromptTokensSent?: number;
  stablePrefixTokens?: number;
  dynamicSuffixTokens?: number;
  selectedEvidenceTokens?: number;
  cacheablePrefixTokensEstimate?: number;
  estimatedExtraTokensFromCanonicalization?: number;
  estimatedTokenSavingsAtCacheHitRates?: {
    hitRate25: number;
    hitRate50: number;
    hitRate75: number;
    hitRate90: number;
  };
  breakEvenCacheHitRate?: number | null;
  notes: string[];
};

export type EngineBenchmarkRequest = {
  id: string;
  prompt: string;
  policy: EngineBenchmarkPolicy;
  promptTokensEstimate: number;
  stablePrefixTokensEstimate: number;
  tokenAccounting: PromptTokenAccounting;
  expectedOutputTokens?: number;
};

export type EngineBenchmarkConfig = {
  engine: EngineKind;
  baseUrl?: string;
  metricsUrl?: string;
  model?: string;
  stream: boolean;
  source: "synthetic" | "recent_traces";
  requestCount: number;
  qps: number;
  concurrency: number;
  policies: EngineBenchmarkPolicy[];
  slo?: ServingSLO;
  dryRun?: boolean;
};

export type EngineBenchmarkPolicySummary = {
  policy: EngineBenchmarkPolicy;
  requests: number;
  dryRun: boolean;
  actualStreaming: boolean;
  latencyMeasurementMode: LatencyMeasurementMode;
  latencyAvailability: LatencyAvailability;
  workloadSuccessRate: number;
  actualGoodputUnderSLO?: number | null;
  estimatedGoodputUnderSLO?: number | null;
  successRate: number;
  refusalRate: number;
  confidenceAvg: number;
  citationCountAvg: number;
  promptTokensAvg: number;
  promptTokensP90: number;
  originalPromptTokensAvg?: number;
  originalPromptTokensP90?: number;
  canonicalPromptTokensAvg?: number;
  canonicalPromptTokensP90?: number;
  rawPromptTokensSentAvg?: number;
  rawPromptTokensSentP90?: number;
  stablePrefixTokensAvg: number;
  stablePrefixTokensP90: number;
  dynamicSuffixTokensAvg?: number;
  dynamicSuffixTokensP90?: number;
  cacheablePrefixTokensEstimateAvg?: number;
  cacheablePrefixTokensEstimateP90?: number;
  estimatedExtraTokensFromCanonicalizationAvg?: number;
  breakEvenCacheHitRateAvg?: number | null;
  breakEvenCacheHitRateP90?: number | null;
  tokenAccountingNotes: string[];
  ttftP50?: number;
  ttftP90?: number;
  ttftP99?: number;
  itlP50?: number;
  itlP90?: number;
  itlP99?: number;
  e2eP50?: number;
  e2eP90?: number;
  e2eP99?: number;
  outputTokensPerSecond?: number;
  /** @deprecated Use actualGoodputUnderSLO or estimatedGoodputUnderSLO. */
  goodput: number;
  cacheHitRateBefore?: number;
  cacheHitRateAfter?: number;
  cacheHitRateDelta?: number;
  prefixCacheHitsDelta?: number;
  prefixCacheQueriesDelta?: number;
  cachedPromptTokensDelta?: number;
  nixlBytesTransferredDelta?: number;
  fallbackWarning?: string;
  qualityProxy: {
    citationCountAvg: number;
    refusalRate: number;
    confidenceAvg: number;
  };
};

export type EngineBenchmarkReport = {
  generatedAt: string;
  config: Omit<EngineBenchmarkConfig, "baseUrl"> & { baseUrlConfigured: boolean };
  workload: {
    source: "synthetic" | "recent_traces";
    requestCount: number;
    policies: EngineBenchmarkPolicy[];
  };
  summaries: EngineBenchmarkPolicySummary[];
  interpretation: string[];
  notes: string[];
};
