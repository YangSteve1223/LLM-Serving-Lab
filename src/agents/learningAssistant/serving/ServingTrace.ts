/**
 * Serving trace and simulator type definitions.
 *
 * These types are careful about metric provenance: dry-run latency is
 * unavailable, simulator output is estimated/simulated, and real TTFT/ITL only
 * exists when a streaming endpoint is actually used.
 */
import type { EvidenceCandidate } from "../types.ts";
import type { CacheAwarePromptPlan } from "./CacheAwarePromptBuilder.ts";
import type { EngineMetricsDelta, NormalizedEngineMetrics } from "./engines/EngineBenchmarkTypes.ts";
import type { ActualStreamingTrace } from "./engines/StreamingTrace.ts";

export type ServingOptimizationMode = "off" | "observe_only" | "adaptive";

export type ServingSLO = {
  ttftMs?: number;
  tpotMs?: number;
  e2eMs?: number;
};

export type PromptTokenBreakdown = {
  systemTokens: number;
  userPromptTokens: number;
  currentPageTokens: number;
  teacherScriptTokens: number;
  outlineTokens: number;
  neighborPageTokens: number;
  knowledgeBaseTokens: number;
  selectedEvidenceTokens: number;
  estimatedPrefillTokens: number;
  estimatedDecodeTokens: number;
  cacheablePrefixTokens: number;
  nonCacheableTokens: number;
};

export type EvidenceTokenSummary = {
  total: number;
  bySourceType: Record<EvidenceCandidate["sourceType"], number>;
};

export type ContextBudgetSuggestion = {
  mode: ServingOptimizationMode;
  recommendedPolicy: "full" | "evidence_top_k" | "current_page_only" | "compressed" | "cache_first";
  reason: string;
  expectedPrefillTokenReduction?: number;
  risk?: "low" | "medium" | "high";
};

export type ServingPhaseTrace = {
  requestId: string;
  createdAt: string;
  queryHash: string;
  materialId?: string;
  pageIndex?: number;
  answerGenerationMode: "real_llm" | "mock_llm" | "template_fallback" | "unavailable";
  providerName?: string;
  modelName?: string;
  tokenEstimate: PromptTokenBreakdown;
  latencyMs: {
    contextAnalysis?: number;
    questionAnalysis?: number;
    policyPlanning?: number;
    retrieval?: number;
    evidenceSelection?: number;
    answerability?: number;
    promptBuild?: number;
    llmWallClock?: number;
    total?: number;
  };
  simulatedPD?: {
    prefillMs: number;
    decodeMs: number;
    kvTransferMs: number;
    estimatedTTFTMs: number;
    estimatedTPOTMs: number;
    note: string;
  };
  actualStreaming?: ActualStreamingTrace;
  engineMetrics?: {
    engine?: "vllm" | "sglang" | "openai-compatible" | "unknown";
    metricsUrl?: string;
    before?: NormalizedEngineMetrics;
    after?: NormalizedEngineMetrics;
    delta?: EngineMetricsDelta;
  };
  cacheAwarePrompt?: CacheAwarePromptPlan;
  contextBudgetSuggestion?: ContextBudgetSuggestion;
  retrievalStatus?: "success" | "empty" | "failed" | "skipped";
  selectedEvidenceCount: number;
  rejectedEvidenceCount: number;
  confidence: number;
};

export type PDWorkloadRequest = {
  id: string;
  arrivalMs: number;
  prefillTokens: number;
  decodeTokens: number;
  cacheablePrefixTokens?: number;
  priority?: "interactive" | "background";
};

export type PDSimulationConfig = {
  slo?: ServingSLO;
  prefillWorkers?: number;
  decodeWorkers?: number;
  monolithicWorkers?: number;
  prefillBaseMs?: number;
  decodeBaseMs?: number;
  kvBaseMs?: number;
  prefillMsPerToken?: number;
  decodeMsPerToken?: number;
  kvMsPerToken?: number;
  interferencePenalty?: number;
};

export type PDSimulationResult = {
  policyName: "monolithic_shared" | "pd_disaggregated" | "hybrid";
  requestCount: number;
  goodput: number;
  latency: {
    ttftP50: number;
    ttftP90: number;
    ttftP99: number;
    tpotP50: number;
    tpotP90: number;
    tpotP99: number;
    e2eP50: number;
    e2eP90: number;
    e2eP99: number;
  };
  utilization: {
    prefillUtilization: number;
    decodeUtilization: number;
    monolithicUtilization?: number;
  };
  queueing: {
    prefillQueueP90?: number;
    decodeQueueP90?: number;
  };
  notes: string[];
};
