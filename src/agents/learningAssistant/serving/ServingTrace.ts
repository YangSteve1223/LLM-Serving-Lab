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

// ==================== Enhanced PD Simulator Types ====================

export type GPUConfig = {
  gpuType: "compute_heavy" | "memory_heavy" | "balanced";
  flopsTFLOPS?: number; // Peak FLOPs in TFLOPs/s
  memoryBWGBps?: number; // Memory bandwidth in GB/s
  ibBandwidthGBps?: number; // Interconnect bandwidth in GB/s (for PD transfer)
  kvCachePerLayerMB?: number; // KV cache size per layer per token in MB
};

export type NetworkTopology = {
  prefillToDecodeIBBandwidthGBps: number; // IB bandwidth between prefill and decode
  numNetworkHops: number; // Number of network hops
};

export type ChunkedPrefillConfig = {
  enabled: boolean;
  chunkSize: number; // tokens per chunk
  allowInterleaving: boolean; // Allow decode between prefill chunks
};

export type EnhancedPDConfig = PDSimulationConfig & {
  // Model parameters
  modelName?: string;
  numLayers?: number;
  kvSizePerTokenMB?: number; // KV cache size per token per layer in MB (e.g., Llama-70B ≈ 0.64MB per token per layer)
  
  // GPU and network configuration
  prefillGPU?: GPUConfig;
  decodeGPU?: GPUConfig;
  networkTopology?: NetworkTopology;
  
  // Chunked prefill
  chunkedPrefill?: ChunkedPrefillConfig;
  
  // Heterogeneous resource allocation
  prefillBudgetRatio?: number; // Budget ratio for prefill instances (0-1)
  decodeBudgetRatio?: number; // Budget ratio for decode instances (0-1)
};

export type LayerKVTransferEvent = {
  layer: number;
  transferStartMs: number;
  transferEndMs: number;
  transferSizeMB: number;
};

export type PrefillChunk = {
  chunkIndex: number;
  startToken: number;
  endToken: number;
  computeMs: number;
  transferMs: number;
  completedLayers: number;
};

export type EnhancedPDWorkloadRequest = PDWorkloadRequest & {
  chunks?: PrefillChunk[];
  layerTransfers?: LayerKVTransferEvent[];
  effectiveTTFTMs?: number;
  prefillComputeMs?: number;
  kvTransferTimeMs?: number;
  chunkedPrefillEnabled?: boolean;
};

export type SchedulingDecision = {
  type: "prefill_chunk" | "decode_step" | "idle";
  requestId: string;
  chunkIndex?: number;
  tokensProcessed?: number;
  timestampMs: number;
  remainingBudget: number;
};

export type BatchState = {
  activeRequests: string[];
  pendingPrefill: string[];
  decodingRequests: string[];
  completedRequests: string[];
  currentStep: number;
  totalBudgetMs: number;
  usedBudgetMs: number;
};

export type ContinuousBatchingResult = {
  policyName: "fcfs" | "sjf" | "slo_aware";
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
  schedulingDecisions: SchedulingDecision[];
  batchStats: {
    avgBatchSize: number;
    maxBatchSize: number;
    prefillChunksProcessed: number;
    decodeStepsExecuted: number;
  };
  notes: string[];
};

// ==================== Exact Token Estimator Types ====================

export type TokenEstimatorType = "heuristic" | "bpe" | "tiktoken" | "exact";

export type TokenEstimateResult = {
  estimatorType: TokenEstimatorType;
  tokenCount: number;
  confidence: number; // 0-1
  details?: {
    vocabSize?: number;
    numOperations?: number;
    bpeMerges?: number;
  };
};

export type TokenEstimateComparison = {
  text: string;
  truncatedText?: string;
  estimates: TokenEstimateResult[];
  maxDifference: number;
  avgDifference: number;
  mostAccurate: TokenEstimatorType;
};

// BPETokenizer types
export type BPEToken = {
  id: number;
  text: string;
  frequency: number;
};

export type BPETrainingConfig = {
  vocabSize: number;
  minFrequency: number;
  maxIterations: number;
};

export type ExactTokenEstimatorConfig = {
  estimatorType: TokenEstimatorType;
  modelName?: string; // For exact tokenizer (e.g., "gpt-4", "llama-3")
  bpeVocabPath?: string;
  bpeMergesPath?: string;
  enableComparison?: boolean;
};
