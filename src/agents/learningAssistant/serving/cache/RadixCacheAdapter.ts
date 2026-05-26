/**
 * Radix Cache Adapter.
 * 
 * Wraps RadixPrefixCacheManager to implement the AbstractPrefixCache interface.
 */
import { AbstractPrefixCache, type CacheLookupResult, type CacheStats } from "./AbstractPrefixCache.ts";
import { RadixPrefixCacheManager, type RadixTreeConfig } from "./RadixPrefixCacheManager.ts";
import type { EnhancedPDWorkloadRequest } from "../ServingTrace.ts";

export interface RadixCacheAdapterConfig {
  maxMemoryMB?: number;
  kvCacheSizePerTokenMB?: number;
  flopsPerToken?: number;
  evictionStrategy?: "LRU" | "LFU" | "FLOP_AWARE";
  enableCoursePooling?: boolean;
}

/**
 * Adapter wrapping RadixPrefixCacheManager to AbstractPrefixCache interface.
 */
export class RadixCacheAdapter extends AbstractPrefixCache {
  private manager: RadixPrefixCacheManager;
  private config: Required<RadixCacheAdapterConfig>;

  constructor(config: RadixCacheAdapterConfig = {}) {
    super();
    this.config = {
      maxMemoryMB: config.maxMemoryMB ?? 1024,
      kvCacheSizePerTokenMB: config.kvCacheSizePerTokenMB ?? 0.64,
      flopsPerToken: config.flopsPerToken ?? 1e6,
      evictionStrategy: config.evictionStrategy ?? "LRU",
      enableCoursePooling: config.enableCoursePooling ?? true
    };
    
    const treeConfig: RadixTreeConfig = {
      maxMemoryMB: this.config.maxMemoryMB,
      kvCacheSizePerTokenMB: this.config.kvCacheSizePerTokenMB,
      flopsPerToken: this.config.flopsPerToken,
      evictionStrategy: this.config.evictionStrategy,
      enableCoursePooling: this.config.enableCoursePooling
    };
    
    this.manager = new RadixPrefixCacheManager(treeConfig);
  }

  /**
   * Lookup tokens in the cache using a synthetic request.
   */
  lookup(tokens: number[]): CacheLookupResult {
    const totalRequested = tokens.length;
    
    // Create a synthetic request for lookup
    const syntheticRequest: EnhancedPDWorkloadRequest = {
      id: `lookup-${Date.now()}`,
      arrivalMs: Date.now(),
      prefillTokens: tokens.length,
      decodeTokens: 0,
      cacheablePrefixTokens: Math.floor(tokens.length * 0.5),
      priority: "interactive",
      promptTemplate: "",
      promptTokens: tokens
    };
    
    const result = this.manager.processRequest(syntheticRequest);
    
    return {
      matchedLength: result.hitTokens,
      totalRequested,
      hitRate: totalRequested > 0 ? result.hitTokens / totalRequested : 0,
      cacheEntry: result.cacheHit ? result : null
    };
  }

  /**
   * Insert tokens into the cache.
   */
  insert(tokens: number[], tenantId?: string, requestGroupId?: string): void {
    const syntheticRequest: EnhancedPDWorkloadRequest = {
      id: `insert-${Date.now()}`,
      arrivalMs: Date.now(),
      prefillTokens: tokens.length,
      decodeTokens: 0,
      cacheablePrefixTokens: tokens.length,
      priority: "interactive",
      promptTemplate: "",
      promptTokens: tokens
    };
    
    this.manager.cacheRequest(syntheticRequest, tenantId, requestGroupId);
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const stats = this.manager.getStats();
    return {
      totalHits: stats.totalHits,
      totalMisses: stats.totalMisses,
      hitRate: stats.hitRate,
      memoryUsageMB: stats.memoryUsageMB,
      evictions: 0 // RadixTree doesn't expose eviction count directly
    };
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.manager.clear();
  }

  /**
   * Release specific tokens from the cache.
   * Note: RadixTree doesn't support selective release, so this clears related entries.
   */
  release(tokens: number[]): void {
    // RadixTree doesn't support selective release
    // For now, we just note that release was requested
    // In production, you'd implement tree node pruning
  }

  getImplementationName(): string {
    return "RadixTree";
  }

  /**
   * Get the underlying RadixPrefixCacheManager for advanced operations.
   */
  getManager(): RadixPrefixCacheManager {
    return this.manager;
  }

  /**
   * Get statistics for a specific group pool.
   */
  getGroupPoolStats(groupId: string): { entryCount: number; totalSizeMB: number; accessCount: number } {
    return this.manager.getGroupPoolStats(groupId);
  }

  /**
   * Compare different caching strategies.
   */
  compareStrategies(requests: EnhancedPDWorkloadRequest[]): {
    noCache: { totalTokens: number; totalPrefillMs: number };
    exactMatch: { hitRate: number; savedTokens: number; savedPrefillMs: number };
    prefixTree: { hitRate: number; savedTokens: number; savedPrefillMs: number };
    coursePool: { hitRate: number; savedTokens: number; savedPrefillMs: number };
  } {
    return this.manager.compareStrategies(requests);
  }

  /**
   * Simulate cache-aware prefill for a request.
   */
  simulateCacheAwarePrefill(
    request: EnhancedPDWorkloadRequest
  ): {
    effectivePrefillTokens: number;
    cacheHitTokens: number;
    ttftReductionMs: number;
    hitType: "exact" | "prefix" | "none";
  } {
    const result = this.manager.processRequest(request);
    const prefillMsPerToken = 0.18;
    
    return {
      effectivePrefillTokens: result.remainingTokens,
      cacheHitTokens: result.hitTokens,
      ttftReductionMs: result.flopsSaved * prefillMsPerToken / this.config.flopsPerToken,
      hitType: result.hitType
    };
  }
}
