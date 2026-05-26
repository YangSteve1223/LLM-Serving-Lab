/**
 * Cache Module Index
 * 
 * Exports all cache-related components for prefix caching evaluation.
 */
export { RadixPrefixCacheManager, radixPrefixCacheManager } from "./RadixPrefixCacheManager.ts";
export type { 
  CacheEntry, 
  CacheStats, 
  CacheAwarePDSimulationResult, 
  EvictionStrategy,
  RadixTreeConfig,
  CourseCacheGroup
} from "./RadixPrefixCacheManager.ts";

export { HierarchicalKVCache, hierarchicalKVCache } from "./HierarchicalKVCache.ts";
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
} from "./HierarchicalKVCache.ts";

export { CacheExperimentRunner, createDefaultExperiment, createComprehensiveExperiment } from "./CacheExperimentRunner.ts";
export type {
  ExperimentType,
  ExperimentConfig,
  ExperimentMetrics,
  ExperimentResult,
  ExperimentReport
} from "./CacheExperimentRunner.ts";

// ==================== Abstract Cache Interface & Adapters ====================
export { AbstractPrefixCache } from "./AbstractPrefixCache.ts";
export type { CacheLookupResult, CacheStats } from "./AbstractPrefixCache.ts";

export { RadixCacheAdapter } from "./RadixCacheAdapter.ts";
export type { RadixCacheAdapterConfig } from "./RadixCacheAdapter.ts";

export { HashCacheAdapter } from "./HashCacheAdapter.ts";
export type { HashCacheAdapterConfig } from "./HashCacheAdapter.ts";

// ==================== KV-Cache Reuse Analyzer ====================
export {
  KVCacheReuseAnalyzer,
  createReuseAnalyzer,
  defaultReuseAnalyzer,
  type KVCacheReuseMetrics,
  type CostAnalysis,
  type DetailedReuseStats,
  type ReuseSegment,
  type CacheComparisonResult
} from "./KVCacheReuseAnalyzer.ts";