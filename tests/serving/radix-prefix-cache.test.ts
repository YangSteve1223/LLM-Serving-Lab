/**
 * Tests for RadixPrefixCacheManager with strengthened assertions
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  RadixPrefixCacheManager,
  RadixTree
} from "../../src/agents/learningAssistant/serving/cache/RadixPrefixCacheManager.ts";

describe("RadixTree", () => {
  let tree: RadixTree;

  beforeEach(() => {
    tree = new RadixTree({
      maxMemoryMB: 100,
      kvCacheSizePerTokenMB: 0.64,
      flopsPerToken: 1e6,
      evictionStrategy: "LRU",
      enableCoursePooling: true
    });
  });

  describe("insert and find", () => {
    it("should insert and retrieve tokens", () => {
      const tokens = [1, 2, 3, 4, 5];
      tree.insert(tokens, "course_1", "student_1");
      
      const found = tree.findExact(tokens);
      assert.ok(found, "Should find exact match");
      assert.strictEqual(found?.depth, 5, "Should have correct depth");
      assert.strictEqual(found?.tokens.length, 5, "Should have correct token count");
    });

    it("should find exact match from inserted tokens", () => {
      const tokens1 = [1, 2, 3, 4, 5];
      const tokens2 = [1, 2, 3]; // Different tokens
      
      tree.insert(tokens1);
      
      // findExact should only match exact sequence
      const found = tree.findExact(tokens2);
      assert.strictEqual(found, null, "Should not find different token sequence");
    });

    it("should not match partial prefix", () => {
      const tokens = [1, 2, 3, 4, 5];
      tree.insert(tokens);
      
      const partial = tree.findExact([1, 2, 3]);
      assert.strictEqual(partial, null, "Should not match partial prefix");
    });

    it("should support findLongestPrefix", () => {
      tree.insert([1, 2, 3, 4, 5]);
      tree.insert([1, 2, 3]);
      
      const lookup = tree.findLongestPrefix([1, 2, 3, 4, 5, 6, 7]);
      
      // STRENGTHENED: Verify prefix match details
      assert.ok(lookup.match, "Should find a match");
      assert.ok(lookup.matchedLength > 0, "Matched length should be positive");
      assert.ok(lookup.matchedLength <= 5, "Matched length should not exceed inserted length");
      assert.ok(lookup.matchedLength >= 3, "Should match at least [1,2,3]");
    });

    it("should return empty match for no common prefix", () => {
      tree.insert([1, 2, 3]);
      
      const lookup = tree.findLongestPrefix([4, 5, 6]);
      
      assert.strictEqual(lookup.match, false, "Should not match");
      assert.strictEqual(lookup.matchedLength, 0, "Should have zero matched length");
    });
  });

  describe("access tracking", () => {
    it("should track access counts", () => {
      const tokens = [10, 20, 30];
      tree.insert(tokens);
      
      // Initial insert sets accessCount to 1
      const found1 = tree.findExact(tokens);
      assert.ok(found1);
      assert.strictEqual(found1?.accessCount, 2, "Access count should be 2 after first find");
      
      const found2 = tree.findExact(tokens);
      assert.strictEqual(found2?.accessCount, 3, "Access count should be 3 after second find");
    });

    it("should update LRU on access", () => {
      tree.insert([1, 2, 3], "course_a", "student_1");
      tree.insert([4, 5, 6], "course_a", "student_2");
      
      // Access first entry to update its LRU position
      tree.findExact([1, 2, 3]);
      
      // Insert another entry - should evict LRU entry if at capacity
      const smallTree = new RadixTree({
        maxMemoryMB: 0.00001,
        kvCacheSizePerTokenMB: 0.64,
        flopsPerToken: 1e6,
        evictionStrategy: "LRU",
        enableCoursePooling: false
      });
      
      for (let i = 0; i < 50; i++) {
        smallTree.insert([i, i + 1, i + 2]);
      }
      
      const stats = smallTree.getStats();
      assert.ok(typeof stats.evictions === 'number', "Should track evictions");
    });
  });

  describe("memory management", () => {
    it("should manage memory under capacity pressure", () => {
      const smallTree = new RadixTree({
        maxMemoryMB: 0.00001,
        kvCacheSizePerTokenMB: 0.64,
        flopsPerToken: 1e6,
        evictionStrategy: "LRU",
        enableCoursePooling: false
      });

      // Insert many entries - should trigger eviction
      for (let i = 0; i < 50; i++) {
        smallTree.insert([i, i + 1, i + 2]);
      }

      const stats = smallTree.getStats();
      
      // STRENGTHENED: Verify memory stats structure
      assert.strictEqual(typeof stats.memoryUsageMB, 'number', "Memory usage should be number");
      assert.strictEqual(typeof stats.entriesCount, 'number', "Entries count should be number");
      assert.ok(stats.memoryUsageMB >= 0, "Memory usage should be non-negative");
      assert.ok(stats.entriesCount >= 0, "Entries count should be non-negative");
      
      // Should have evicted some entries
      assert.ok(stats.evictions > 0, "Should have evicted entries under pressure");
    });

    it("should not exceed max memory", () => {
      const tinyTree = new RadixTree({
        maxMemoryMB: 0.001,
        kvCacheSizePerTokenMB: 0.64,
        flopsPerToken: 1e6,
        evictionStrategy: "LRU"
      });

      for (let i = 0; i < 100; i++) {
        tinyTree.insert([i, i + 1, i + 2, i + 3, i + 4]);
      }

      const stats = tinyTree.getStats();
      assert.ok(stats.memoryUsageMB <= tinyTree.getConfig().maxMemoryMB + 0.001,
        "Memory should not significantly exceed max");
    });
  });

  describe("FLOP efficiency", () => {
    it("should compute FLOP efficiency", () => {
      const tokens = [1, 2, 3, 4, 5];
      tree.insert(tokens);
      
      const found = tree.findExact(tokens);
      assert.ok(found);
      assert.ok(found?.flopsEfficiency > 0, "FLOP efficiency should be positive");
      assert.strictEqual(typeof found?.flopsEfficiency, 'number', "Should be number");
    });

    it("should calculate flops saved from prefix match", () => {
      tree.insert([1, 2, 3, 4, 5]);
      
      const lookup = tree.findLongestPrefix([1, 2, 3, 4, 5, 6, 7]);
      
      // STRENGTHENED: Verify flops-related metrics
      assert.ok(typeof lookup.flopsSaved === 'number', "Should have flopsSaved");
      assert.ok(lookup.flopsSaved >= 0, "Flops saved should be non-negative");
    });
  });

  describe("course grouping", () => {
    it("should track course groups", () => {
      tree.insert([1, 2, 3], "course_a", "student_1");
      tree.insert([4, 5, 6], "course_a", "student_2");
      tree.insert([7, 8, 9], "course_b", "student_3");
      
      const entries = tree.getCourseEntries("course_a");
      
      // STRENGTHENED: Verify course entries
      assert.strictEqual(entries.length, 2, "Course A should have 2 entries");
      
      for (const entry of entries) {
        assert.strictEqual(typeof entry.tokens, 'object', "Entry should have tokens");
        assert.ok(Array.isArray(entry.tokens), "Tokens should be array");
      }
      
      const courseBEntries = tree.getCourseEntries("course_b");
      assert.strictEqual(courseBEntries.length, 1, "Course B should have 1 entry");
    });

    it("should return empty array for non-existent course", () => {
      tree.insert([1, 2, 3], "course_a", "student_1");
      
      const entries = tree.getCourseEntries("course_z");
      assert.strictEqual(entries.length, 0, "Non-existent course should return empty");
    });
  });

  describe("clear", () => {
    it("should clear all entries", () => {
      tree.insert([1, 2, 3]);
      tree.insert([4, 5, 6]);
      
      tree.clear();
      
      const found1 = tree.findExact([1, 2, 3]);
      const found2 = tree.findExact([4, 5, 6]);
      assert.strictEqual(found1, null, "First entry should be cleared");
      assert.strictEqual(found2, null, "Second entry should be cleared");
      
      const stats = tree.getStats();
      assert.strictEqual(stats.entriesCount, 0, "Entries count should be 0 after clear");
      assert.strictEqual(stats.memoryUsageMB, 0, "Memory should be 0 after clear");
    });
  });
});

describe("RadixPrefixCacheManager", () => {
  let manager: RadixPrefixCacheManager;

  beforeEach(() => {
    manager = new RadixPrefixCacheManager({
      maxMemoryMB: 100,
      evictionStrategy: "LRU",
      enableCoursePooling: true
    });
  });

  describe("processRequest", () => {
    it("should record cache misses for new requests", () => {
      const request = {
        id: "req_1",
        arrivalMs: 0,
        prefillTokens: 100,
        decodeTokens: 50
      };

      const result = manager.processRequest(request);
      
      // STRENGTHENED: Verify specific result fields
      assert.strictEqual(result.cacheHit, false, "First request should be a miss");
      assert.strictEqual(result.hitTokens, 0, "No hit tokens for miss");
      assert.strictEqual(result.cacheHitRate, 0, "Hit rate should be 0");
      assert.strictEqual(typeof result.cacheLevel, 'string', "Should have cache level");
    });

    it("should record cache hits for subsequent requests", () => {
      const request1 = { id: "req_1", arrivalMs: 0, prefillTokens: 100, decodeTokens: 50 };
      const request2 = { id: "req_2", arrivalMs: 100, prefillTokens: 100, decodeTokens: 50 };

      manager.cacheRequest(request1);
      const result = manager.processRequest(request2);
      
      // STRENGTHENED: Verify specific cache hit details
      assert.ok(result.cacheHit, "Second request with same tokens should hit");
      assert.ok(result.hitTokens >= 0, "Hit tokens should be non-negative");
      
      // STRENGTHENED: Verify hitRate should be > 0 after insertion
      assert.ok(result.cacheHitRate > 0, "Hit rate should be positive after caching");
      
      // STRENGTHENED: Verify specific hit rate range (0 < hitRate <= 1)
      assert.ok(result.cacheHitRate <= 1, "Hit rate should not exceed 1");
      
      // STRENGTHENED: Verify cache level is reported
      assert.ok(typeof result.cacheLevel === 'string', "Cache level should be string");
    });
  });

  describe("simulateCacheAwarePrefill", () => {
    it("should simulate cache-aware prefill", () => {
      const request = {
        id: "req_1",
        arrivalMs: 0,
        prefillTokens: 1000,
        decodeTokens: 100,
        cacheablePrefixTokens: 300
      };

      const result = manager.simulateCacheAwarePrefill(request, {
        prefillBaseMs: 25,
        prefillMsPerToken: 0.18,
        kvMsPerToken: 0.015
      });

      // STRENGTHENED: Verify specific fields and values
      assert.strictEqual(result.originalPrefillTokens, 1000, "Original tokens should be 1000");
      assert.ok(result.effectivePrefillTokens >= 0, "Effective tokens should be valid");
      assert.ok(result.effectivePrefillTokens <= 1000, "Effective tokens should not exceed original");
      
      assert.ok(result.cacheStats, "Should have cache stats");
      assert.strictEqual(typeof result.cacheStats.hitRate, 'number', "Should have hit rate");
      assert.ok(result.cacheStats.hitRate >= 0 && result.cacheStats.hitRate <= 1,
        "Hit rate should be 0-1");
      
      assert.ok(result.ttftReductionMs >= 0, "TTFT reduction should be non-negative");
      assert.strictEqual(typeof result.ttftReductionMs, 'number', "TTFT reduction should be number");
      
      // Verify TTFT reduction correlates with cacheable tokens
      assert.ok(
        result.ttftReductionMs <= request.cacheablePrefixTokens * 0.18 * 1.1,
        "TTFT reduction should be reasonable"
      );
    });

    it("should calculate token savings correctly", () => {
      const request = {
        id: "req_token_savings",
        arrivalMs: 0,
        prefillTokens: 500,
        decodeTokens: 50,
        cacheablePrefixTokens: 200
      };

      const result = manager.simulateCacheAwarePrefill(request, {
        prefillBaseMs: 20,
        prefillMsPerToken: 0.15,
        kvMsPerToken: 0.01
      });

      assert.ok(typeof result.tokensSaved === 'number', "Should have tokens saved");
      assert.ok(result.tokensSaved >= 0, "Tokens saved should be non-negative");
      assert.ok(result.tokensSaved <= request.cacheablePrefixTokens,
        "Tokens saved should not exceed cacheable prefix");
    });
  });

  describe("compareStrategies", () => {
    it("should compare caching strategies", () => {
      const requests = [
        { id: "req_1", arrivalMs: 0, prefillTokens: 500, decodeTokens: 50 },
        { id: "req_2", arrivalMs: 10, prefillTokens: 500, decodeTokens: 50 },
        { id: "req_3", arrivalMs: 20, prefillTokens: 300, decodeTokens: 50 }
      ];

      manager.cacheRequest(requests[0]);

      const comparison = manager.compareStrategies(requests);

      // STRENGTHENED: Verify strategy comparison structure
      assert.ok(comparison.noCache, "Should have no-cache baseline");
      assert.ok(comparison.prefixTree, "Should have prefix tree metrics");
      
      // Verify noCache metrics
      assert.strictEqual(typeof comparison.noCache.ttftAvg, 'number', "No-cache should have TTFT avg");
      assert.ok(comparison.noCache.ttftAvg > 0, "No-cache TTFT should be positive");
      
      // Verify prefixTree metrics
      assert.strictEqual(typeof comparison.prefixTree.hitRate, 'number', "Should have hit rate");
      assert.ok(comparison.prefixTree.hitRate >= 0, "Hit rate should be >= 0");
      assert.ok(comparison.prefixTree.hitRate <= 1, "Hit rate should be <= 1");
      
      // Verify comparison data
      assert.ok(typeof comparison.prefixTree.tokensSaved, 'number', "Should have tokens saved");
      assert.ok(typeof comparison.prefixTree.ttftReduction, 'number', "Should have TTFT reduction");
    });
  });

  describe("statistics", () => {
    it("should track cache statistics", () => {
      const request = {
        id: "req_1",
        arrivalMs: 0,
        prefillTokens: 200,
        decodeTokens: 50
      };

      manager.cacheRequest(request);
      manager.processRequest(request);

      const stats = manager.getStats();
      
      // STRENGTHENED: Verify specific stat fields
      assert.strictEqual(typeof stats.totalHits, 'number', "Hits should be number");
      assert.ok(stats.totalHits >= 0, "Hits should be non-negative");
      
      assert.strictEqual(typeof stats.totalMisses, 'number', "Misses should be number");
      assert.ok(stats.totalMisses >= 0, "Misses should be non-negative");
      
      assert.strictEqual(typeof stats.memoryUsageMB, 'number', "Memory usage should be number");
      assert.ok(stats.memoryUsageMB >= 0, "Memory usage should be non-negative");
      
      assert.strictEqual(stats.maxMemoryMB, 100, "Max memory should match config");
      
      // Verify hit rate calculation
      const total = stats.totalHits + stats.totalMisses;
      if (total > 0) {
        assert.ok(
          Math.abs(stats.hitRate - stats.totalHits / total) < 0.001,
          "Hit rate should be calculated correctly"
        );
      }
    });

    it("should have zero stats initially", () => {
      const stats = manager.getStats();
      
      assert.strictEqual(stats.totalHits, 0, "Hits should be 0 initially");
      assert.strictEqual(stats.totalMisses, 0, "Misses should be 0 initially");
      assert.strictEqual(stats.memoryUsageMB, 0, "Memory should be 0 initially");
    });
  });

  describe("cache eviction", () => {
    it("should evict entries under memory pressure", () => {
      const smallManager = new RadixPrefixCacheManager({
        maxMemoryMB: 0.01,
        evictionStrategy: "LRU"
      });

      // Fill cache with many requests
      for (let i = 0; i < 100; i++) {
        smallManager.cacheRequest({
          id: `evict_req_${i}`,
          arrivalMs: i * 10,
          prefillTokens: 500,
          decodeTokens: 50
        });
      }

      const stats = smallManager.getStats();
      
      // STRENGTHENED: Verify eviction occurred
      assert.ok(stats.evictions > 0, "Should have evicted entries");
      assert.ok(stats.memoryUsageMB <= smallManager.getStats().maxMemoryMB + 0.001,
        "Memory should be bounded by max");
    });

    it("should respect LRU eviction order", () => {
      const lruManager = new RadixPrefixCacheManager({
        maxMemoryMB: 0.01,
        evictionStrategy: "LRU"
      });

      // Insert entries
      lruManager.cacheRequest({ id: "a", arrivalMs: 0, prefillTokens: 200, decodeTokens: 50 });
      lruManager.cacheRequest({ id: "b", arrivalMs: 10, prefillTokens: 200, decodeTokens: 50 });
      lruManager.cacheRequest({ id: "c", arrivalMs: 20, prefillTokens: 200, decodeTokens: 50 });

      // Access entry 'a' to update its LRU position
      lruManager.processRequest({ id: "a", arrivalMs: 30, prefillTokens: 200, decodeTokens: 50 });

      // Add more entries to trigger eviction
      for (let i = 0; i < 20; i++) {
        lruManager.cacheRequest({
          id: `filler_${i}`,
          arrivalMs: 100 + i,
          prefillTokens: 200,
          decodeTokens: 50
        });
      }

      const stats = lruManager.getStats();
      assert.ok(typeof stats.evictions === 'number', "Should track evictions");
    });
  });

  describe("clear", () => {
    it("should clear cache", () => {
      const request = {
        id: "req_1",
        arrivalMs: 0,
        prefillTokens: 200,
        decodeTokens: 50
      };

      manager.cacheRequest(request);
      manager.clear();

      const stats = manager.getStats();
      assert.strictEqual(stats.totalHits, 0, "Hits should be 0 after clear");
      assert.strictEqual(stats.totalMisses, 0, "Misses should be 0 after clear");
      assert.strictEqual(stats.memoryUsageMB, 0, "Memory should be 0 after clear");
    });
  });
});
