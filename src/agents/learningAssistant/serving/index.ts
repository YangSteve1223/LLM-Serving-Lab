export { ContextBudgetPlanner, contextBudgetPlanner, compressEvidence } from "./ContextBudgetPlanner.ts";
export type { ContextBudgetPlannerInput, ContextBudgetPlan } from "./ContextBudgetPlanner.ts";
export { CacheAwarePromptBuilder, cacheAwarePromptBuilder, stripRequestVolatileText } from "./CacheAwarePromptBuilder.ts";
export type { CacheAwarePromptPlan, PromptComponent } from "./CacheAwarePromptBuilder.ts";
export { hashText, stableJson } from "./PromptComponentHasher.ts";
export { RequestTraceStore, createQueryHash, createRequestId, sanitizeTrace } from "./RequestTraceStore.ts";
export { EngineMetricsClient, diffEngineMetrics } from "./engines/EngineMetricsClient.ts";
export { EngineBenchmarkRunner, engineBenchmarkRunner, renderEngineBenchmarkReport } from "./engines/EngineBenchmarkRunner.ts";
export { normalizeEngineKind, inferEngineFromMetricNames } from "./engines/EngineProvider.ts";
export { PrometheusMetricsParser, parseMetricLine } from "./engines/PrometheusMetricsParser.ts";
export { StreamingOpenAICompatibleClient } from "./engines/StreamingOpenAICompatibleClient.ts";
export { SSEParser, isDoneEvent, parseSSEEvent } from "./engines/SSEParser.ts";
export { buildActualStreamingTrace } from "./engines/StreamingTrace.ts";
export { normalizeSglangMetrics } from "./engines/SglangMetricsAdapter.ts";
export { normalizeVllmMetrics } from "./engines/VllmMetricsAdapter.ts";
export type {
  EngineBenchmarkConfig,
  EngineBenchmarkPolicy,
  EngineBenchmarkPolicySummary,
  EngineBenchmarkReport,
  EngineBenchmarkRequest,
  EngineKind,
  EngineMetricsDelta,
  HistogramSnapshot,
  LatencyAvailability,
  LatencyMeasurementMode,
  NormalizedEngineMetrics,
  PromptTokenAccounting
} from "./engines/EngineBenchmarkTypes.ts";
export type { StreamingCompletionResult, StreamingOpenAICompatibleClientOptions } from "./engines/StreamingOpenAICompatibleClient.ts";
export type { SSEEvent } from "./engines/SSEParser.ts";
export type { ActualStreamingTrace, StreamingTraceInput } from "./engines/StreamingTrace.ts";
export type {
  ContextBudgetSuggestion,
  EvidenceTokenSummary,
  PDSimulationConfig,
  PDSimulationResult,
  PDWorkloadRequest,
  PromptTokenBreakdown,
  ServingOptimizationMode,
  ServingPhaseTrace,
  ServingSLO
} from "./ServingTrace.ts";

// ==================== Enhanced PD Simulator ====================
export { EnhancedPDServingSimulator, enhancedPDServingSimulator } from "./EnhancedPDServingSimulator.ts";
export type { EnhancedSimulatorStats } from "./EnhancedPDServingSimulator.ts";
export { renderEnhancedPDReport, renderContinuousBatchingReport, renderKVTransferAnalysis, renderChunkedPrefillAnalysis, renderHeterogeneousAllocationAnalysis } from "./EnhancedPDReportRenderer.ts";

// ==================== Continuous Batching Scheduler ====================
export { ContinuousBatchingScheduler, continuousBatchingScheduler } from "./ContinuousBatchingScheduler.ts";
export type { ContinuousBatchingPolicy, SchedulerConfig } from "./ContinuousBatchingScheduler.ts";

// ==================== Exact Token Estimator ====================
export { ExactTokenEstimator, BPETokenizer, createExactTokenEstimator, exactTokenEstimator, bpeTokenEstimator, tiktokenEstimator, estimateTokensExact } from "./ExactTokenEstimator.ts";

// ==================== Serving Pipeline V2 ====================
export { DeepSeekLatencyProber, createDeepSeekLatencyProber, DEFAULT_TEST_SCENARIOS } from "./benchmark/index.ts";
export type { LatencyMeasurement, TestScenario, ScenarioResult, CalibrationResult, LatencyBaseline } from "./benchmark/index.ts";

// ==================== Calibration Module ====================
export { CalibrationPipeline, createCalibrationPipeline } from "./calibration/index.ts";
export type { ComponentCalibrationConfig, SchedulingCalibrationConfig, CacheCalibrationConfig, CalibrationConfig, CalibrationStageResult, FullCalibrationReport } from "./calibration/index.ts";

// ==================== Cache Module ====================
export { RadixPrefixCacheManager, radixPrefixCacheManager } from "./cache/RadixPrefixCacheManager.ts";
export type { 
  CacheEntry, 
  CacheStats, 
  CacheAwarePDSimulationResult, 
  EvictionStrategy,
  RadixTreeConfig,
  RequestGroup
} from "./cache/RadixPrefixCacheManager.ts";

export { HierarchicalKVCache, hierarchicalKVCache } from "./cache/HierarchicalKVCache.ts";
export type {
  CacheTier,
  PrefetchStrategy,
  WritePolicy,
  TierConfig,
  KVCacheEntry,
  CacheMigration,
  HierarchicalCacheStats,
  CacheRequest,
  CacheResponse
} from "./cache/HierarchicalKVCache.ts";

export { CacheExperimentRunner, createDefaultExperiment, createComprehensiveExperiment } from "./cache/CacheExperimentRunner.ts";
export type {
  ExperimentType,
  ExperimentConfig,
  ExperimentMetrics,
  ExperimentResult,
  ExperimentReport
} from "./cache/CacheExperimentRunner.ts";

// ==================== Workload Module ====================
export { 
  ServingWorkloadModel,
  createTypicalWorkload,
  createHeavyWorkload,
  createLightWorkload
} from "./workload/index.ts";
export type {
  TaskType,
  ArrivalPattern,
  WorkloadProfile,
  WorkloadConfig,
  SyntheticRequest,
  WorkloadAnalysis
} from "./workload/index.ts";
// ==================== Abstract Cache Interface & Adapters (Branch A) ====================
export { AbstractPrefixCache } from "./cache/AbstractPrefixCache.ts";
export type { CacheLookupResult, CacheStats } from "./cache/AbstractPrefixCache.ts";
export { RadixCacheAdapter } from "./cache/RadixCacheAdapter.ts";
export type { RadixCacheAdapterConfig } from "./cache/RadixCacheAdapter.ts";
export { HashCacheAdapter } from "./cache/HashCacheAdapter.ts";
export type { HashCacheAdapterConfig } from "./cache/HashCacheAdapter.ts";

// ==================== Abstract Scheduler Interface & Adapters (Branch A) ====================
export { AbstractScheduler } from "./scheduling/SchedulerInterface.ts";
export type { SchedulingWorkload, SchedulingMetrics, SchedulingResult } from "./scheduling/SchedulerInterface.ts";
export { ContinuousBatchingAdapter } from "./scheduling/ContinuousBatchingAdapter.ts";
export type { ContinuousBatchingAdapterConfig } from "./scheduling/ContinuousBatchingAdapter.ts";
export { SGLangRadixAdapter } from "./scheduling/SGLangRadixAdapter.ts";
export type { SGLangRadixAdapterConfig, SGLangPolicy } from "./scheduling/SGLangRadixAdapter.ts";

// ==================== Speculative Decoding Module (Branch B) ====================
export { SpeculativeDecodingSimulator, speculativeDecodingSimulator } from "./speculative/SpeculativeDecodingSimulator.ts";
export type {
  SpeculativeDecodingConfig,
  SpeculativeRoundResult,
  SpeculativeResult,
  ComparisonResult,
  SpeculativeWorkloadRequest
} from "./speculative/SpeculativeDecodingSimulator.ts";
export {
  DRAFT_TARGET_PAIRS,
  createDraftTargetPair,
  getRecommendedPair,
  estimateSpeedupRatio,
  estimateAcceptanceRate
} from "./speculative/DraftTargetPair.ts";
export type { DraftModelType, DraftTargetPairConfig } from "./speculative/DraftTargetPair.ts";
export { SpeculativeSchedulingIntegration, speculativeSchedulingIntegration } from "./speculative/SpeculativeSchedulingIntegration.ts";
export type {
  SpeculativeDecision,
  SpeculativeSchedulingConfig,
  SpeculativeSchedulingResult,
  WorkloadCharacteristics
} from "./speculative/SpeculativeSchedulingIntegration.ts";

// ==================== Experiment Module (Branch B) ====================
export { ServingExperimentRunner, createServingExperimentRunner } from "./experiment/index.ts";
export type {
  LengthOfContextRequest,
  PrefillResponseContent,
  TrafficIntensity,
  LCRPMatrix,
  LCRPExperimentConfig,
  BaselineStrategy,
  LCRPExperimentResult,
  LCRPExperimentReport
} from "./experiment/index.ts";
export { AblationStudyRunner, ablationStudyRunner, createStandardAblationConfig } from "./experiment/AblationStudyRunner.ts";
export type {
  AblationModule,
  AblationConfig,
  AblationStepResult,
  AblationStudyResult
} from "./experiment/AblationStudyRunner.ts";
export { APIExperimentRunner, apiExperimentRunner, STANDARD_SCENARIOS } from "./experiment/APIExperimentRunner.ts";
export type {
  TestScenario,
  APIMeasurement,
  SimMeasurement,
  ComparisonReport,
  CalibrationParams
} from "./experiment/APIExperimentRunner.ts";
export { StatisticalReporter, statisticalReporter } from "./experiment/StatisticalReporter.ts";
export type {
  Measurement,
  MetricStats,
  StatisticalSummary,
  ExperimentConditions,
  StatisticalTest
} from "./experiment/StatisticalReporter.ts";

// ==================== Calibration Feedback Loop ====================
export { CalibrationFeedbackLoop } from "./experiment/CalibrationFeedbackLoop.ts";
export type {
  ConvergenceCriteria,
  CalibrationIterationResult,
  CalibrationFeedbackLoopResult,
  CalibrationFeedbackLoopConfig
} from "./experiment/CalibrationFeedbackLoop.ts";

// ==================== Pipeline Module V2 ====================
export { ServingPipelineV2, createPipelineV2 } from "./pipeline/ServingPipelineV2.ts";
export type {
  PipelineV2Config,
  CacheType,
  SchedulerType,
  CacheLookupWithRequest,
  PipelineSchedulingResult,
  PipelineV2Result
} from "./pipeline/ServingPipelineV2.ts";
// ==================== Unified Metrics Types ====================
export {
  type LatencyMetrics,
  type ThroughputMetrics,
  type EfficiencyMetrics,
  type UnifiedMetrics,
  type LatencyPercentiles,
  type UnifiedPercentileMetrics,
  type MetricsSummary,
  type UnifiedMetricsStats,
  secondsToMs,
  msToSeconds,
  ratioToPercent,
  percentToRatio,
  createUnifiedMetrics,
  validateMetrics
} from "./types/index.ts";
