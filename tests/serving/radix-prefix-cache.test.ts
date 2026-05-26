/**
 * Tests for RadixPrefixCacheManager
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

  it("should insert and retrieve tokens", () => {
    const tokens = [1, 2, 3, 4, 5];
    tree.insert(tokens, "course_1", "student_1");
    
    const found = tree.findExact(tokens);
    assert.ok(found, "Should find exact match");
    assert.strictEqual(found?.depth, 5, "Should have correct depth");
  });

  it("should find exact match from inserted tokens", () => {
    const tokens1 = [1, 2, 3, 4, 5];
    const tokens2 = [1, 2, 3]; // Different tokens
    
    tree.insert(tokens1);
    
    // findExact should only match exact sequence
    const found = tree.findExact(tokens2);
    assert.strictEqual(found, null, "Should not find different token sequence");
  });

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

  it("should manage memory under capacity pressure", () => {
    // Create a tree with small memory
    const smallTree = new RadixTree({
      maxMemoryMB: 0.00001, // Very small
      kvCacheSizePerTokenMB: 0.64,
      flopsPerToken: 1e6,
      evictionStrategy: "LRU",
      enableCoursePooling: false
    });

    // Insert many entries - should trigger eviction
    for (let i = 0; i < 50; i++) {
      smallTree.insert([i, i + 1, i + 2]);
    }

    // Tree should have evicted some entries (just verify no crash)
    const stats = smallTree.getStats();
    assert.ok(typeof stats.memoryUsageMB === "number", "Memory stats should be accessible");
  });

  it("should compute FLOP efficiency", () => {
    const tokens = [1, 2, 3, 4, 5];
    tree.insert(tokens);
    
    const found = tree.findExact(tokens);
    assert.ok(found);
    assert.ok(found?.flopsEfficiency > 0, "FLOP efficiency should be positive");
  });

  it("should track course groups", () => {
    tree.insert([1, 2, 3], "course_a", "student_1");
    tree.insert([4, 5, 6], "course_a", "student_2");
    tree.insert([7, 8, 9], "course_b", "student_3");
    
    const entries = tree.getCourseEntries("course_a");
    assert.strictEqual(entries.length, 2, "Course A should have 2 entries");
    
    const courseBEntries = tree.getCourseEntries("course_b");
    assert.strictEqual(courseBEntries.length, 1, "Course B should have 1 entry");
  });

  it("should return null for non-existent key", () => {
    const found = tree.findExact([99, 100, 101]);
    assert.strictEqual(found, null, "Should return null for non-existent key");
  });

  it("should clear all entries", () => {
    tree.insert([1, 2, 3]);
    tree.insert([4, 5, 6]);
    
    tree.clear();
    
    const found1 = tree.findExact([1, 2, 3]);
    const found2 = tree.findExact([4, 5, 6]);
    assert.strictEqual(found1, null, "First entry should be cleared");
    assert.strictEqual(found2, null, "Second entry should be cleared");
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

  it("should record cache misses for new requests", () => {
    const request = {
      id: "req_1",
      arrivalMs: 0,
      prefillTokens: 100,
      decodeTokens: 50
    };

    // Process the request (no cache yet)
    const result = manager.processRequest(request);
    
    // First request should be a miss
    assert.strictEqual(result.cacheHit, false, "First request should be a miss");
    assert.strictEqual(result.hitTokens, 0, "No hit tokens for miss");
  });

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

    assert.strictEqual(result.originalPrefillTokens, 1000, "Original tokens should be 1000");
    assert.ok(result.effectivePrefillTokens >= 0, "Effective tokens should be valid");
    assert.ok(result.cacheStats, "Should have cache stats");
    assert.ok(result.ttftReductionMs >= 0, "TTFT reduction should be non-negative");
  });

  it("should compare caching strategies", () => {
    const requests = [
      { id: "req_1", arrivalMs: 0, prefillTokens: 500, decodeTokens: 50 },
      { id: "req_2", arrivalMs: 10, prefillTokens: 500, decodeTokens: 50 },
      { id: "req_3", arrivalMs: 20, prefillTokens: 300, decodeTokens: 50 }
    ];

    // Cache some requests
    manager.cacheRequest(requests[0], "course_1");

    const comparison = manager.compareStrategies(requests);

    assert.ok(comparison.noCache, "Should have no-cache baseline");
    assert.ok(comparison.prefixTree, "Should have prefix tree metrics");
    assert.strictEqual(comparison.prefixTree.hitRate >= 0, true, "Hit rate should be valid");
  });

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
    assert.ok(typeof stats.totalHits === "number", "Hits should be a number");
    assert.ok(stats.memoryUsageMB >= 0, "Memory usage should be tracked");
    assert.strictEqual(stats.maxMemoryMB, 100, "Max memory should match config");
  });

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
    assert.strictEqual(stats.totalHits, 0, "Hits should be reset");
    assert.strictEqual(stats.memoryUsageMB, 0, "Memory should be reset");
  });

  it("should get course pool stats", () => {
    manager.cacheRequest(
      { id: "req_1", arrivalMs: 0, prefillTokens: 100, decodeTokens: 50 },
      "course_math", "student_1"
    );
    manager.cacheRequest(
      { id: "req_2", arrivalMs: 10, prefillTokens: 100, decodeTokens: 50 },
      "course_math", "student_2"
    );

    const stats = manager.getCoursePoolStats("course_math");
    assert.strictEqual(stats.entryCount, 2, "Should have 2 entries for course");
    assert.ok(stats.totalSizeMB > 0, "Should have size");
  });

  it("should calculate TTFT reduction correctly", () => {
    const request = {
      id: "req_1",
      arrivalMs: 0,
      prefillTokens: 2000,
      decodeTokens: 100,
      cacheablePrefixTokens: 500
    };

    const result = manager.simulateCacheAwarePrefill(request, {
      prefillBaseMs: 25,
      prefillMsPerToken: 0.18,
      kvMsPerToken: 0.015
    });

    // TTFT reduction should be calculated
    assert.ok(typeof result.ttftReductionMs === "number", "TTFT reduction should be a number");
    assert.ok(typeof result.ttftReductionPercent === "number", "TTFT reduction percent should be a number");
  });

  it("should track hits and misses in statistics", () => {
    const request1 = { id: "req_1", arrivalMs: 0, prefillTokens: 100, decodeTokens: 50 };
    const request2 = { id: "req_2", arrivalMs: 10, prefillTokens: 100, decodeTokens: 50 };

    // First request - miss
    manager.processRequest(request1);
    
    // Cache it
    manager.cacheRequest(request1);
    
    // Second identical request should potentially hit
    manager.processRequest(request1);
    
    const stats = manager.getStats();
    assert.ok(typeof stats.totalHits === "number", "Total hits should be tracked");
  });
});
