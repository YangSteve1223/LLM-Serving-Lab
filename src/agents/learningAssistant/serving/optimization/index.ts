/**
 * Serving Optimization Module Index.
 * 
 * Exports all advanced serving optimization components:
 * - KVCacheCompressor: Attention entropy-based compression
 * - ContextBudgetPlanner: Intelligent context trimming
 * - ChunkedPrefillCoordinator: Cross-chunk cache coordination
 * - RLStrategySelector: Q-learning strategy selection
 */

// KV Cache Compressor
export {
  KVCacheCompressor,
  createCompressor,
  type QuantizationType,
  type AttentionEntropyScore,
  type LayerCompressionConfig,
  type KVCacheCompressionResult,
  type CompressionPolicy,
  type CompressorStats
} from "./KVCacheCompressor.ts";

// Context Budget Planner
export {
  ContextBudgetPlanner,
  createBudgetPlanner,
  type ComponentPriority,
  type BudgetDecision,
  type BudgetAllocation,
  type SystemState,
  type CompressionStrategy,
  type ContextBudgetConfig
} from "./ContextBudgetPlanner.ts";

// Chunked Prefill Coordinator
export {
  ChunkedPrefillCoordinator,
  RequestChunkCoordinator,
  createChunkedPrefillCoordinator,
  type ChunkBoundary,
  type ChunkCacheReference,
  type ChunkedPrefillPlan,
  type ChunkedPrefillConfig,
  type ChunkCoordinatorStats
} from "./ChunkedPrefillCoordinator.ts";

// RL Strategy Selector
export {
  RLStrategySelector,
  createRLStrategySelector,
  runRLEpisode,
  type SchedulingStrategy,
  type CompressionLevel,
  type SystemState as RLSystemState,
  type Action,
  type QTable,
  type LearningExperience,
  type RLStrategyStats,
  type StrategyDecision,
  type RLConfig,
  type RLIntegrationCallbacks
} from "./RLStrategySelector.ts";
