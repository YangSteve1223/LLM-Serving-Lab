/**
 * Hierarchical KV Cache Manager.
 * 
 * Implements a three-tier cache hierarchy:
 * - L1_GPU: GPU HBM, fastest, smallest capacity
 * - L2_CPU: CPU memory, slower, larger capacity
 * - L3_DISTRIBUTED: Distributed storage, slowest, unlimited
 * 
 * Supports prefetch strategies, write policies, and migration modeling.
 */
import { createHash } from "node:crypto";

// ==================== Types ====================

export type CacheTier = "L1_GPU" | "L2_CPU" | "L3_DISTRIBUTED";
export type PrefetchStrategy = "best_effort" | "wait_complete" | "timeout";
export type WritePolicy = "write_through" | "write_back";
export type CacheLevel = "hot" | "warm" | "cold";

export interface TierConfig {
  tier: CacheTier;
  capacityMB: number;
  bandwidthGBps: number;
  latencyUs: number; // Read latency in microseconds
  writeLatencyUs: number;
  transferBandwidthGBps?: number; // For L1-L2 transfer
}

export interface KVCacheEntry {
  key: string;
  requestId: string;
  courseId?: string;
  studentId?: string;
  tokens: number[];
  layers: number;
  sizeBytes: number;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  currentTier: CacheTier;
  prefetched: boolean;
  dirty: boolean; // For write-back policy
}

export interface CacheMigration {
  entryKey: string;
  fromTier: CacheTier;
  toTier: CacheTier;
  startTimeUs: number;
  endTimeUs: number;
  bytes: number;
  bandwidth: number;
}

export interface HierarchicalCacheStats {
  tiers: Record<CacheTier, {
    entries: number;
    sizeBytes: number;
    sizeMB: number;
    capacityMB: number;
    utilization: number;
    hits: number;
    misses: number;
    hitRate: number;
  }>;
  migrations: CacheMigration[];
  totalMigrationsTimeUs: number;
  prefetchStats: {
    attempted: number;
    completed: number;
    timeout: number;
    cancelled: number;
  };
  writeStats: {
    writeThrough: number;
    writeBack: number;
    dirtyPages: number;
  };
}

export interface CacheRequest {
  key: string;
  requestId: string;
  tokens: number;
  layers: number;
  courseId?: string;
  studentId?: string;
  priority?: "high" | "normal" | "low";
}

export interface CacheResponse {
  hit: boolean;
  tier: CacheTier | null;
  entry: KVCacheEntry | null;
  fetchTimeUs: number;
  migrationTimeUs: number;
}

// ==================== Default Configurations ====================

export const DEFAULT_TIER_CONFIGS: TierConfig[] = [
  {
    tier: "L1_GPU",
    capacityMB: 64, // 64MB GPU cache (e.g., for KV cache)
    bandwidthGBps: 2000,
    latencyUs: 1,
    writeLatencyUs: 2,
    transferBandwidthGBps: 400 // IB to CPU
  },
  {
    tier: "L2_CPU",
    capacityMB: 4096, // 4GB CPU memory for KV cache
    bandwidthGBps: 100,
    latencyUs: 100,
    writeLatencyUs: 150,
    transferBandwidthGBps: 50 // Network to distributed
  },
  {
    tier: "L3_DISTRIBUTED",
    capacityMB: 1024 * 1024, // 1TB distributed cache
    bandwidthGBps: 10,
    latencyUs: 10000,
    writeLatencyUs: 15000
  }
];

export const DEFAULT_PREFETCH_CONFIG = {
  strategy: "best_effort" as PrefetchStrategy,
  timeoutUs: 50000, // 50ms timeout
  batchSize: 8 // Prefetch up to 8 entries
};

export const DEFAULT_WRITE_POLICY: WritePolicy = "write_back";

// ==================== Helper Functions ====================

function round(value: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function hashKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 16);
}

// ==================== HierarchicalKVCache Implementation ====================

export class HierarchicalKVCache {
  private tiers: Map<CacheTier, Map<string, KVCacheEntry>>;
  private tierConfigs: Map<CacheTier, TierConfig>;
  private migrations: CacheMigration[];
  private stats: HierarchicalCacheStats;
  private writePolicy: WritePolicy;
  private prefetchStrategy: PrefetchStrategy;
  private prefetchTimeoutUs: number;
  private kvSizePerTokenMB: number;

  constructor(config?: {
    tierConfigs?: Partial<TierConfig>[];
    writePolicy?: WritePolicy;
    prefetchStrategy?: PrefetchStrategy;
    prefetchTimeoutUs?: number;
    kvSizePerTokenMB?: number;
  }) {
    this.tiers = new Map();
    this.tierConfigs = new Map();
    this.migrations = [];
    this.writePolicy = config?.writePolicy ?? DEFAULT_WRITE_POLICY;
    this.prefetchStrategy = config?.prefetchStrategy ?? DEFAULT_PREFETCH_CONFIG.strategy;
    this.prefetchTimeoutUs = config?.prefetchTimeoutUs ?? DEFAULT_PREFETCH_CONFIG.timeoutUs;
    this.kvSizePerTokenMB = config?.kvSizePerTokenMB ?? 0.64;

    // Initialize tier configs
    const configs = config?.tierConfigs ?? DEFAULT_TIER_CONFIGS;
    for (const cfg of configs) {
      this.tierConfigs.set(cfg.tier, cfg);
      this.tiers.set(cfg.tier, new Map());
    }

    this.resetStats();
  }

  /**
   * Write a KV cache entry to the cache hierarchy.
   */
  write(request: CacheRequest): void {
    const entry: KVCacheEntry = {
      key: request.key || hashKey(request.requestId, request.courseId || ""),
      requestId: request.requestId,
      courseId: request.courseId,
      studentId: request.studentId,
      tokens: Array(request.tokens).fill(0).map((_, i) => i),
      layers: request.layers,
      sizeBytes: this.estimateSize(request.tokens, request.layers),
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 1,
      currentTier: "L1_GPU",
      prefetched: false,
      dirty: false
    };

    // Write to appropriate tier based on write policy
    if (this.writePolicy === "write_through") {
      this.writeThrough(entry);
    } else {
      this.writeBack(entry);
    }
  }

  /**
   * Read a KV cache entry from the cache hierarchy.
   */
  read(key: string, priority?: "high" | "normal" | "low"): CacheResponse {
    const startTimeUs = Date.now() * 1000;

    // Search tiers from fastest to slowest
    const tierOrder: CacheTier[] = ["L1_GPU", "L2_CPU", "L3_DISTRIBUTED"];

    for (const tier of tierOrder) {
      const entries = this.tiers.get(tier);
      if (!entries) continue;

      const entry = entries.get(key);
      if (entry) {
        // Update access stats
        entry.lastAccessedAt = Date.now();
        entry.accessCount++;

        // Check if we need to promote to higher tier
        if (tier !== "L1_GPU" && priority === "high") {
          this.promoteEntry(entry, "L1_GPU");
        }

        const fetchTimeUs = (Date.now() * 1000) - startTimeUs;
        return {
          hit: true,
          tier,
          entry,
          fetchTimeUs: round(fetchTimeUs, 2),
          migrationTimeUs: 0
        };
      }
    }

    // Cache miss
    const fetchTimeUs = (Date.now() * 1000) - startTimeUs;
    return {
      hit: false,
      tier: null,
      entry: null,
      fetchTimeUs: round(fetchTimeUs, 2),
      migrationTimeUs: 0
    };
  }

  /**
   * Prefetch entries to higher tiers based on prediction.
   */
  prefetch(keys: string[], targetTier: CacheTier = "L1_GPU"): {
    completed: string[];
    failed: string[];
    totalTimeUs: number;
  } {
    const completed: string[] = [];
    const failed: string[] = [];
    const startTimeUs = Date.now() * 1000;

    for (const key of keys) {
      const result = this.prefetchEntry(key, targetTier);
      if (result.success) {
        completed.push(key);
      } else {
        failed.push(key);
      }
    }

    const totalTimeUs = (Date.now() * 1000) - startTimeUs;
    return { completed, failed, totalTimeUs: round(totalTimeUs, 2) };
  }

  /**
   * Migrate an entry between tiers.
   */
  migrate(key: string, targetTier: CacheTier): boolean {
    // Find entry in current tier
    for (const [tier, entries] of this.tiers) {
      if (tier === targetTier) continue;

      const entry = entries.get(key);
      if (entry) {
        return this.migrateEntry(entry, tier, targetTier);
      }
    }
    return false;
  }

  /**
   * Evict entries from a tier to make room.
   */
  evict(tier: CacheTier, targetBytes: number): number {
    const entries = this.tiers.get(tier);
    if (!entries) return 0;

    const config = this.tierConfigs.get(tier);
    if (!config) return 0;

    let freedBytes = 0;
    const entriesToEvict: string[] = [];

    // LRU eviction: sort by last access time
    const sorted = Array.from(entries.entries())
      .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

    for (const [key, entry] of sorted) {
      if (freedBytes >= targetBytes) break;

      // If write-back policy and dirty, demote instead of evict
      if (this.writePolicy === "write_back" && entry.dirty) {
        this.demoteEntry(entry, tier);
      } else {
        entriesToEvict.push(key);
        freedBytes += entry.sizeBytes;
      }
    }

    for (const key of entriesToEvict) {
      entries.delete(key);
    }

    return freedBytes;
  }

  /**
   * Get tier statistics.
   */
  getStats(): HierarchicalCacheStats {
    const tierStats: HierarchicalCacheStats["tiers"] = {} as any;

    for (const [tier, config] of this.tierConfigs) {
      const entries = this.tiers.get(tier);
      if (!entries) continue;

      let sizeBytes = 0;
      let hits = 0, misses = 0;

      for (const entry of entries.values()) {
        sizeBytes += entry.sizeBytes;
        hits += entry.accessCount - 1; // First access is not a hit
      }

      tierStats[tier] = {
        entries: entries.size,
        sizeBytes,
        sizeMB: round(sizeBytes / (1024 * 1024), 2),
        capacityMB: config.capacityMB,
        utilization: round(sizeBytes / (config.capacityMB * 1024 * 1024), 4),
        hits,
        misses,
        hitRate: hits + misses > 0 ? round(hits / (hits + misses), 4) : 0
      };
    }

    return {
      ...this.stats,
      tiers: tierStats
    };
  }

  /**
   * Estimate KV cache size for given tokens and layers.
   */
  estimateSize(tokens: number, layers: number): number {
    // Each layer stores K+V vectors
    // Size per token per layer ≈ kvSizePerTokenMB MB
    return tokens * layers * this.kvSizePerTokenMB * 1024 * 1024;
  }

  /**
   * Calculate migration time between tiers.
   */
  calculateMigrationTime(bytes: number, fromTier: CacheTier, toTier: CacheTier): number {
    const fromConfig = this.tierConfigs.get(fromTier);
    const toConfig = this.tierConfigs.get(toTier);

    if (!fromConfig || !toConfig) return Infinity;

    // Use the slower of the two bandwidths
    const bandwidth = Math.min(
      fromConfig.transferBandwidthGBps ?? fromConfig.bandwidthGBps,
      toConfig.transferBandwidthGBps ?? toConfig.bandwidthGBps
    );

    // Time in microseconds
    return (bytes / (bandwidth * 1024 * 1024 * 1024)) * 1e6;
  }

  /**
   * Clear all caches.
   */
  clear(): void {
    for (const entries of this.tiers.values()) {
      entries.clear();
    }
    this.migrations = [];
    this.resetStats();
  }

  // ==================== Private Methods ====================

  private writeThrough(entry: KVCacheEntry): void {
    // Write to all tiers simultaneously
    for (const [tier, config] of this.tierConfigs) {
      if (this.getTierUsageBytes(tier) + entry.sizeBytes > config.capacityMB * 1024 * 1024) {
        this.evict(tier, entry.sizeBytes);
      }
      this.tiers.get(tier)?.set(entry.key, { ...entry, currentTier: tier });
    }
    this.stats.writeStats.writeThrough++;
  }

  private writeBack(entry: KVCacheEntry): void {
    // Only write to L1 (GPU), mark as dirty
    const config = this.tierConfigs.get("L1_GPU");
    if (config && this.getTierUsageBytes("L1_GPU") + entry.sizeBytes > config.capacityMB * 1024 * 1024) {
      this.evict("L1_GPU", entry.sizeBytes);
    }

    entry.dirty = true;
    this.tiers.get("L1_GPU")?.set(entry.key, entry);
    this.stats.writeStats.writeBack++;
    this.stats.writeStats.dirtyPages++;
  }

  private promoteEntry(entry: KVCacheEntry, targetTier: CacheTier): void {
    const currentTier = entry.currentTier;
    if (currentTier === targetTier) return;

    const migrationTimeUs = this.calculateMigrationTime(
      entry.sizeBytes,
      currentTier,
      targetTier
    );

    this.recordMigration(entry.key, currentTier, targetTier, migrationTimeUs, entry.sizeBytes);

    // Remove from current tier
    this.tiers.get(currentTier)?.delete(entry.key);

    // Add to target tier
    entry.currentTier = targetTier;
    this.tiers.get(targetTier)?.set(entry.key, entry);
  }

  private demoteEntry(entry: KVCacheEntry, fromTier: CacheTier): void {
    // Find appropriate lower tier
    const tierOrder: CacheTier[] = ["L1_GPU", "L2_CPU", "L3_DISTRIBUTED"];
    const currentIdx = tierOrder.indexOf(fromTier);

    for (let i = currentIdx + 1; i < tierOrder.length; i++) {
      const targetTier = tierOrder[i];
      const config = this.tierConfigs.get(targetTier);

      if (config && this.getTierUsageBytes(targetTier) + entry.sizeBytes <= config.capacityMB * 1024 * 1024) {
        this.migrateEntry(entry, fromTier, targetTier);
        return;
      }
    }

    // No space in lower tiers, persist to L3
    this.migrateEntry(entry, fromTier, "L3_DISTRIBUTED");
  }

  private migrateEntry(entry: KVCacheEntry, fromTier: CacheTier, toTier: CacheTier): boolean {
    const migrationTimeUs = this.calculateMigrationTime(entry.sizeBytes, fromTier, toTier);

    this.recordMigration(entry.key, fromTier, toTier, migrationTimeUs, entry.sizeBytes);

    // Remove from source
    this.tiers.get(fromTier)?.delete(entry.key);

    // Add to destination
    entry.currentTier = toTier;
    entry.dirty = false;
    this.tiers.get(toTier)?.set(entry.key, entry);

    return true;
  }

  private prefetchEntry(key: string, targetTier: CacheTier): { success: boolean; timeUs: number } {
    // Find entry in lower tier
    const tierOrder: CacheTier[] = ["L1_GPU", "L2_CPU", "L3_DISTRIBUTED"];
    const targetIdx = tierOrder.indexOf(targetTier);
    let sourceTier: CacheTier | null = null;
    let entry: KVCacheEntry | null = null;

    for (let i = targetIdx + 1; i < tierOrder.length; i++) {
      const tier = tierOrder[i];
      const e = this.tiers.get(tier)?.get(key);
      if (e) {
        sourceTier = tier;
        entry = e;
        break;
      }
    }

    if (!entry || !sourceTier) {
      this.stats.prefetchStats.failed++;
      return { success: false, timeUs: 0 };
    }

    const migrationTimeUs = this.calculateMigrationTime(entry.sizeBytes, sourceTier, targetTier);
    const startTimeUs = Date.now() * 1000;

    switch (this.prefetchStrategy) {
      case "best_effort":
        // Start prefetch but don't wait
        this.migrateEntry(entry, sourceTier, targetTier);
        entry.prefetched = true;
        this.stats.prefetchStats.attempted++;
        this.stats.prefetchStats.completed++;
        return { success: true, timeUs: migrationTimeUs };

      case "wait_complete":
        // Wait for prefetch to complete
        if (migrationTimeUs <= this.prefetchTimeoutUs) {
          this.migrateEntry(entry, sourceTier, targetTier);
          entry.prefetched = true;
          this.stats.prefetchStats.attempted++;
          this.stats.prefetchStats.completed++;
          return { success: true, timeUs: migrationTimeUs };
        }
        this.stats.prefetchStats.timeout++;
        return { success: false, timeUs: this.prefetchTimeoutUs };

      case "timeout":
        // Start prefetch, cancel if timeout
        const elapsedUs = (Date.now() * 1000) - startTimeUs;
        if (elapsedUs + migrationTimeUs <= this.prefetchTimeoutUs) {
          this.migrateEntry(entry, sourceTier, targetTier);
          entry.prefetched = true;
          this.stats.prefetchStats.attempted++;
          this.stats.prefetchStats.completed++;
          return { success: true, timeUs: migrationTimeUs };
        }
        this.stats.prefetchStats.cancelled++;
        return { success: false, timeUs: this.prefetchTimeoutUs };

      default:
        return { success: false, timeUs: 0 };
    }
  }

  private recordMigration(key: string, from: CacheTier, to: CacheTier, timeUs: number, bytes: number): void {
    const config = this.tierConfigs.get(from);
    const migration: CacheMigration = {
      entryKey: key,
      fromTier: from,
      toTier: to,
      startTimeUs: Date.now() * 1000,
      endTimeUs: Date.now() * 1000 + timeUs,
      bytes,
      bandwidth: config?.transferBandwidthGBps ?? 100
    };

    this.migrations.push(migration);
    this.stats.totalMigrationsTimeUs += timeUs;
  }

  private getTierUsageBytes(tier: CacheTier): number {
    const entries = this.tiers.get(tier);
    if (!entries) return 0;
    return Array.from(entries.values()).reduce((sum, e) => sum + e.sizeBytes, 0);
  }

  private resetStats(): void {
    this.stats = {
      tiers: {} as any,
      migrations: [],
      totalMigrationsTimeUs: 0,
      prefetchStats: {
        attempted: 0,
        completed: 0,
        timeout: 0,
        cancelled: 0
      },
      writeStats: {
        writeThrough: 0,
        writeBack: 0,
        dirtyPages: 0
      }
    };
  }
}

export const hierarchicalKVCache = new HierarchicalKVCache();
