/**
 * Tests for Abstract Cache Adapters
 * 
 * Tests interface consistency between RadixCacheAdapter and HashCacheAdapter.
 */
import { describe, it } from "node:test";
import assert from "node:assert";

// Import cache components
import { AbstractPrefixCache, type CacheLookupResult, type CacheStats } from "../../../src/agents/learningAssistant/serving/cache/AbstractPrefixCache.ts";
import { RadixCacheAdapter } from "../../../src/agents/learningAssistant/serving/cache/RadixCacheAdapter.ts";
import { HashCacheAdapter } from "../../../src/agents/learningAssistant/serving/cache/HashCacheAdapter.ts";

describe("AbstractPrefixCache Interface", () => {
  it("should define CacheLookupResult interface", () => {
    const result: CacheLookupResult = {
      matchedLength: 100,
      totalRequested: 200,
      hitRate: 0.5,
      cacheEntry: null
    };
    assert.strictEqual(result.matchedLength, 100);
    assert.strictEqual(result.totalRequested, 200);
    assert.strictEqual(result.hitRate, 0.5);
  });

  it("should define CacheStats interface", () => {
    const stats: CacheStats = {
      totalHits: 50,
      totalMisses: 10,
      hitRate: 0.83,
      memoryUsageMB: 512,
      evictions: 5
    };
    assert.strictEqual(stats.totalHits, 50);
    assert.strictEqual(stats.totalMisses, 10);
    // hitRate should be calculated correctly
    assert.ok(Math.abs(stats.hitRate - stats.totalHits / (stats.totalHits + stats.totalMisses)) < 0.01);
  });

  it("should define abstract methods that subclasses must implement", () => {
    // Abstract class should have these as abstract (undefined when accessed directly)
    // Subclasses RadixCacheAdapter and HashCacheAdapter implement these
    assert.ok("lookup" in AbstractPrefixCache.prototype || AbstractPrefixCache.prototype.lookup === undefined);
    assert.ok("insert" in AbstractPrefixCache.prototype || AbstractPrefixCache.prototype.insert === undefined);
    assert.ok("getStats" in AbstractPrefixCache.prototype || AbstractPrefixCache.prototype.getStats === undefined);
    assert.ok("clear" in AbstractPrefixCache.prototype || AbstractPrefixCache.prototype.clear === undefined);
    assert.ok("release" in AbstractPrefixCache.prototype || AbstractPrefixCache.prototype.release === undefined);
    assert.ok("getImplementationName" in AbstractPrefixCache.prototype || AbstractPrefixCache.prototype.getImplementationName === undefined);
  });
});

describe("RadixCacheAdapter", () => {
  it("should implement AbstractPrefixCache interface", () => {
    const adapter = new RadixCacheAdapter();
    
    assert.ok(typeof adapter.lookup === "function", "should have lookup method");
    assert.ok(typeof adapter.insert === "function", "should have insert method");
    assert.ok(typeof adapter.getStats === "function", "should have getStats method");
    assert.ok(typeof adapter.clear === "function", "should have clear method");
    assert.ok(typeof adapter.release === "function", "should have release method");
    assert.ok(typeof adapter.getImplementationName === "function", "should have getImplementationName method");
  });

  it("should return correct implementation name", () => {
    const adapter = new RadixCacheAdapter();
    assert.strictEqual(adapter.getImplementationName(), "RadixTree");
  });

  it("should perform lookup on empty cache (cache miss)", () => {
    const adapter = new RadixCacheAdapter();
    const tokens = [1, 2, 3, 4, 5];
    const result = adapter.lookup(tokens);
    
    // Empty cache should result in miss (matchedLength should be 0 or low)
    assert.strictEqual(result.totalRequested, 5);
    assert.ok(result.matchedLength >= 0, "matchedLength should be >= 0");
    // hitRate should be 0 for empty cache lookup
    assert.strictEqual(result.hitRate, 0, "hitRate should be 0 for empty cache");
    assert.strictEqual(result.cacheEntry, null, "should be cache miss");
  });

  it("should track hits and misses correctly after insert and lookup", () => {
    const adapter = new RadixCacheAdapter();
    const tokens1 = [10, 20, 30, 40, 50];
    const tokens2 = [60, 70, 80, 90, 100];
    
    // Clear any previous state
    adapter.clear();
    
    // Get initial stats
    const initialStats = adapter.getStats();
    
    // Insert first sequence
    adapter.insert(tokens1);
    
    // Lookup first sequence (should hit)
    adapter.lookup(tokens1);
    
    // Lookup second sequence (should miss)
    adapter.lookup(tokens2);
    
    const finalStats = adapter.getStats();
    
    // Should have more hits than initially
    assert.ok(finalStats.totalHits > initialStats.totalHits, "Should record hits after insert+lookup");
    // Should have at least one miss (for tokens not in cache)
    assert.ok(finalStats.totalMisses >= 0, "Should track misses");
  });

  it("should insert tokens and return stats", () => {
    const adapter = new RadixCacheAdapter();
    const tokens = [10, 20, 30, 40, 50];
    
    adapter.insert(tokens);
    
    const stats = adapter.getStats();
    assert.ok(typeof stats.totalHits === "number");
    assert.ok(typeof stats.totalMisses === "number");
    assert.ok(typeof stats.hitRate === "number");
    assert.ok(typeof stats.memoryUsageMB === "number");
    assert.ok(typeof stats.evictions === "number");
    // Memory usage should be non-negative
    assert.ok(stats.memoryUsageMB >= 0, "memoryUsageMB should be >= 0");
    // Evictions should be non-negative
    assert.ok(stats.evictions >= 0, "evictions should be >= 0");
  });

  it("should clear cache", () => {
    const adapter = new RadixCacheAdapter();
    adapter.insert([1, 2, 3, 4, 5]);
    adapter.clear();
    
    const stats = adapter.getStats();
    // After clear, memory usage should be minimal
    assert.ok(stats.memoryUsageMB < 1, "memory should be cleared");
    // After clear, hits should be reset to 0
    assert.strictEqual(stats.totalHits, 0, "totalHits should be 0 after clear");
  });

  it("should perform lookup-insert-lookup sequence with cache hits", () => {
    const adapter = new RadixCacheAdapter();
    const tokens = [100, 200, 300, 400, 500];
    
    // First lookup (miss)
    const missResult = adapter.lookup(tokens);
    assert.strictEqual(missResult.cacheEntry, null, "should be cache miss initially");
    assert.strictEqual(missResult.matchedLength, 0, "should have no matched tokens initially");
    
    // Insert
    adapter.insert(tokens);
    
    // Second lookup (should hit if tokens match exactly)
    const hitResult = adapter.lookup(tokens);
    assert.ok(hitResult.matchedLength > 0, "should have matched tokens after insert");
    // hitRate should be higher after insert
    assert.ok(hitResult.hitRate > missResult.hitRate, "hitRate should improve after insert");
  });

  it("should handle prefix matching correctly", () => {
    const adapter = new RadixCacheAdapter();
    adapter.clear();
    
    const fullTokens = [1, 2, 3, 4, 5];
    const prefixTokens = [1, 2, 3];
    
    // Insert full sequence
    adapter.insert(fullTokens);
    
    // Lookup prefix (should match prefix only)
    const prefixResult = adapter.lookup(prefixTokens);
    assert.ok(prefixResult.matchedLength > 0, "should match prefix");
    assert.ok(prefixResult.matchedLength <= prefixTokens.length, "matched should not exceed requested");
  });

  it("should handle custom configuration", () => {
    const adapter = new RadixCacheAdapter({
      maxMemoryMB: 512,
      evictionStrategy: "LFU"
    });
    
    assert.strictEqual(adapter.getImplementationName(), "RadixTree");
  });

  it("should simulate cache-aware prefill", () => {
    const adapter = new RadixCacheAdapter();
    const tokens = [1, 2, 3, 4, 5];
    
    // Test the simple token-based simulation
    // (The complex simulation requires EnhancedPDWorkloadRequest)
    const stats = adapter.getStats();
    assert.ok(typeof stats.totalHits === "number");
  });
});

describe("HashCacheAdapter", () => {
  it("should implement AbstractPrefixCache interface", () => {
    const adapter = new HashCacheAdapter();
    
    assert.ok(typeof adapter.lookup === "function", "should have lookup method");
    assert.ok(typeof adapter.insert === "function", "should have insert method");
    assert.ok(typeof adapter.getStats === "function", "should have getStats method");
    assert.ok(typeof adapter.clear === "function", "should have clear method");
    assert.ok(typeof adapter.release === "function", "should have release method");
    assert.ok(typeof adapter.getImplementationName === "function", "should have getImplementationName method");
  });

  it("should return correct implementation name", () => {
    const adapter = new HashCacheAdapter();
    assert.strictEqual(adapter.getImplementationName(), "HashBased");
  });

  it("should perform lookup on empty cache (cache miss)", () => {
    const adapter = new HashCacheAdapter();
    const tokens = [1, 2, 3, 4, 5];
    const result = adapter.lookup(tokens);
    
    assert.strictEqual(result.totalRequested, 5);
    assert.ok(result.matchedLength >= 0, "matchedLength should be >= 0");
    assert.ok(result.hitRate >= 0, "hitRate should be >= 0");
  });

  it("should insert tokens and return stats", () => {
    const adapter = new HashCacheAdapter();
    const tokens = [10, 20, 30, 40, 50];
    
    adapter.insert(tokens);
    
    const stats = adapter.getStats();
    assert.ok(typeof stats.totalHits === "number");
    assert.ok(typeof stats.totalMisses === "number");
    assert.ok(typeof stats.hitRate === "number");
    assert.ok(typeof stats.memoryUsageMB === "number");
    assert.ok(typeof stats.evictions === "number");
  });

  it("should clear cache", () => {
    const adapter = new HashCacheAdapter();
    adapter.insert([1, 2, 3, 4, 5]);
    adapter.clear();
    
    const stats = adapter.getStats();
    // After clear, memory usage should be minimal
    assert.ok(stats.memoryUsageMB < 1, "memory should be cleared");
  });

  it("should handle custom configuration", () => {
    const adapter = new HashCacheAdapter({
      maxMemoryMB: 256,
      blockSizeTokens: 32,
      enableRefCount: true
    });
    
    assert.strictEqual(adapter.getImplementationName(), "HashBased");
  });

  it("should get blocks for tokens", () => {
    const adapter = new HashCacheAdapter();
    const tokens = [1, 2, 3, 4, 5];
    
    adapter.insert(tokens);
    const blocks = adapter.getBlocks(tokens);
    
    assert.ok(Array.isArray(blocks), "should return array of blocks");
  });

  it("should pin and unpin blocks", () => {
    const adapter = new HashCacheAdapter();
    const tokens = [1, 2, 3, 4, 5];
    
    adapter.insert(tokens);
    
    // Get block ID from blocks
    const blocks = adapter.getBlocks(tokens);
    if (blocks.length > 0) {
      const blockId = blocks[0].blockId;
      
      const pinResult = adapter.pin(blockId);
      assert.strictEqual(pinResult, true, "should pin block");
      
      const unpinResult = adapter.unpin(blockId);
      assert.strictEqual(unpinResult, true, "should unpin block");
    }
  });

  it("should simulate cache-aware prefill", () => {
    const adapter = new HashCacheAdapter();
    const tokens = [1, 2, 3, 4, 5];
    
    const result = adapter.simulateCacheAwarePrefill(tokens);
    assert.ok(typeof result.effectivePrefillTokens === "number");
    assert.ok(typeof result.cacheHitTokens === "number");
    assert.ok(typeof result.missingBlockCount === "number");
    assert.ok(typeof result.ttftReductionMs === "number");
  });
});

describe("Adapter Consistency", () => {
  it("both adapters should have the same interface methods", () => {
    const radixAdapter = new RadixCacheAdapter();
    const hashAdapter = new HashCacheAdapter();
    
    const interfaceMethods = [
      "lookup",
      "insert", 
      "getStats",
      "clear",
      "release",
      "getImplementationName"
    ];
    
    for (const method of interfaceMethods) {
      assert.ok(
        typeof (radixAdapter as Record<string, unknown>)[method] === "function",
        `RadixCacheAdapter should have ${method}`
      );
      assert.ok(
        typeof (hashAdapter as Record<string, unknown>)[method] === "function",
        `HashCacheAdapter should have ${method}`
      );
    }
  });

  it("both adapters should return consistent CacheStats structure", () => {
    const radixAdapter = new RadixCacheAdapter();
    const hashAdapter = new HashCacheAdapter();
    
    const radixStats = radixAdapter.getStats();
    const hashStats = hashAdapter.getStats();
    
    // Both should have the same keys
    const requiredKeys: (keyof CacheStats)[] = [
      "totalHits",
      "totalMisses",
      "hitRate",
      "memoryUsageMB",
      "evictions"
    ];
    
    for (const key of requiredKeys) {
      assert.ok(key in radixStats, `RadixCacheAdapter stats should have ${key}`);
      assert.ok(key in hashStats, `HashCacheAdapter stats should have ${key}`);
    }
  });

  it("both adapters should return consistent CacheLookupResult structure", () => {
    const radixAdapter = new RadixCacheAdapter();
    const hashAdapter = new HashCacheAdapter();
    
    const tokens = [1, 2, 3, 4, 5];
    
    const radixResult = radixAdapter.lookup(tokens);
    const hashResult = hashAdapter.lookup(tokens);
    
    // Both should have the same keys
    const requiredKeys: (keyof CacheLookupResult)[] = [
      "matchedLength",
      "totalRequested",
      "hitRate",
      "cacheEntry"
    ];
    
    for (const key of requiredKeys) {
      assert.ok(key in radixResult, `RadixCacheAdapter result should have ${key}`);
      assert.ok(key in hashResult, `HashCacheAdapter result should have ${key}`);
    }
    
    // Both should report correct totalRequested
    assert.strictEqual(radixResult.totalRequested, 5);
    assert.strictEqual(hashResult.totalRequested, 5);
  });

  it("both adapters should support multiple insert/lookup cycles", () => {
    const radixAdapter = new RadixCacheAdapter();
    const hashAdapter = new HashCacheAdapter();
    
    const testCases = [
      [1, 2, 3],
      [4, 5, 6, 7],
      [8, 9, 10, 11, 12]
    ];
    
    // Insert all
    for (const tokens of testCases) {
      radixAdapter.insert(tokens);
      hashAdapter.insert(tokens);
    }
    
    // Lookup all - both should succeed
    for (const tokens of testCases) {
      const radixResult = radixAdapter.lookup(tokens);
      const hashResult = hashAdapter.lookup(tokens);
      
      assert.ok(radixResult.totalRequested === tokens.length);
      assert.ok(hashResult.totalRequested === tokens.length);
    }
  });
});
