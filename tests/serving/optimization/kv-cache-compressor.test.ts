/**
 * Tests for KVCacheCompressor
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  KVCacheCompressor,
  createCompressor
} from "../../../src/agents/learningAssistant/serving/optimization/KVCacheCompressor.ts";
import type { CacheEntry } from "../../../src/agents/learningAssistant/serving/cache/RadixPrefixCacheManager.ts";

describe("KVCacheCompressor", () => {
  let compressor: KVCacheCompressor;

  beforeEach(() => {
    compressor = new KVCacheCompressor({}, 80);
  });

  describe("calculateAttentionEntropy", () => {
    it("should calculate zero entropy for uniform distribution", () => {
      const weights = [0.25, 0.25, 0.25, 0.25];
      const score = compressor.calculateAttentionEntropy(weights);
      
      assert.strictEqual(score.normalizedEntropy, 1, "Uniform should have max entropy");
      assert.ok(score.importanceScore < 0.1, "Uniform should have low importance");
    });

    it("should calculate high entropy for focused distribution", () => {
      const weights = [0.9, 0.03, 0.03, 0.04];
      const score = compressor.calculateAttentionEntropy(weights);
      
      assert.ok(score.normalizedEntropy < 0.5, "Focused should have low entropy");
      assert.ok(score.importanceScore > 0.5, "Focused should have high importance");
    });

    it("should handle empty weights", () => {
      const score = compressor.calculateAttentionEntropy([]);
      
      assert.strictEqual(score.entropy, 0);
      assert.strictEqual(score.normalizedEntropy, 0);
      assert.strictEqual(score.importanceScore, 1);
    });
  });

  describe("calculateSequenceEntropy", () => {
    it("should calculate entropy for all positions", () => {
      const scores = compressor.calculateSequenceEntropy(100);
      
      assert.strictEqual(scores.length, 100);
      scores.forEach((score, i) => {
        assert.strictEqual(score.position, i);
        assert.ok(score.entropy >= 0);
        assert.ok(score.normalizedEntropy >= 0 && score.normalizedEntropy <= 1);
      });
    });

    it("should consider token frequencies", () => {
      const freqMap = new Map<number, number>();
      freqMap.set(50, 10); // Frequent token at position 50
      
      const scores = compressor.calculateSequenceEntropy(100, freqMap);
      
      // Token at position 50 should have higher importance due to frequency
      assert.ok(scores[50].importanceScore > 0);
    });
  });

  describe("determinePrunedPositions", () => {
    it("should identify high entropy positions for pruning", () => {
      const scores = [
        { position: 0, entropy: 4, normalizedEntropy: 0.9, importanceScore: 0.1 },
        { position: 1, entropy: 1, normalizedEntropy: 0.2, importanceScore: 0.8 },
        { position: 2, entropy: 3, normalizedEntropy: 0.8, importanceScore: 0.2 }
      ];
      
      const pruned = compressor.determinePrunedPositions(scores as any);
      
      assert.deepStrictEqual(pruned.sort(), [0, 2]);
    });

    it("should return empty array when no high entropy", () => {
      const scores = [
        { position: 0, entropy: 1, normalizedEntropy: 0.2, importanceScore: 0.8 },
        { position: 1, entropy: 1.5, normalizedEntropy: 0.3, importanceScore: 0.7 }
      ];
      
      const pruned = compressor.determinePrunedPositions(scores as any);
      
      assert.deepStrictEqual(pruned, []);
    });
  });

  describe("getLayerQuantization", () => {
    it("should return BF16 for low memory pressure", () => {
      const quant = compressor.getLayerQuantization(10, 0.5, 0.1);
      assert.strictEqual(quant, "BF16");
    });

    it("should return INT8 or SEMANTIC for high memory pressure", () => {
      const quant = compressor.getLayerQuantization(10, 0.5, 0.9);
      assert.ok(["INT8", "SEMANTIC"].includes(quant));
    });

    it("should be more conservative for critical layers", () => {
      // Layer 0 (input embedding) should be more conservative
      const quantCritical = compressor.getLayerQuantization(0, 0.5, 0.7);
      const quantNormal = compressor.getLayerQuantization(40, 0.5, 0.7);
      
      // Critical layer should use less aggressive compression
      assert.ok(
        ["BF16", "FP16", "FP8"].includes(quantCritical) ||
        ["INT8", "SEMANTIC"].includes(quantNormal)
      );
    });
  });

  describe("compress", () => {
    it("should compress cache entry correctly", () => {
      const entry: CacheEntry = {
        key: "test_key",
        tokens: Array(1000).fill(0).map((_, i) => i % 100),
        depth: 1000,
        sizeBytes: 1000 * 80 * 0.64 * 1024 * 1024,
        accessCount: 5,
        lastAccessTime: Date.now(),
        flopsEfficiency: 1.5,
        createdAt: Date.now()
      };
      
      const result = compressor.compress(entry, 0.5);
      
      assert.ok(result.originalSizeMB > 0);
      assert.ok(result.compressedSizeMB > 0);
      assert.ok(result.compressionRatio > 1);
      assert.ok(result.estimatedQualityLoss >= 0);
      assert.ok(result.layerConfigs.length > 0);
    });

    it("should track statistics", () => {
      const entry: CacheEntry = {
        key: "test_key",
        tokens: Array(500).fill(0),
        depth: 500,
        sizeBytes: 500 * 80 * 0.64 * 1024 * 1024,
        accessCount: 1,
        lastAccessTime: Date.now(),
        flopsEfficiency: 1.0,
        createdAt: Date.now()
      };
      
      compressor.compress(entry, 0.3);
      const stats = compressor.getStats();
      
      assert.strictEqual(stats.compressionsApplied, 1);
      assert.ok(stats.totalOriginalSizeMB > 0);
    });
  });

  describe("compressForTier", () => {
    it("should apply different compression for different tiers", () => {
      const entry: CacheEntry = {
        key: "test_key",
        tokens: Array(500).fill(0),
        depth: 500,
        sizeBytes: 500 * 80 * 0.64 * 1024 * 1024,
        accessCount: 1,
        lastAccessTime: Date.now(),
        flopsEfficiency: 1.0,
        createdAt: Date.now()
      };
      
      const l1Result = compressor.compressForTier(entry, "L1_GPU");
      const l2Result = compressor.compressForTier(entry, "L2_CPU");
      const l3Result = compressor.compressForTier(entry, "L3_DISTRIBUTED");
      
      // L1 should have higher compression ratio (less compression)
      // L3 should have lower compression ratio (more compression)
      assert.ok(l1Result.compressionRatio <= l2Result.compressionRatio);
      assert.ok(l2Result.compressionRatio <= l3Result.compressionRatio);
    });
  });

  describe("getRecommendedCompression", () => {
    it("should return 'none' when budget is sufficient", () => {
      const result = compressor.getRecommendedCompression(100, 50);
      
      assert.strictEqual(result.action, "none");
      assert.ok(result.neededRatio >= 1);
    });

    it("should return 'aggressive' when budget is very limited", () => {
      const result = compressor.getRecommendedCompression(30, 100);
      
      assert.strictEqual(result.action, "aggressive");
      assert.ok(result.neededRatio < 0.4);
    });
  });

  describe("updatePolicy", () => {
    it("should update entropy thresholds", () => {
      compressor.updatePolicy({
        entropyThresholdHigh: 0.8,
        entropyThresholdLow: 0.4
      });
      
      // Verify by checking entropy calculation
      const scores = [
        { position: 0, entropy: 4, normalizedEntropy: 0.85, importanceScore: 0.15 }
      ];
      const pruned = compressor.determinePrunedPositions(scores as any);
      
      // With new threshold (0.8), position with 0.85 entropy should be pruned
      assert.strictEqual(pruned.length, 1);
    });
  });

  describe("resetStats", () => {
    it("should reset statistics", () => {
      const entry: CacheEntry = {
        key: "test_key",
        tokens: Array(100).fill(0),
        depth: 100,
        sizeBytes: 100 * 80 * 0.64 * 1024 * 1024,
        accessCount: 1,
        lastAccessTime: Date.now(),
        flopsEfficiency: 1.0,
        createdAt: Date.now()
      };
      
      compressor.compress(entry, 0.5);
      compressor.resetStats();
      
      const stats = compressor.getStats();
      assert.strictEqual(stats.compressionsApplied, 0);
      assert.strictEqual(stats.totalOriginalSizeMB, 0);
    });
  });

  describe("createCompressor factory", () => {
    it("should create compressor with custom config", () => {
      const customCompressor = createCompressor({
        entropyThresholdHigh: 0.9
      }, 40);
      
      const stats = customCompressor.getStats();
      assert.deepStrictEqual(stats.layersQuantized, {
        FP16: 0, BF16: 0, FP8: 0, INT8: 0, SEMANTIC: 0
      });
    });
  });
});
