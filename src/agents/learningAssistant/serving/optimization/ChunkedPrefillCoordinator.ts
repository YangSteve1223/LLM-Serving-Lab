/**
 * Chunked Prefill Coordinator.
 * 
 * Coordinates chunked prefill with prefix caching:
 * - Identifies common prefix boundaries across chunks
 * - Tracks cross-chunk KV cache references
 * - Manages cache hit/miss for chunked prefill
 * 
 * Integrates with RadixPrefixCacheManager and EnhancedPDServingSimulator.
 */
import { createHash } from "node:crypto";
import type { CacheEntry } from "./cache/RadixPrefixCacheManager.ts";
import type { PrefillChunk, EnhancedPDWorkloadRequest } from "./ServingTrace.ts";

// ==================== Types ====================

export interface ChunkBoundary {
  chunkIndex: number;
  startToken: number;
  endToken: number;
  isPrefixBoundary: boolean;
  cumulativeHash: string;
  cacheable: boolean;
}

export interface ChunkCacheReference {
  chunkIndex: number;
  referencingChunks: number[];
  cachedTokenStart: number;
  cachedTokenEnd: number;
  cacheHitProbability: number;
}

export interface ChunkedPrefillPlan {
  requestId: string;
  totalTokens: number;
  chunks: PrefillChunk[];
  boundaries: ChunkBoundary[];
  cacheReferences: ChunkCacheReference[];
  totalCacheHitTokens: number;
  estimatedTTFTReduction: number;
}

export interface ChunkedPrefillConfig {
  chunkSize: number;
  enableCrossChunkCaching: boolean;
  prefixBoundaryDetection: "exact" | "semantic" | "heuristic";
  minPrefixLength: number;
  cacheLookupAhead: number; // Chunks to pre-cache lookup
}

export interface ChunkCoordinatorStats {
  totalRequests: number;
  totalChunks: number;
  cacheHits: number;
  cacheMisses: number;
  prefixHits: number;
  crossChunkSaves: number;
  avgTTFTReduction: number;
}

// ==================== Constants ====================

const DEFAULT_CHUNK_CONFIG: ChunkedPrefillConfig = {
  chunkSize: 512,
  enableCrossChunkCaching: true,
  prefixBoundaryDetection: "heuristic",
  minPrefixLength: 128,
  cacheLookupAhead: 2
};

// ==================== Helper Functions ====================

function round(value: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function computeCumulativeHash(tokens: number[]): string {
  const hash = createHash("sha256");
  for (const token of tokens) {
    hash.update(token.toString());
  }
  return hash.digest("hex").substring(0, 16);
}

function detectPrefixBoundary(
  tokens: number[],
  startIdx: number,
  chunkSize: number,
  method: ChunkedPrefillConfig["prefixBoundaryDetection"]
): boolean {
  const endIdx = Math.min(startIdx + chunkSize, tokens.length);
  
  if (method === "exact") {
    // Look for exact token boundaries
    // Common boundaries: paragraph markers, section markers
    const boundaryTokens = new Set([198, 200, 202, 227]); // Common special tokens
    for (let i = startIdx; i < endIdx; i++) {
      if (boundaryTokens.has(tokens[i])) {
        return true;
      }
    }
  } else if (method === "semantic") {
    // Look for semantic boundaries
    // Patterns: newlines followed by capital letters, numbered lists
    // Simplified heuristic: count line/paragraph boundaries
    let boundaries = 0;
    for (let i = startIdx; i < endIdx; i++) {
      if (tokens[i] === 198 || tokens[i] === 200) boundaries++;
    }
    return boundaries > 2;
  } else {
    // Heuristic: every chunkSize tokens is a boundary
    return startIdx > 0 && startIdx % chunkSize === 0;
  }
  
  return false;
}

// ==================== ChunkedPrefillCoordinator Class ====================

export class ChunkedPrefillCoordinator {
  private config: ChunkedPrefillConfig;
  private stats: ChunkCoordinatorStats;
  private cacheState: Map<string, CacheEntry>;

  constructor(
    config: Partial<ChunkedPrefillConfig> = {},
    initialCache?: Map<string, CacheEntry>
  ) {
    this.config = this.normalizeConfig(config);
    this.stats = this.initStats();
    this.cacheState = initialCache ?? new Map();
  }

  private normalizeConfig(config: Partial<ChunkedPrefillConfig>): ChunkedPrefillConfig {
    return {
      chunkSize: config.chunkSize ?? DEFAULT_CHUNK_CONFIG.chunkSize,
      enableCrossChunkCaching: config.enableCrossChunkCaching ?? DEFAULT_CHUNK_CONFIG.enableCrossChunkCaching,
      prefixBoundaryDetection: config.prefixBoundaryDetection ?? DEFAULT_CHUNK_CONFIG.prefixBoundaryDetection,
      minPrefixLength: config.minPrefixLength ?? DEFAULT_CHUNK_CONFIG.minPrefixLength,
      cacheLookupAhead: config.cacheLookupAhead ?? DEFAULT_CHUNK_CONFIG.cacheLookupAhead
    };
  }

  private initStats(): ChunkCoordinatorStats {
    return {
      totalRequests: 0,
      totalChunks: 0,
      cacheHits: 0,
      cacheMisses: 0,
      prefixHits: 0,
      crossChunkSaves: 0,
      avgTTFTReduction: 0
    };
  }

  /**
   * Identify prefix boundaries in a token sequence.
   */
  identifyPrefixBoundaries(tokens: number[]): ChunkBoundary[] {
    const boundaries: ChunkBoundary[] = [];
    const numChunks = Math.ceil(tokens.length / this.config.chunkSize);
    
    let cumulativeTokens: number[] = [];
    let cumulativeHash = "";
    
    for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
      const startToken = chunkIdx * this.config.chunkSize;
      const endToken = Math.min(startToken + this.config.chunkSize, tokens.length);
      
      // Update cumulative tokens and hash
      const chunkTokens = tokens.slice(startToken, endToken);
      cumulativeTokens = [...cumulativeTokens, ...chunkTokens];
      cumulativeHash = computeCumulativeHash(cumulativeTokens);
      
      // Detect if this is a prefix boundary
      const isPrefixBoundary = detectPrefixBoundary(
        tokens,
        startToken,
        this.config.chunkSize,
        this.config.prefixBoundaryDetection
      );
      
      // Check if this chunk is cacheable
      const cacheable = 
        startToken === 0 || // First chunk is always cacheable
        (isPrefixBoundary && endToken - startToken >= this.config.minPrefixLength);
      
      boundaries.push({
        chunkIndex: chunkIdx,
        startToken,
        endToken,
        isPrefixBoundary,
        cumulativeHash,
        cacheable
      });
    }
    
    return boundaries;
  }

  /**
   * Build cache references between chunks.
   */
  buildCacheReferences(
    boundaries: ChunkBoundary[],
    cacheablePrefixes: Map<string, number>
  ): ChunkCacheReference[] {
    const references: ChunkCacheReference[] = [];
    
    for (let i = 0; i < boundaries.length; i++) {
      const boundary = boundaries[i];
      const referencingChunks: number[] = [];
      let cachedTokenStart = boundary.startToken;
      let cachedTokenEnd = boundary.endToken;
      let hitProbability = 0;
      
      // Look ahead for chunks that could reference this prefix
      const lookAhead = Math.min(
        i + this.config.cacheLookupAhead + 1,
        boundaries.length
      );
      
      for (let j = i + 1; j < lookAhead; j++) {
        const futureBoundary = boundaries[j];
        
        // Check if future chunk starts at or near this boundary
        if (this.config.enableCrossChunkCaching) {
          // If it's a prefix boundary, subsequent chunks can cache from here
          if (futureBoundary.isPrefixBoundary) {
            referencingChunks.push(j);
          }
          
          // Check if prefix matches cached data
          const cacheKey = this.buildCacheKey(
            boundary.cumulativeHash,
            futureBoundary.startToken
          );
          
          if (cacheablePrefixes.has(cacheKey)) {
            const cachedLength = cacheablePrefixes.get(cacheKey)!;
            if (cachedLength > 0) {
              cachedTokenEnd = boundary.startToken + cachedLength;
              hitProbability += cachedLength / (futureBoundary.endToken - futureBoundary.startToken);
            }
          }
        }
      }
      
      references.push({
        chunkIndex: i,
        referencingChunks,
        cachedTokenStart,
        cachedTokenEnd,
        cacheHitProbability: Math.min(1, hitProbability)
      });
      
      // Update stats
      if (referencingChunks.length > 0) {
        this.stats.crossChunkSaves += referencingChunks.length;
      }
    }
    
    return references;
  }

  /**
   * Build cache key for lookup.
   */
  private buildCacheKey(prefixHash: string, tokenOffset: number): string {
    return `${prefixHash}:${tokenOffset}`;
  }

  /**
   * Create a complete chunked prefill plan.
   */
  createPlan(
    requestId: string,
    tokens: number[],
    cacheablePrefixes: Map<string, number>,
    simulatorConfig?: {
      prefillMsPerToken?: number;
      prefillBaseMs?: number;
    }
  ): ChunkedPrefillPlan {
    this.stats.totalRequests++;
    
    const boundaries = this.identifyPrefixBoundaries(tokens);
    const cacheReferences = this.buildCacheReferences(boundaries, cacheablePrefixes);
    
    // Create chunks with cache-aware timing
    const chunks: PrefillChunk[] = [];
    const prefillMsPerToken = simulatorConfig?.prefillMsPerToken ?? 0.18;
    const prefillBaseMs = simulatorConfig?.prefillBaseMs ?? 25;
    
    let totalCacheHitTokens = 0;
    
    for (let i = 0; i < boundaries.length; i++) {
      const boundary = boundaries[i];
      const ref = cacheReferences[i];
      
      // Calculate cache hit for this chunk
      const chunkTokens = boundary.endToken - boundary.startToken;
      let cachedTokens = 0;
      let computeMs = prefillBaseMs;
      let transferMs = 0;
      
      if (boundary.cacheable && boundary.startToken === 0) {
        // First chunk: check for exact cache hit
        const cacheKey = this.buildCacheKey(boundary.cumulativeHash, 0);
        if (cacheablePrefixes.has(cacheKey)) {
          cachedTokens = cacheablePrefixes.get(cacheKey)!;
          this.stats.cacheHits++;
          this.stats.prefixHits++;
        } else {
          this.stats.cacheMisses++;
        }
      } else if (ref.cacheHitProbability > 0) {
        // Cross-chunk cache hit
        cachedTokens = Math.floor(chunkTokens * ref.cacheHitProbability);
        totalCacheHitTokens += cachedTokens;
        this.stats.cacheHits++;
      }
      
      // Calculate compute time (reduced for cache hits)
      if (cachedTokens > 0) {
        // Cache hit: skip compute for cached portion
        const nonCachedTokens = chunkTokens - cachedTokens;
        computeMs = prefillBaseMs + nonCachedTokens * prefillMsPerToken * 0.35; // Reduced FLOPs
        transferMs = 0; // No transfer for cache hit
      } else {
        computeMs = prefillBaseMs + chunkTokens * prefillMsPerToken;
        transferMs = (chunkTokens * 0.64 / 400) * 1000; // KV transfer
        this.stats.cacheMisses++;
      }
      
      chunks.push({
        chunkIndex: i,
        startToken: boundary.startToken,
        endToken: boundary.endToken,
        computeMs: round(computeMs),
        transferMs: round(transferMs),
        completedLayers: cachedTokens > 0 ? 80 : 80 // All layers completed
      });
      
      this.stats.totalChunks++;
    }
    
    // Calculate TTFT reduction
    const totalTTFT = chunks.reduce((sum, c) => sum + c.computeMs + c.transferMs, 0);
    const cachedTTFT = chunks.reduce((sum, c) => {
      if (c.transferMs === 0) return sum + c.computeMs;
      return sum;
    }, 0);
    const estimatedTTFTReduction = totalTTFT > 0 ? 1 - (cachedTTFT / totalTTFT) : 0;
    
    return {
      requestId,
      totalTokens: tokens.length,
      chunks,
      boundaries,
      cacheReferences,
      totalCacheHitTokens,
      estimatedTTFTReduction: round(estimatedTTFTReduction)
    };
  }

  /**
   * Check cache hit for a specific chunk.
   */
  checkChunkCacheHit(
    tokens: number[],
    chunkIndex: number,
    cacheEntries: Map<string, CacheEntry>
  ): { hit: boolean; hitType: "exact" | "prefix" | "partial"; cachedTokens: number } {
    const boundary = this.identifyPrefixBoundaries(tokens)[chunkIndex];
    if (!boundary) {
      return { hit: false, hitType: "partial", cachedTokens: 0 };
    }
    
    // Check for exact prefix match
    const exactKey = this.buildCacheKey(boundary.cumulativeHash, 0);
    if (cacheEntries.has(exactKey)) {
      const entry = cacheEntries.get(exactKey)!;
      if (entry.tokens.length >= boundary.endToken - boundary.startToken) {
        return { hit: true, hitType: "exact", cachedTokens: entry.tokens.length };
      }
    }
    
    // Check for prefix match
    for (const [key, entry] of cacheEntries) {
      const [prefixHash, offsetStr] = key.split(":");
      const offset = parseInt(offsetStr, 10);
      
      if (boundary.cumulativeHash.startsWith(prefixHash.substring(0, 8))) {
        if (entry.tokens.length >= (boundary.endToken - boundary.startToken + offset)) {
          return { hit: true, hitType: "prefix", cachedTokens: entry.tokens.length - offset };
        }
      }
    }
    
    return { hit: false, hitType: "partial", cachedTokens: 0 };
  }

  /**
   * Merge overlapping cache references for efficiency.
   */
  mergeCacheReferences(references: ChunkCacheReference[]): ChunkCacheReference[] {
    if (references.length === 0) return [];
    
    const merged: ChunkCacheReference[] = [];
    let current = { ...references[0] };
    
    for (let i = 1; i < references.length; i++) {
      const ref = references[i];
      
      // If references overlap, merge them
      if (ref.cachedTokenStart >= current.cachedTokenStart && 
          ref.cachedTokenStart <= current.cachedTokenEnd) {
        current.cachedTokenEnd = Math.max(current.cachedTokenEnd, ref.cachedTokenEnd);
        current.referencingChunks = [...new Set([...current.referencingChunks, ...ref.referencingChunks])];
        current.cacheHitProbability = Math.max(current.cacheHitProbability, ref.cacheHitProbability);
      } else {
        merged.push(current);
        current = { ...ref };
      }
    }
    
    merged.push(current);
    return merged;
  }

  /**
   * Register cache entries for cross-chunk lookups.
   */
  registerCacheEntry(prefixHash: string, offset: number, entry: CacheEntry): void {
    const key = this.buildCacheKey(prefixHash, offset);
    this.cacheState.set(key, entry);
  }

  /**
   * Get accumulated hash for a sequence of chunks.
   */
  getAccumulatedHash(tokens: number[], upToChunk: number): string {
    const startToken = upToChunk * this.config.chunkSize;
    const cumulativeTokens = tokens.slice(0, startToken);
    return computeCumulativeHash(cumulativeTokens);
  }

  /**
   * Calculate savings from chunked prefill with caching.
   */
  calculateSavings(
    originalTTFT: number,
    plan: ChunkedPrefillPlan
  ): {
    ttftReductionMs: number;
    ttftReductionPercent: number;
    computeSavingsMs: number;
    transferSavingsMs: number;
  } {
    const cachedChunks = plan.chunks.filter(c => c.transferMs === 0);
    const cacheHitTokens = cachedChunks.reduce(
      (sum, c) => sum + (c.endToken - c.startToken), 
      0
    );
    
    // Estimate savings
    const computeSavingsMs = cachedChunks.reduce((sum, c) => {
      // Original would have taken full compute time
      const originalCompute = c.computeMs / 0.35; // Assuming cache hit reduces to 35%
      return sum + (originalCompute - c.computeMs);
    }, 0);
    
    const transferSavingsMs = cachedChunks.reduce((sum, c) => sum + c.transferMs, 0);
    
    const ttftReductionMs = computeSavingsMs + transferSavingsMs;
    const ttftReductionPercent = originalTTFT > 0 
      ? (ttftReductionMs / originalTTFT) * 100 
      : 0;
    
    return {
      ttftReductionMs: round(ttftReductionMs),
      ttftReductionPercent: round(ttftReductionPercent),
      computeSavingsMs: round(computeSavingsMs),
      transferSavingsMs: round(transferSavingsMs)
    };
  }

  /**
   * Get current statistics.
   */
  getStats(): ChunkCoordinatorStats {
    return {
      ...this.stats,
      avgTTFTReduction: this.stats.totalRequests > 0 
        ? this.stats.avgTTFTReduction / this.stats.totalRequests 
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
   * Update configuration.
   */
  updateConfig(config: Partial<ChunkedPrefillConfig>): void {
    this.config = this.normalizeConfig({ ...this.config, ...config });
  }

  /**
   * Create a coordinator for a specific request.
   */
  createRequestCoordinator(requestId: string): RequestChunkCoordinator {
    return new RequestChunkCoordinator(requestId, this.config);
  }
}

/**
 * Request-scoped chunk coordinator for managing per-request state.
 */
export class RequestChunkCoordinator {
  private requestId: string;
  private config: ChunkedPrefillConfig;
  private processedChunks: Set<number>;
  private pendingCacheLookups: Map<number, Promise<boolean>>;

  constructor(requestId: string, config: ChunkedPrefillConfig) {
    this.requestId = requestId;
    this.config = config;
    this.processedChunks = new Set();
    this.pendingCacheLookups = new Map();
  }

  /**
   * Mark a chunk as processed.
   */
  markProcessed(chunkIndex: number): void {
    this.processedChunks.add(chunkIndex);
  }

  /**
   * Check if chunk is already processed.
   */
  isProcessed(chunkIndex: number): boolean {
    return this.processedChunks.has(chunkIndex);
  }

  /**
   * Get next chunk to process.
   */
  getNextChunk(totalChunks: number): number | null {
    for (let i = 0; i < totalChunks; i++) {
      if (!this.processedChunks.has(i)) {
        return i;
      }
    }
    return null;
  }

  /**
   * Get remaining chunks to process.
   */
  getRemainingChunks(totalChunks: number): number[] {
    const remaining: number[] = [];
    for (let i = 0; i < totalChunks; i++) {
      if (!this.processedChunks.has(i)) {
        remaining.push(i);
      }
    }
    return remaining;
  }
}

// ==================== Factory Function ====================

export function createChunkedPrefillCoordinator(
  config?: Partial<ChunkedPrefillConfig>,
  initialCache?: Map<string, CacheEntry>
): ChunkedPrefillCoordinator {
  return new ChunkedPrefillCoordinator(config, initialCache);
}
