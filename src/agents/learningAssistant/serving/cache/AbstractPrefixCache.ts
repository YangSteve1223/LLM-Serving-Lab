/**
 * Abstract Prefix Cache Interface.
 * 
 * Provides a unified interface for different cache implementations (Radix, Hash-based).
 * This enables swapping cache strategies without changing consuming code.
 */
export interface CacheLookupResult {
  matchedLength: number;      // Number of matched tokens
  totalRequested: number;     // Total requested tokens
  hitRate: number;            // Hit rate for this lookup
  cacheEntry: unknown | null;  // The matched cache entry (type depends on implementation)
}

export interface CacheStats {
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  memoryUsageMB: number;
  evictions: number;
}

export abstract class AbstractPrefixCache {
  /**
   * Lookup tokens in the cache.
   * @param tokens - Token sequence to look up
   * @returns CacheLookupResult with match details
   */
  abstract lookup(tokens: number[]): CacheLookupResult;

  /**
   * Insert tokens into the cache.
   * @param tokens - Token sequence to insert
   */
  abstract insert(tokens: number[]): void;

  /**
   * Get cache statistics.
   * @returns CacheStats object
   */
  abstract getStats(): CacheStats;

  /**
   * Clear all entries from the cache.
   */
  abstract clear(): void;

  /**
   * Release specific tokens from the cache.
   * @param tokens - Token sequence to release
   */
  abstract release(tokens: number[]): void;

  /**
   * Get the name of the cache implementation.
   */
  abstract getImplementationName(): string;
}
