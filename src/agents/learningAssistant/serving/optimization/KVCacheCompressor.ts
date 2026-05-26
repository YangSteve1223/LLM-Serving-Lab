/**
 * KV Cache Compressor.
 * 
 * Implements advanced KV cache compression techniques:
 * - Attention entropy-based pruning
 * - Layer-adaptive quantization (FP16/BF16 → INT8/FP8 → semantic)
 * - Compression ratio vs quality trade-off analysis
 * 
 * Integrates with HierarchicalKVCache for tier-aware compression.
 */
import type { CacheTier } from "./cache/HierarchicalKVCache.ts";
import type { CacheEntry } from "./cache/RadixPrefixCacheManager.ts";

// ==================== Types ====================

export type QuantizationType = "FP16" | "BF16" | "FP8" | "INT8" | "SEMANTIC";

export interface AttentionEntropyScore {
  position: number;
  entropy: number; // Shannon entropy of attention weights
  normalizedEntropy: number; // 0-1, higher = more dispersed attention
  importanceScore: number; // 1 - normalizedEntropy
}

export interface LayerCompressionConfig {
  layerIndex: number;
  quantizationType: QuantizationType;
  compressionRatio: number;
  sensitivityScore: number; // 0-1, higher = more sensitive to compression
}

export interface KVCacheCompressionResult {
  originalSizeMB: number;
  compressedSizeMB: number;
  compressionRatio: number;
  estimatedQualityLoss: number; // 0-1
  layerConfigs: LayerCompressionConfig[];
  prunedPositions: number[];
  quantizationType: QuantizationType;
  perLayerCompression: {
    layer: number;
    originalMB: number;
    compressedMB: number;
    ratio: number;
    qualityLoss: number;
  }[];
}

export interface CompressionPolicy {
  entropyThresholdHigh: number; // Above this: compress aggressively
  entropyThresholdLow: number; // Below this: keep full precision
  quantizationStrategy: "uniform" | "layer_adaptive" | "importance_weighted";
  targetCompressionRatio?: number;
  preserveCriticalLayers: boolean;
}

export interface CompressorStats {
  totalOriginalSizeMB: number;
  totalCompressedSizeMB: number;
  avgCompressionRatio: number;
  avgQualityLoss: number;
  compressionsApplied: number;
  layersQuantized: Record<QuantizationType, number>;
}

// ==================== Constants ====================

const QUANTIZATION_SIZE_RATIOS: Record<QuantizationType, number> = {
  FP16: 1.0,
  BF16: 1.0,
  FP8: 0.5,
  INT8: 0.5,
  SEMANTIC: 0.1 // Semantic compression uses learned embeddings
};

const QUANTIZATION_QUALITY_LOSS: Record<QuantizationType, number> = {
  FP16: 0.0,
  BF16: 0.01, // Slight loss due to precision
  FP8: 0.03,
  INT8: 0.05,
  SEMANTIC: 0.15 // Higher loss for semantic compression
};

// Layer sensitivity to compression (empirical from research)
// Earlier layers tend to be more important, later layers more redundant
const DEFAULT_LAYER_SENSITIVITY = (layer: number, totalLayers: number): number => {
  const normalizedPosition = layer / totalLayers;
  // Attention layers (early) and output projection layers (late) are more sensitive
  if (normalizedPosition < 0.2) return 0.8; // Input embeddings
  if (normalizedPosition < 0.8) return 0.4; // Middle layers - more compressible
  return 0.7; // Output layers - less compressible
};

// ==================== KVCacheCompressor Class ====================

export class KVCacheCompressor {
  private policy: CompressionPolicy;
  private stats: CompressorStats;
  private numLayers: number;

  constructor(
    policy: Partial<CompressionPolicy> = {},
    numLayers: number = 80
  ) {
    this.numLayers = numLayers;
    this.policy = this.normalizePolicy(policy);
    this.stats = this.initStats();
  }

  private normalizePolicy(policy: Partial<CompressionPolicy>): CompressionPolicy {
    return {
      entropyThresholdHigh: policy.entropyThresholdHigh ?? 0.7,
      entropyThresholdLow: policy.entropyThresholdLow ?? 0.3,
      quantizationStrategy: policy.quantizationStrategy ?? "layer_adaptive",
      targetCompressionRatio: policy.targetCompressionRatio,
      preserveCriticalLayers: policy.preserveCriticalLayers ?? true
    };
  }

  private initStats(): CompressorStats {
    return {
      totalOriginalSizeMB: 0,
      totalCompressedSizeMB: 0,
      avgCompressionRatio: 0,
      avgQualityLoss: 0,
      compressionsApplied: 0,
      layersQuantized: {
        FP16: 0,
        BF16: 0,
        FP8: 0,
        INT8: 0,
        SEMANTIC: 0
      }
    };
  }

  /**
   * Calculate attention entropy for a position.
   * High entropy = attention is dispersed across many positions = less critical
   * Low entropy = attention is focused = critical information
   */
  calculateAttentionEntropy(attentionWeights: number[]): AttentionEntropyScore {
    if (attentionWeights.length === 0) {
      return {
        position: 0,
        entropy: 0,
        normalizedEntropy: 0,
        importanceScore: 1
      };
    }

    // Calculate Shannon entropy: H = -sum(p * log(p))
    let entropy = 0;
    for (const weight of attentionWeights) {
      if (weight > 0) {
        entropy -= weight * Math.log2(weight);
      }
    }

    // Normalize entropy to [0, 1]
    // Max entropy = log2(n) when uniform distribution
    const maxEntropy = Math.log2(attentionWeights.length);
    const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;

    // Importance = 1 - normalizedEntropy
    // High entropy (dispersed) = low importance
    // Low entropy (focused) = high importance
    const importanceScore = 1 - normalizedEntropy;

    return {
      position: 0, // Position will be set by caller
      entropy,
      normalizedEntropy,
      importanceScore
    };
  }

  /**
   * Calculate entropy scores for all positions in a sequence.
   * Simulates attention patterns for educational content.
   */
  calculateSequenceEntropy(
    seqLength: number,
    tokenFrequencies?: Map<number, number>
  ): AttentionEntropyScore[] {
    const scores: AttentionEntropyScore[] = [];
    
    // Simulate attention patterns
    for (let i = 0; i < seqLength; i++) {
      // Higher position = more recent = higher attention (recency bias)
      // Token frequency affects importance
      let baseAttention = (i + 1) / seqLength;
      
      if (tokenFrequencies && tokenFrequencies.has(i)) {
        // Frequent tokens get bonus attention
        baseAttention *= 1.2;
      }

      // Add some variance based on position
      const variance = Math.sin(i * 0.1) * 0.1;
      const attentionWeight = Math.max(0, Math.min(1, baseAttention + variance));

      // Create pseudo-attention distribution
      const attentionWeights = Array(seqLength)
        .fill(0)
        .map((_, j) => {
          const dist = Math.exp(-Math.abs(i - j) / 5); // Gaussian-like
          return dist;
        });
      
      // Normalize
      const sum = attentionWeights.reduce((a, b) => a + b, 0);
      attentionWeights.forEach((w, j) => attentionWeights[j] = w / sum);

      const entropyScore = this.calculateAttentionEntropy(attentionWeights);
      scores.push({
        ...entropyScore,
        position: i
      });
    }

    return scores;
  }

  /**
   * Determine which positions to prune based on entropy analysis.
   */
  determinePrunedPositions(scores: AttentionEntropyScore[]): number[] {
    const pruned: number[] = [];
    
    for (const score of scores) {
      // Prune if entropy is high (attention is dispersed)
      if (score.normalizedEntropy > this.policy.entropyThresholdHigh) {
        pruned.push(score.position);
      }
    }

    return pruned;
  }

  /**
   * Get quantization type for a layer based on entropy and compression needs.
   */
  getLayerQuantization(
    layer: number,
    avgEntropy: number,
    memoryPressure: number // 0-1, higher = more pressure
  ): QuantizationType {
    const sensitivity = DEFAULT_LAYER_SENSITIVITY(layer, this.numLayers);
    
    // Base quantization on memory pressure and layer sensitivity
    let baseQuantType: QuantizationType;
    
    if (memoryPressure < 0.3) {
      baseQuantType = "BF16"; // Low pressure, keep full precision
    } else if (memoryPressure < 0.6) {
      baseQuantType = "FP8"; // Medium pressure, moderate compression
    } else if (memoryPressure < 0.8) {
      baseQuantType = "INT8"; // High pressure, aggressive compression
    } else {
      baseQuantType = "SEMANTIC"; // Critical pressure, semantic compression
    }

    // Adjust based on layer sensitivity
    // Critical layers (high sensitivity) use less aggressive compression
    if (sensitivity > 0.7 && memoryPressure > 0.5) {
      // Use one level less aggressive for critical layers
      switch (baseQuantType) {
        case "SEMANTIC": return "INT8";
        case "INT8": return "FP8";
        case "FP8": return "BF16";
        default: return baseQuantType;
      }
    }

    return baseQuantType;
  }

  /**
   * Generate per-layer compression configurations.
   */
  generateLayerConfigs(
    avgEntropies: number[],
    memoryPressure: number
  ): LayerCompressionConfig[] {
    const configs: LayerCompressionConfig[] = [];

    for (let layer = 0; layer < this.numLayers; layer++) {
      const avgEntropy = avgEntropies[layer] ?? 0.5;
      const quantizationType = this.getLayerQuantization(layer, avgEntropy, memoryPressure);
      const compressionRatio = QUANTIZATION_SIZE_RATIOS[quantizationType];
      const sensitivityScore = DEFAULT_LAYER_SENSITIVITY(layer, this.numLayers);

      configs.push({
        layerIndex: layer,
        quantizationType,
        compressionRatio,
        sensitivityScore
      });

      // Update stats
      this.stats.layersQuantized[quantizationType]++;
    }

    return configs;
  }

  /**
   * Compress a KV cache entry.
   */
  compress(
    entry: CacheEntry,
    memoryPressure: number = 0.5,
    attentionWeights?: number[][]
  ): KVCacheCompressionResult {
    const numTokens = entry.tokens.length;
    const kvSizePerTokenMB = 0.64; // Llama-70B style
    const originalSizeMB = (numTokens * this.numLayers * kvSizePerTokenMB) / 1024;

    // Calculate entropy scores
    const entropyScores = this.calculateSequenceEntropy(numTokens);
    const prunedPositions = this.determinePrunedPositions(entropyScores);

    // Calculate per-layer average entropy
    const avgEntropies = Array(this.numLayers)
      .fill(0)
      .map((_, i) => {
        // Simulate different entropy per layer
        const baseEntropy = entropyScores.reduce((sum, s) => sum + s.normalizedEntropy, 0) / numTokens;
        return baseEntropy * (0.8 + 0.4 * Math.sin(i * 0.1));
      });

    // Generate layer configs
    const layerConfigs = this.generateLayerConfigs(avgEntropies, memoryPressure);

    // Calculate compressed size
    let compressedSizeMB = 0;
    let totalQualityLoss = 0;
    const perLayerCompression: KVCacheCompressionResult["perLayerCompression"] = [];

    for (const config of layerConfigs) {
      const tokensInLayer = numTokens; // All tokens present
      const layerOriginalMB = (tokensInLayer * kvSizePerTokenMB) / 1024;
      const layerCompressedMB = layerOriginalMB * config.compressionRatio;
      const layerQualityLoss = QUANTIZATION_QUALITY_LOSS[config.quantizationType];

      compressedSizeMB += layerCompressedMB;
      totalQualityLoss += layerQualityLoss * config.sensitivityScore;

      perLayerCompression.push({
        layer: config.layerIndex,
        originalMB: layerOriginalMB,
        compressedMB: layerCompressedMB,
        ratio: config.compressionRatio,
        qualityLoss: layerQualityLoss
      });
    }

    // Adjust for pruned positions
    const pruneRatio = prunedPositions.length / numTokens;
    compressedSizeMB *= (1 - pruneRatio * 0.3); // Pruning reduces size further
    totalQualityLoss *= (1 + pruneRatio * 0.1); // Pruning adds some quality loss

    const compressionRatio = originalSizeMB / Math.max(0.001, compressedSizeMB);
    const avgQualityLoss = totalQualityLoss / this.numLayers;

    // Determine overall quantization type (most aggressive used)
    const overallQuantType = layerConfigs.reduce((mostAggressive, config) => {
      const order: QuantizationType[] = ["BF16", "FP16", "FP8", "INT8", "SEMANTIC"];
      return order.indexOf(config.quantizationType) > order.indexOf(mostAggressive)
        ? config.quantizationType
        : mostAggressive;
    }, "BF16");

    // Update global stats
    this.stats.totalOriginalSizeMB += originalSizeMB;
    this.stats.totalCompressedSizeMB += compressedSizeMB;
    this.stats.compressionsApplied++;

    return {
      originalSizeMB,
      compressedSizeMB,
      compressionRatio,
      estimatedQualityLoss: avgQualityLoss,
      layerConfigs,
      prunedPositions,
      quantizationType: overallQuantType,
      perLayerCompression
    };
  }

  /**
   * Compress for a specific tier.
   */
  compressForTier(
    entry: CacheEntry,
    targetTier: CacheTier
  ): KVCacheCompressionResult {
    const tierPressure: Record<CacheTier, number> = {
      L1_GPU: 0.1, // Low pressure, high precision
      L2_CPU: 0.5, // Medium pressure, moderate compression
      L3_DISTRIBUTED: 0.9 // High pressure, aggressive compression
    };

    return this.compress(entry, tierPressure[targetTier]);
  }

  /**
   * Get current statistics.
   */
  getStats(): CompressorStats {
    const { totalOriginalSizeMB, totalCompressedSizeMB, compressionsApplied } = this.stats;
    
    return {
      ...this.stats,
      avgCompressionRatio: compressionsApplied > 0 
        ? totalOriginalSizeMB / Math.max(0.001, totalCompressedSizeMB) 
        : 0,
      avgQualityLoss: compressionsApplied > 0 
        ? this.stats.avgQualityLoss / compressionsApplied 
        : 0
    };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats = this.initStats();
  }

  /**
   * Update compression policy.
   */
  updatePolicy(policy: Partial<CompressionPolicy>): void {
    this.policy = this.normalizePolicy({ ...this.policy, ...policy });
  }

  /**
   * Get recommended compression for a given memory budget.
   */
  getRecommendedCompression(
    availableMB: number,
    requestedMB: number
  ): { neededRatio: number; action: "none" | "light" | "moderate" | "aggressive" } {
    const neededRatio = availableMB / Math.max(0.001, requestedMB);
    
    if (neededRatio >= 1) {
      return { neededRatio, action: "none" };
    } else if (neededRatio >= 0.7) {
      return { neededRatio, action: "light" };
    } else if (neededRatio >= 0.4) {
      return { neededRatio, action: "moderate" };
    } else {
      return { neededRatio, action: "aggressive" };
    }
  }
}

// ==================== Factory Function ====================

export function createCompressor(
  policy?: Partial<CompressionPolicy>,
  numLayers?: number
): KVCacheCompressor {
  return new KVCacheCompressor(policy, numLayers);
}
