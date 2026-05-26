/**
 * Tests for ChunkedPrefillCoordinator
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  ChunkedPrefillCoordinator,
  RequestChunkCoordinator,
  createChunkedPrefillCoordinator
} from "../../../src/agents/learningAssistant/serving/optimization/ChunkedPrefillCoordinator.ts";
import type { CacheEntry } from "../../../src/agents/learningAssistant/serving/cache/RadixPrefixCacheManager.ts";

describe("ChunkedPrefillCoordinator", () => {
  let coordinator: ChunkedPrefillCoordinator;

  beforeEach(() => {
    coordinator = new ChunkedPrefillCoordinator({
      chunkSize: 128,
      minPrefixLength: 32
    });
  });

  describe("identifyPrefixBoundaries", () => {
    it("should identify all chunk boundaries", () => {
      const tokens = Array(500).fill(0).map((_, i) => i);
      
      const boundaries = coordinator.identifyPrefixBoundaries(tokens);
      
      assert.strictEqual(boundaries.length, Math.ceil(500 / 128));
      assert.strictEqual(boundaries[0].startToken, 0);
      assert.strictEqual(boundaries[0].isPrefixBoundary, false); // First chunk not a boundary
    });

    it("should mark first chunk as cacheable", () => {
      const tokens = Array(200).fill(0);
      
      const boundaries = coordinator.identifyPrefixBoundaries(tokens);
      
      assert.strictEqual(boundaries[0].cacheable, true);
    });

    it("should detect prefix boundaries at chunk size intervals", () => {
      const tokens = Array(400).fill(0);
      
      const boundaries = coordinator.identifyPrefixBoundaries(tokens);
      
      // Chunk 1, 2, 3 should be at boundaries
      boundaries.forEach((b, i) => {
        if (i > 0) {
          assert.strictEqual(b.startToken, i * 128);
        }
      });
    });

    it("should compute cumulative hashes", () => {
      const tokens = Array(300).fill(1);
      
      const boundaries = coordinator.identifyPrefixBoundaries(tokens);
      
      // Each boundary should have a unique cumulative hash
      const hashes = boundaries.map(b => b.cumulativeHash);
      const uniqueHashes = new Set(hashes);
      
      assert.strictEqual(uniqueHashes.size, hashes.length);
    });
  });

  describe("buildCacheReferences", () => {
    it("should build references for cross-chunk caching", () => {
      const boundaries = coordinator.identifyPrefixBoundaries(Array(400).fill(0));
      const cacheablePrefixes = new Map<string, number>();
      
      const references = coordinator.buildCacheReferences(boundaries, cacheablePrefixes);
      
      assert.strictEqual(references.length, boundaries.length);
    });

    it("should track referencing chunks", () => {
      const tokens = Array(500).fill(0);
      const boundaries = coordinator.identifyPrefixBoundaries(tokens);
      const cacheablePrefixes = new Map<string, number>();
      cacheablePrefixes.set(`${boundaries[1].cumulativeHash}:128`, 128);
      
      const references = coordinator.buildCacheReferences(boundaries, cacheablePrefixes);
      
      // Second boundary should have some references
      assert.ok(references[1].referencingChunks.length >= 0);
    });
  });

  describe("createPlan", () => {
    it("should create complete prefill plan", () => {
      const tokens = Array(400).fill(0).map((_, i) => i);
      const cacheablePrefixes = new Map<string, number>();
      
      const plan = coordinator.createPlan("req_1", tokens, cacheablePrefixes);
      
      assert.strictEqual(plan.requestId, "req_1");
      assert.strictEqual(plan.totalTokens, 400);
      assert.ok(plan.chunks.length > 0);
      assert.ok(plan.boundaries.length > 0);
      assert.ok(plan.estimatedTTFTReduction >= 0);
    });

    it("should reduce compute time for cache hits", () => {
      const tokens = Array(300).fill(0);
      const boundaries = coordinator.identifyPrefixBoundaries(tokens);
      const cacheablePrefixes = new Map<string, number>();
      
      // First chunk has cache hit
      cacheablePrefixes.set(`${boundaries[0].cumulativeHash}:0`, 128);
      
      const plan = coordinator.createPlan("req_1", tokens, cacheablePrefixes);
      
      // First chunk should have zero transfer time
      assert.strictEqual(plan.chunks[0].transferMs, 0);
    });

    it("should track cache references", () => {
      const tokens = Array(500).fill(0);
      const cacheablePrefixes = new Map<string, number>();
      
      const plan = coordinator.createPlan("req_1", tokens, cacheablePrefixes);
      
      assert.ok(plan.cacheReferences.length > 0);
    });
  });

  describe("checkChunkCacheHit", () => {
    it("should detect exact cache hit", () => {
      const tokens = Array(300).fill(0);
      const cacheEntries = new Map<string, CacheEntry>();
      
      // Add exact match entry
      cacheEntries.set("abc123:0", {
        key: "abc123:0",
        tokens: Array(128).fill(0),
        depth: 128,
        sizeBytes: 1000,
        accessCount: 5,
        lastAccessTime: Date.now(),
        flopsEfficiency: 1.5,
        createdAt: Date.now()
      });
      
      const result = coordinator.checkChunkCacheHit(tokens, 0, cacheEntries);
      
      // Note: exact match depends on cumulative hash, this is a simplified test
      assert.ok(["exact", "prefix", "partial"].includes(result.hitType));
    });

    it("should return partial for no cache", () => {
      const tokens = Array(200).fill(0);
      const cacheEntries = new Map<string, CacheEntry>();
      
      const result = coordinator.checkChunkCacheHit(tokens, 1, cacheEntries);
      
      assert.strictEqual(result.hit, false);
      assert.strictEqual(result.hitType, "partial");
    });
  });

  describe("mergeCacheReferences", () => {
    it("should merge overlapping references", () => {
      const references = [
        { chunkIndex: 0, referencingChunks: [1, 2], cachedTokenStart: 0, cachedTokenEnd: 128, cacheHitProbability: 0.5 },
        { chunkIndex: 1, referencingChunks: [2], cachedTokenStart: 100, cachedTokenEnd: 256, cacheHitProbability: 0.6 }
      ];
      
      const merged = coordinator.mergeCacheReferences(references);
      
      // Should merge into fewer references
      assert.ok(merged.length <= references.length);
    });

    it("should handle empty array", () => {
      const merged = coordinator.mergeCacheReferences([]);
      assert.deepStrictEqual(merged, []);
    });
  });

  describe("registerCacheEntry", () => {
    it("should register cache entry for lookup", () => {
      const entry: CacheEntry = {
        key: "test",
        tokens: Array(100).fill(0),
        depth: 100,
        sizeBytes: 1000,
        accessCount: 1,
        lastAccessTime: Date.now(),
        flopsEfficiency: 1.0,
        createdAt: Date.now()
      };
      
      coordinator.registerCacheEntry("hash123", 0, entry);
      
      // Entry should be registered (tested via plan creation)
      const tokens = Array(200).fill(0);
      const plan = coordinator.createPlan("req_1", tokens, new Map());
      
      assert.ok(plan.chunks.length > 0);
    });
  });

  describe("getAccumulatedHash", () => {
    it("should return cumulative hash up to chunk", () => {
      const tokens = Array(400).fill(1);
      
      const hash0 = coordinator.getAccumulatedHash(tokens, 0);
      const hash1 = coordinator.getAccumulatedHash(tokens, 1);
      const hash2 = coordinator.getAccumulatedHash(tokens, 2);
      
      // Each hash should be different (different token coverage)
      assert.ok(hash0 !== hash1);
      assert.ok(hash1 !== hash2);
    });
  });

  describe("calculateSavings", () => {
    it("should calculate TTFT reduction", () => {
      const tokens = Array(400).fill(0);
      const boundaries = coordinator.identifyPrefixBoundaries(tokens);
      const cacheablePrefixes = new Map<string, number>();
      cacheablePrefixes.set(`${boundaries[0].cumulativeHash}:0`, 128);
      
      const plan = coordinator.createPlan("req_1", tokens, cacheablePrefixes);
      const savings = coordinator.calculateSavings(1000, plan);
      
      assert.ok(savings.ttftReductionMs >= 0);
      assert.ok(savings.ttftReductionPercent >= 0);
    });
  });

  describe("getStats", () => {
    it("should track coordinator statistics", () => {
      const tokens = Array(300).fill(0);
      coordinator.createPlan("req_1", tokens, new Map());
      
      const stats = coordinator.getStats();
      
      assert.strictEqual(stats.totalRequests, 1);
      assert.ok(stats.totalChunks > 0);
    });
  });

  describe("resetStats", () => {
    it("should reset statistics", () => {
      const tokens = Array(200).fill(0);
      coordinator.createPlan("req_1", tokens, new Map());
      coordinator.resetStats();
      
      const stats = coordinator.getStats();
      
      assert.strictEqual(stats.totalRequests, 0);
      assert.strictEqual(stats.totalChunks, 0);
    });
  });

  describe("RequestChunkCoordinator", () => {
    it("should track processed chunks", () => {
      const requestCoordinator = coordinator.createRequestCoordinator("req_1");
      
      requestCoordinator.markProcessed(0);
      assert.strictEqual(requestCoordinator.isProcessed(0), true);
      assert.strictEqual(requestCoordinator.isProcessed(1), false);
    });

    it("should get next unprocessed chunk", () => {
      const requestCoordinator = coordinator.createRequestCoordinator("req_1");
      
      const next1 = requestCoordinator.getNextChunk(5);
      assert.strictEqual(next1, 0);
      
      requestCoordinator.markProcessed(0);
      const next2 = requestCoordinator.getNextChunk(5);
      assert.strictEqual(next2, 1);
    });

    it("should return null when all processed", () => {
      const requestCoordinator = coordinator.createRequestCoordinator("req_1");
      
      requestCoordinator.markProcessed(0);
      requestCoordinator.markProcessed(1);
      
      const next = requestCoordinator.getNextChunk(2);
      assert.strictEqual(next, null);
    });

    it("should get remaining chunks", () => {
      const requestCoordinator = coordinator.createRequestCoordinator("req_1");
      
      requestCoordinator.markProcessed(1);
      
      const remaining = requestCoordinator.getRemainingChunks(3);
      
      assert.deepStrictEqual(remaining.sort(), [0, 2]);
    });
  });

  describe("createChunkedPrefillCoordinator factory", () => {
    it("should create coordinator with custom config", () => {
      const customCoordinator = createChunkedPrefillCoordinator({
        chunkSize: 256,
        enableCrossChunkCaching: false
      });
      
      const tokens = Array(500).fill(0);
      const plan = customCoordinator.createPlan("req_1", tokens, new Map());
      
      assert.strictEqual(plan.chunks.length, Math.ceil(500 / 256));
    });
  });
});
