/**
 * Radix Prefix Cache Manager.
 * 
 * Implements a radix tree (prefix tree) for efficient KV cache prefix sharing.
 * Supports multiple eviction strategies: LRU, LFU, and FLOP-aware.
 * Integrates with EnhancedPDServingSimulator for cache-aware prefill simulation.
 */
import { createHash } from "node:crypto";
import type {
  EnhancedPDWorkloadRequest,
  LayerKVTransferEvent,
  PrefillChunk
} from "../ServingTrace.ts";
import type { CacheAwarePromptPlan } from "../CacheAwarePromptBuilder.ts";

// ==================== Types ====================

export type EvictionStrategy = "LRU" | "LFU" | "FLOP_AWARE";

export interface CacheEntry {
  key: string; // Hash of the prefix tokens
  tokens: number[];
  depth: number; // Token length
  sizeBytes: number;
  accessCount: number;
  lastAccessTime: number;
  flopsEfficiency: number; // FLOPs saved per byte stored
  createdAt: number;
  courseId?: string; // For course-level cache grouping
  studentId?: string;
}

export interface CacheStats {
  totalHits: number;
  totalMisses: number;
  tokenHits: number;
  tokenMisses: number;
  hitRate: number;
  tokenHitRate: number;
  memoryUsageBytes: number;
  memoryUsageMB: number;
  maxMemoryMB: number;
  savedPrefillTokens: number;
  savedPrefillPercentage: number;
  avgFlopsEfficiency: number;
}

export interface CacheAwarePDSimulationResult {
  originalPrefillTokens: number;
  effectivePrefillTokens: number;
  cacheHitTokens: number;
  ttftReductionMs: number;
  ttftReductionPercent: number;
  tokenSavingRatio: number;
  kvTransferSavingsMB: number;
  cacheStats: CacheStats;
  hitDetails: Array<{
    requestId: string;
    hitTokens: number;
    hitType: "exact" | "prefix" | "none";
    flopsSaved: number;
  }>;
}

export interface RadixNode {
  children: Map<string, RadixNode>;
  endOfToken: boolean;
  cacheEntry?: CacheEntry;
  cumulativeAccessCount: number;
  cumulativeFlopsSaved: number;
}

export interface RadixTreeConfig {
  maxMemoryMB: number;
  kvCacheSizePerTokenMB: number;
  flopsPerToken: number; // FLOPs per token during prefill
  evictionStrategy: EvictionStrategy;
  enableCoursePooling: boolean;
}

export interface CourseCacheGroup {
  courseId: string;
  entries: Set<string>;
  totalSizeMB: number;
  accessCount: number;
}

// ==================== Helper Functions ====================

function round(value: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function computeFlopsEfficiency(entry: CacheEntry, config: RadixTreeConfig): number {
  // FLOPs saved = prefill FLOPs for cached tokens
  // Efficiency = FLOPs saved / size in bytes
  const flopsSaved = entry.tokens.length * config.flopsPerToken;
  return flopsSaved / Math.max(1, entry.sizeBytes);
}

// ==================== Radix Tree Implementation ====================

export class RadixTree {
  private root: RadixNode;
  private config: Required<RadixTreeConfig>;
  private entries: Map<string, CacheEntry>;
  private courseGroups: Map<string, CourseCacheGroup>;

  constructor(config: RadixTreeConfig) {
    this.config = {
      maxMemoryMB: config.maxMemoryMB ?? 1024,
      kvCacheSizePerTokenMB: config.kvCacheSizePerTokenMB ?? 0.64,
      flopsPerToken: config.flopsPerToken ?? 1e6,
      evictionStrategy: config.evictionStrategy ?? "LRU",
      enableCoursePooling: config.enableCoursePooling ?? true
    };
    this.root = this.createNode();
    this.entries = new Map();
    this.courseGroups = new Map();
  }

  private createNode(): RadixNode {
    return {
      children: new Map(),
      endOfToken: false,
      cumulativeAccessCount: 0,
      cumulativeFlopsSaved: 0
    };
  }

  /**
   * Insert a token sequence into the radix tree.
   */
  insert(tokens: number[], courseId?: string, studentId?: string): CacheEntry {
    const key = this.hashTokens(tokens);
    const existing = this.entries.get(key);
    if (existing) {
      this.updateAccess(existing);
      return existing;
    }

    // Check memory capacity and evict if needed
    const estimatedSize = this.estimateEntrySize(tokens);
    this.ensureCapacity(estimatedSize);

    // Insert into tree
    let current = this.root;
    for (const token of tokens) {
      const tokenStr = token.toString();
      if (!current.children.has(tokenStr)) {
        current.children.set(tokenStr, this.createNode());
      }
      current = current.children.get(tokenStr)!;
      current.cumulativeAccessCount++;
    }
    current.endOfToken = true;

    // Create and store cache entry
    const entry: CacheEntry = {
      key,
      tokens: [...tokens],
      depth: tokens.length,
      sizeBytes: estimatedSize,
      accessCount: 1,
      lastAccessTime: Date.now(),
      flopsEfficiency: 0,
      createdAt: Date.now(),
      courseId,
      studentId
    };
    entry.flopsEfficiency = computeFlopsEfficiency(entry, this.config);

    this.entries.set(key, entry);

    // Update course groups if enabled
    if (this.config.enableCoursePooling && courseId) {
      this.addToCourseGroup(courseId, key);
    }

    return entry;
  }

  /**
   * Find the longest prefix match for a token sequence.
   */
  findLongestPrefix(tokens: number[]): { match: CacheEntry | null; matchedLength: number } {
    let current = this.root;
    let matchedLength = 0;
    let bestMatch: CacheEntry | null = null;
    let bestDepth = 0;

    for (const token of tokens) {
      const tokenStr = token.toString();
      if (!current.children.has(tokenStr)) {
        break;
      }
      current = current.children.get(tokenStr)!;
      matchedLength++;

      if (current.endOfToken && current.cacheEntry) {
        bestMatch = current.cacheEntry;
        bestDepth = matchedLength;
      }
    }

    if (bestMatch) {
      this.updateAccess(bestMatch);
    }

    return { match: bestMatch, matchedLength: bestDepth };
  }

  /**
   * Find exact match for a token sequence.
   */
  findExact(tokens: number[]): CacheEntry | null {
    const key = this.hashTokens(tokens);
    const entry = this.entries.get(key);
    if (entry) {
      this.updateAccess(entry);
      return entry;
    }
    return null;
  }

  /**
   * Update access statistics for LRU/LFU tracking.
   */
  private updateAccess(entry: CacheEntry): void {
    entry.accessCount++;
    entry.lastAccessTime = Date.now();
    entry.flopsEfficiency = computeFlopsEfficiency(entry, this.config);
  }

  /**
   * Get all entries for a course (for course-level pooling).
   */
  getCourseEntries(courseId: string): CacheEntry[] {
    const group = this.courseGroups.get(courseId);
    if (!group) return [];

    return Array.from(group.entries)
      .map(key => this.entries.get(key))
      .filter((e): e is CacheEntry => e !== undefined);
  }

  /**
   * Evict entries based on configured strategy.
   */
  private evict(targetBytes: number): void {
    let freedBytes = 0;
    const entriesToEvict: string[] = [];

    const allEntries = Array.from(this.entries.values());

    // Sort based on eviction strategy
    let sorted: CacheEntry[];
    switch (this.config.evictionStrategy) {
      case "LRU":
        sorted = allEntries.sort((a, b) => a.lastAccessTime - b.lastAccessTime);
        break;
      case "LFU":
        sorted = allEntries.sort((a, b) => a.accessCount - b.accessCount);
        break;
      case "FLOP_AWARE":
        sorted = allEntries.sort((a, b) => a.flopsEfficiency - b.flopsEfficiency);
        break;
      default:
        sorted = allEntries;
    }

    for (const entry of sorted) {
      if (freedBytes >= targetBytes) break;
      entriesToEvict.push(entry.key);
      freedBytes += entry.sizeBytes;
    }

    for (const key of entriesToEvict) {
      this.evictEntry(key);
    }
  }

  private evictEntry(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;

    // Remove from course group
    if (entry.courseId) {
      this.removeFromCourseGroup(entry.courseId, key);
    }

    this.entries.delete(key);

    // Remove from tree (simplified - full removal would need tree pruning)
    // In production, you'd need to clean up empty tree nodes
  }

  private ensureCapacity(additionalBytes: number): void {
    const currentUsage = this.getMemoryUsageBytes();
    const maxBytes = this.config.maxMemoryMB * 1024 * 1024;

    if (currentUsage + additionalBytes > maxBytes) {
      const targetFree = additionalBytes + (currentUsage + additionalBytes - maxBytes);
      this.evict(targetFree);
    }
  }

  private addToCourseGroup(courseId: string, key: string): void {
    if (!this.courseGroups.has(courseId)) {
      this.courseGroups.set(courseId, {
        courseId,
        entries: new Set(),
        totalSizeMB: 0,
        accessCount: 0
      });
    }
    const group = this.courseGroups.get(courseId)!;
    group.entries.add(key);
    const entry = this.entries.get(key);
    if (entry) {
      group.totalSizeMB += entry.sizeBytes / (1024 * 1024);
      group.accessCount += entry.accessCount;
    }
  }

  private removeFromCourseGroup(courseId: string, key: string): void {
    const group = this.courseGroups.get(courseId);
    if (!group) return;
    group.entries.delete(key);
  }

  private hashTokens(tokens: number[]): string {
    return createHash("sha256").update(tokens.join(",")).digest("hex");
  }

  private estimateEntrySize(tokens: number[]): number {
    // Each layer stores K+V vectors, estimated at kvCacheSizePerTokenMB per token
    return tokens.length * this.config.kvCacheSizePerTokenMB * 1024 * 1024;
  }

  getMemoryUsageBytes(): number {
    return Array.from(this.entries.values()).reduce((sum, e) => sum + e.sizeBytes, 0);
  }

  getStats(): CacheStats {
    const totalHits = Array.from(this.entries.values()).reduce((sum, e) => sum + (e.accessCount - 1), 0);
    const totalTokens = Array.from(this.entries.values()).reduce((sum, e) => sum + e.depth, 0);

    return {
      totalHits,
      totalMisses: 0,
      tokenHits: 0,
      tokenMisses: 0,
      hitRate: 0,
      tokenHitRate: 0,
      memoryUsageBytes: this.getMemoryUsageBytes(),
      memoryUsageMB: this.getMemoryUsageBytes() / (1024 * 1024),
      maxMemoryMB: this.config.maxMemoryMB,
      savedPrefillTokens: 0,
      savedPrefillPercentage: 0,
      avgFlopsEfficiency: Array.from(this.entries.values()).reduce((sum, e) => sum + e.flopsEfficiency, 0) / Math.max(1, this.entries.size)
    };
  }

  clear(): void {
    this.root = this.createNode();
    this.entries.clear();
    this.courseGroups.clear();
  }
}

// ==================== RadixPrefixCacheManager ====================

export class RadixPrefixCacheManager {
  private tree: RadixTree;
  private config: Required<RadixTreeConfig>;
  private stats: CacheStats;
  private hitLog: Array<CacheAwarePDSimulationResult["hitDetails"][number]>;

  constructor(config: RadixTreeConfig) {
    this.config = {
      maxMemoryMB: config.maxMemoryMB ?? 1024,
      kvCacheSizePerTokenMB: config.kvCacheSizePerTokenMB ?? 0.64,
      flopsPerToken: config.flopsPerToken ?? 1e6,
      evictionStrategy: config.evictionStrategy ?? "LRU",
      enableCoursePooling: config.enableCoursePooling ?? true
    };
    this.tree = new RadixTree(this.config);
    this.resetStats();
    this.hitLog = [];
  }

  /**
   * Process a request and determine cache hit/miss.
   */
  processRequest(request: EnhancedPDWorkloadRequest): {
    cacheHit: boolean;
    hitTokens: number;
    hitType: "exact" | "prefix" | "none";
    remainingTokens: number;
    flopsSaved: number;
  } {
    const tokens = this.generateTokenSequence(request);

    // Try exact match first
    const exactMatch = this.tree.findExact(tokens);
    if (exactMatch) {
      this.recordHit(request.id, tokens.length, "exact", exactMatch.tokens.length * this.config.flopsPerToken);
      return {
        cacheHit: true,
        hitTokens: tokens.length,
        hitType: "exact",
        remainingTokens: 0,
        flopsSaved: tokens.length * this.config.flopsPerToken
      };
    }

    // Try longest prefix match
    const prefixMatch = this.tree.findLongestPrefix(tokens);
    if (prefixMatch.match && prefixMatch.matchedLength > 0) {
      const hitTokens = prefixMatch.matchedLength;
      const remainingTokens = tokens.length - hitTokens;
      const flopsSaved = hitTokens * this.config.flopsPerToken;

      this.recordHit(request.id, hitTokens, "prefix", flopsSaved);
      return {
        cacheHit: true,
        hitTokens,
        hitType: "prefix",
        remainingTokens,
        flopsSaved
      };
    }

    // Cache miss
    this.recordMiss();
    return {
      cacheHit: false,
      hitTokens: 0,
      hitType: "none",
      remainingTokens: tokens.length,
      flopsSaved: 0
    };
  }

  /**
   * Cache a completed request's prefix for future reuse.
   */
  cacheRequest(request: EnhancedPDWorkloadRequest, courseId?: string, studentId?: string): void {
    const tokens = this.generateTokenSequence(request);
    const cacheableTokens = Math.min(
      tokens.length,
      request.cacheablePrefixTokens ?? Math.floor(tokens.length * 0.3)
    );

    if (cacheableTokens > 0) {
      this.tree.insert(tokens.slice(0, cacheableTokens), courseId, studentId);
    }
  }

  /**
   * Cache a prompt plan's stable prefix.
   */
  cacheStablePrefix(plan: CacheAwarePromptPlan, courseId?: string): void {
    // Extract tokens from the canonical prompt (simplified)
    const tokens = this.tokensFromText(plan.canonicalPrompt);
    if (tokens.length > 0) {
      this.tree.insert(tokens.slice(0, plan.stablePrefixTokens), courseId);
    }
  }

  /**
   * Get course-level cache pool statistics.
   */
  getCoursePoolStats(courseId: string): {
    entryCount: number;
    totalSizeMB: number;
    accessCount: number;
  } {
    const entries = this.tree.getCourseEntries(courseId);
    return {
      entryCount: entries.length,
      totalSizeMB: entries.reduce((sum, e) => sum + e.sizeBytes, 0) / (1024 * 1024),
      accessCount: entries.reduce((sum, e) => sum + e.accessCount, 0)
    };
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
    const noCacheTokens = requests.reduce((sum, r) => sum + r.prefillTokens, 0);
    const noCacheMs = noCacheTokens * 0.18; // Simplified prefill time

    let exactHits = 0, exactSaved = 0;
    let prefixHits = 0, prefixSaved = 0;
    let courseHits = 0, courseSaved = 0;

    for (const req of requests) {
      const tokens = this.generateTokenSequence(req);

      // Exact match
      if (this.tree.findExact(tokens)) {
        exactHits++;
        exactSaved += tokens.length;
      }

      // Prefix tree
      const prefixResult = this.tree.findLongestPrefix(tokens);
      if (prefixResult.match) {
        prefixHits++;
        prefixSaved += prefixResult.matchedLength;
      }

      // Course pool (simplified)
      if (req.cacheablePrefixTokens && req.cacheablePrefixTokens > 0) {
        courseHits++;
        courseSaved += req.cacheablePrefixTokens;
      }
    }

    return {
      noCache: { totalTokens: noCacheTokens, totalPrefillMs: noCacheMs },
      exactMatch: {
        hitRate: round(exactHits / requests.length, 4),
        savedTokens: exactSaved,
        savedPrefillMs: exactSaved * 0.18
      },
      prefixTree: {
        hitRate: round(prefixHits / requests.length, 4),
        savedTokens: prefixSaved,
        savedPrefillMs: prefixSaved * 0.18
      },
      coursePool: {
        hitRate: round(courseHits / requests.length, 4),
        savedTokens: courseSaved,
        savedPrefillMs: courseSaved * 0.18
      }
    };
  }

  /**
   * Simulate cache-aware prefill with the EnhancedPDServingSimulator.
   */
  simulateCacheAwarePrefill(
    request: EnhancedPDWorkloadRequest,
    simulatorConfig?: {
      prefillBaseMs?: number;
      prefillMsPerToken?: number;
      kvMsPerToken?: number;
    }
  ): CacheAwarePDSimulationResult {
    const prefillBaseMs = simulatorConfig?.prefillBaseMs ?? 25;
    const prefillMsPerToken = simulatorConfig?.prefillMsPerToken ?? 0.18;
    const kvMsPerToken = simulatorConfig?.kvMsPerToken ?? 0.015;

    const originalTokens = request.prefillTokens;
    const cacheResult = this.processRequest(request);

    const effectiveTokens = cacheResult.remainingTokens;
    const cacheHitTokens = originalTokens - effectiveTokens;

    // Calculate time savings
    const originalPrefillMs = prefillBaseMs + originalTokens * prefillMsPerToken;
    const effectivePrefillMs = prefillBaseMs + effectiveTokens * prefillMsPerToken;
    const originalKVTransferMs = originalTokens * kvMsPerToken;
    const effectiveKVTransferMs = effectiveTokens * kvMsPerToken;

    const ttftReductionMs = originalPrefillMs - effectivePrefillMs;
    const ttftReductionPercent = (ttftReductionMs / originalPrefillMs) * 100;
    const tokenSavingRatio = cacheHitTokens / Math.max(1, originalTokens);
    const kvTransferSavingsMB = (cacheHitTokens * this.config.kvCacheSizePerTokenMB);

    return {
      originalPrefillTokens: originalTokens,
      effectivePrefillTokens: effectiveTokens,
      cacheHitTokens,
      ttftReductionMs: round(ttftReductionMs, 2),
      ttftReductionPercent: round(ttftReductionPercent, 2),
      tokenSavingRatio: round(tokenSavingRatio, 4),
      kvTransferSavingsMB: round(kvTransferSavingsMB, 4),
      cacheStats: this.getStats(),
      hitDetails: this.hitLog.slice(-100) // Last 100 hits
    };
  }

  getStats(): CacheStats {
    const treeStats = this.tree.getStats();
    const totalRequests = treeStats.totalHits + treeStats.totalMisses;
    const hitRate = totalRequests > 0 ? treeStats.totalHits / totalRequests : 0;

    return {
      ...treeStats,
      hitRate: round(hitRate, 4),
      totalMisses: this.stats.totalMisses,
      savedPrefillTokens: this.hitLog.reduce((sum, h) => sum + h.hitTokens, 0),
      savedPrefillPercentage: this.hitLog.length > 0
        ? round(this.hitLog.reduce((sum, h) => sum + h.hitTokens, 0) / 
            Math.max(1, this.hitLog.reduce((sum, h) => sum + h.hitTokens, 0) + 
            this.stats.tokenMisses) * 100, 2)
        : 0
    };
  }

  private generateTokenSequence(request: EnhancedPDWorkloadRequest): number[] {
    // Generate deterministic token sequence from request ID and tokens
    const base = request.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return Array.from({ length: request.prefillTokens }, (_, i) => (base + i * 31) % 65536);
  }

  private tokensFromText(text: string): number[] {
    return Array.from(text).map(c => c.charCodeAt(0));
  }

  private recordHit(requestId: string, hitTokens: number, hitType: "exact" | "prefix" | "none", flopsSaved: number): void {
    this.stats.totalHits++;
    this.stats.tokenHits += hitTokens;
    this.hitLog.push({ requestId, hitTokens, hitType, flopsSaved });
  }

  private recordMiss(): void {
    this.stats.totalMisses++;
  }

  private resetStats(): void {
    this.stats = {
      totalHits: 0,
      totalMisses: 0,
      tokenHits: 0,
      tokenMisses: 0,
      hitRate: 0,
      tokenHitRate: 0,
      memoryUsageBytes: 0,
      memoryUsageMB: 0,
      maxMemoryMB: this.config.maxMemoryMB,
      savedPrefillTokens: 0,
      savedPrefillPercentage: 0,
      avgFlopsEfficiency: 0
    };
    this.hitLog = [];
  }

  clear(): void {
    this.tree.clear();
    this.resetStats();
  }
}

export const radixPrefixCacheManager = new RadixPrefixCacheManager({});
