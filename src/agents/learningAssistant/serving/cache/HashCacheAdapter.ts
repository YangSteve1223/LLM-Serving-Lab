/**
 * Hash Cache Adapter.
 * 
 * Wraps HashBasedPrefixCache to implement the AbstractPrefixCache interface.
 * Simulates vLLM's Automatic Prefix Caching mechanism.
 */
import { AbstractPrefixCache, type CacheLookupResult, type CacheStats } from "./AbstractPrefixCache.ts";
import { 
  HashBasedPrefixCache, 
  type HashCacheConfig, 
  type HashCacheStats,
  type HashLookupResult 
} from "../alignment/HashBasedPrefixCache.ts";

export interface HashCacheAdapterConfig {
  maxMemoryMB?: number;
  blockSizeTokens?: number;
  enableRefCount?: boolean;
  enableLRU?: boolean;
}

/**
 * Adapter wrapping HashBasedPrefixCache to AbstractPrefixCache interface.
 */
export class HashCacheAdapter extends AbstractPrefixCache {
  private cache: HashBasedPrefixCache;
  private config: Required<HashCacheAdapterConfig>;

  constructor(config: HashCacheAdapterConfig = {}) {
    super();
    this.config = {
      maxMemoryMB: config.maxMemoryMB ?? 1024,
      blockSizeTokens: config.blockSizeTokens ?? 64,
      enableRefCount: config.enableRefCount ?? true,
      enableLRU: config.enableLRU ?? true
    };
    
    const hashConfig: Partial<HashCacheConfig> = {
      maxMemoryMB: this.config.maxMemoryMB,
      blockSizeTokens: this.config.blockSizeTokens,
      enableRefCount: this.config.enableRefCount,
      enableLRU: this.config.enableLRU
    };
    
    this.cache = new HashBasedPrefixCache(hashConfig);
  }

  lookup(tokens: number[]): CacheLookupResult {
    const totalRequested = tokens.length;
    const hashResult: HashLookupResult = this.cache.lookup(tokens);
    
    // Calculate matched tokens from block count
    const matchedLength = hashResult.chainMatchLength * this.config.blockSizeTokens;
    
    return {
      matchedLength,
      totalRequested,
      hitRate: totalRequested > 0 ? matchedLength / totalRequested : 0,
      cacheEntry: hashResult.block
    };
  }

  insert(tokens: number[]): void {
    this.cache.insert(tokens);
  }

  getStats(): CacheStats {
    const stats: HashCacheStats = this.cache.getStats();
    return {
      totalHits: stats.totalHits,
      totalMisses: stats.totalMisses,
      hitRate: stats.hitRate,
      memoryUsageMB: stats.memoryUsageMB,
      evictions: stats.evictions
    };
  }

  clear(): void {
    // HashBasedPrefixCache doesn't have a clear method, so we recreate it
    this.cache = new HashBasedPrefixCache({
      maxMemoryMB: this.config.maxMemoryMB,
      blockSizeTokens: this.config.blockSizeTokens,
      enableRefCount: this.config.enableRefCount,
      enableLRU: this.config.enableLRU
    });
  }

  release(tokens: number[]): void {
    // Get blocks for these tokens and release them
    const blocks = this.cache.getBlocks(tokens);
    const blockIds = blocks.map(b => b.blockId);
    this.cache.release(blockIds);
  }

  getImplementationName(): string {
    return "HashBased";
  }

  /**
   * Get the underlying HashBasedPrefixCache for advanced operations.
   */
  getCache(): HashBasedPrefixCache {
    return this.cache;
  }

  /**
   * Pin a block to prevent eviction.
   */
  pin(blockId: string): boolean {
    return this.cache.pin(blockId);
  }

  /**
   * Unpin a block.
   */
  unpin(blockId: string): boolean {
    return this.cache.unpin(blockId);
  }

  /**
   * Get blocks for a token sequence.
   */
  getBlocks(tokens: number[]): { blockId: string; tokens: number[]; refCount: number }[] {
    return this.cache.getBlocks(tokens).map(block => ({
      blockId: block.blockId,
      tokens: block.tokens,
      refCount: block.refCount
    }));
  }

  /**
   * Get detailed statistics from the underlying cache.
   */
  getDetailedStats(): HashCacheStats {
    return this.cache.getStats();
  }

  /**
   * Simulate cache-aware prefill calculation.
   */
  simulateCacheAwarePrefill(tokens: number[]): {
    effectivePrefillTokens: number;
    cacheHitTokens: number;
    missingBlockCount: number;
    ttftReductionMs: number;
  } {
    const result = this.cache.lookup(tokens);
    const cacheHitTokens = result.chainMatchLength * this.config.blockSizeTokens;
    const effectivePrefillTokens = Math.max(0, tokens.length - cacheHitTokens);
    
    // Estimate TTFT reduction
    const prefillMsPerToken = 0.18;
    const ttftReductionMs = cacheHitTokens * prefillMsPerToken;
    
    return {
      effectivePrefillTokens,
      cacheHitTokens,
      missingBlockCount: result.missingBlocks.length,
      ttftReductionMs
    };
  }
}
