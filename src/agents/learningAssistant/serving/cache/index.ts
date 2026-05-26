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
