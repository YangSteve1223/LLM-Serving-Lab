/**
 * Adaptive Chunked Prefill Coordinator
 * 
 * Dynamically adjusts chunk size based on system load and SLO risk.
 * Provides three strategies:
 * - load_based: Adjust based on GPU/memory utilization
 * - slo_based: Adjust based on SLO compliance risk
 * - hybrid: Combine both for balanced optimization
 * 
 * Compatible with existing ChunkedPrefillCoordinator.
 * 
 * References:
 * - Agrawal et al. (2024). "Taming Throughput-Latency Tradeoff in LSS Inference 
 *   with Sarathi-Serve". OSDI.
 * - Kwon et al. (2023). "Efficient Memory Management for Large Language Model 
 *   Serving with PagedAttention". SOSP.
 */
import { ChunkedPrefillCoordinator, type ChunkedPrefillConfig, type ChunkedPrefillPlan } from "./ChunkedPrefillCoordinator.ts";
import type { PDWorkloadRequest, ServingSLO } from "../ServingTrace.ts";
import { round } from "../utils/MathUtils.ts";

// ==================== Types ====================

export type AdaptiveStrategy = "load_based" | "slo_based" | "hybrid";

export interface AdaptiveChunkConfig {
  enabled: boolean;
  strategy: AdaptiveStrategy;
  minChunkSize: number;
  maxChunkSize: number;
  highLoadThreshold: number;
  lowLoadThreshold: number;
  adjustmentFactor: number;
  cooldownMs: number;
  sloWeight: number;
  loadWeight: number;
}

export interface AdaptiveChunkMetrics {
  currentChunkSize: number;
  strategy: AdaptiveStrategy;
  systemLoad: number;
  sloRisk: number;
  adjustments: number;
  avgChunkSize: number;
  chunkSizeHistory: number[];
}

export interface ChunkingDecision {
  requestId: string;
  recommendedChunkSize: number;
  strategy: AdaptiveStrategy;
  systemLoad: number;
  sloRisk: number;
  reasoning: string;
}

// ==================== Constants ====================

const DEFAULT_ADAPTIVE_CONFIG: AdaptiveChunkConfig = {
  enabled: true,
  strategy: "hybrid",
  minChunkSize: 128,
  maxChunkSize: 2048,
  highLoadThreshold: 0.8,
  lowLoadThreshold: 0.4,
  adjustmentFactor: 0.2,
  cooldownMs: 1000,
  sloWeight: 0.5,
  loadWeight: 0.5
};

// ==================== Helper Functions ====================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothTransition(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

// ==================== AdaptiveChunkedPrefillCoordinator Class ====================

export class AdaptiveChunkedPrefillCoordinator {
  private config: AdaptiveChunkConfig;
  private baseCoordinator: ChunkedPrefillCoordinator;
  private currentChunkSize: number;
  private metrics: AdaptiveChunkMetrics;
  private lastAdjustmentTime: number = 0;
  private loadHistory: number[] = [];
  private sloRiskHistory: number[] = [];

  constructor(
    config: Partial<AdaptiveChunkConfig> = {},
    baseCoordinator?: ChunkedPrefillCoordinator
  ) {
    this.config = { ...DEFAULT_ADAPTIVE_CONFIG, ...config };
    this.baseCoordinator = baseCoordinator ?? new ChunkedPrefillCoordinator({
      chunkSize: this.config.minChunkSize
    });
    this.currentChunkSize = this.config.maxChunkSize; // Start conservative
    this.metrics = this.initMetrics();
  }

  private initMetrics(): AdaptiveChunkMetrics {
    return {
      currentChunkSize: this.currentChunkSize,
      strategy: this.config.strategy,
      systemLoad: 0,
      sloRisk: 0,
      adjustments: 0,
      avgChunkSize: this.currentChunkSize,
      chunkSizeHistory: [this.currentChunkSize]
    };
  }

  /**
   * Calculate optimal chunk size based on current system state.
   */
  calculateOptimalChunkSize(systemLoad: number, sloRisk: number): number {
    if (!this.config.enabled) {
      return this.baseCoordinator['config'].chunkSize;
    }

    const now = Date.now();
    
    // Check cooldown
    if (now - this.lastAdjustmentTime < this.config.cooldownMs) {
      return this.currentChunkSize;
    }

    // Update histories
    this.loadHistory.push(systemLoad);
    this.sloRiskHistory.push(sloRisk);
    
    // Keep history bounded
    if (this.loadHistory.length > 100) {
      this.loadHistory.shift();
    }
    if (this.sloRiskHistory.length > 100) {
      this.sloRiskHistory.shift();
    }

    let targetChunkSize: number;

    switch (this.config.strategy) {
      case "load_based":
        targetChunkSize = this.calculateLoadBasedChunkSize(systemLoad);
        break;
        
      case "slo_based":
        targetChunkSize = this.calculateSLOBasedChunkSize(sloRisk);
        break;
        
      case "hybrid":
      default:
        targetChunkSize = this.calculateHybridChunkSize(systemLoad, sloRisk);
        break;
    }

    // Smooth transition
    const adjustedSize = Math.round(
      smoothTransition(this.currentChunkSize, targetChunkSize, this.config.adjustmentFactor)
    );

    // Clamp to bounds
    const finalChunkSize = clamp(
      adjustedSize,
      this.config.minChunkSize,
      this.config.maxChunkSize
    );

    // Update state if changed
    if (finalChunkSize !== this.currentChunkSize) {
      this.currentChunkSize = finalChunkSize;
      this.lastAdjustmentTime = now;
      this.metrics.adjustments++;
      
      // Update base coordinator config
      this.baseCoordinator['config'].chunkSize = finalChunkSize;
    }

    // Update metrics
    this.metrics.currentChunkSize = this.currentChunkSize;
    this.metrics.systemLoad = systemLoad;
    this.metrics.sloRisk = sloRisk;
    this.metrics.chunkSizeHistory.push(this.currentChunkSize);
    this.metrics.avgChunkSize = round(
      this.metrics.chunkSizeHistory.reduce((a, b) => a + b, 0) / 
      this.metrics.chunkSizeHistory.length
    );

    return this.currentChunkSize;
  }

  /**
   * Load-based chunk size calculation.
   * High load -> smaller chunks (lower latency variance)
   * Low load -> larger chunks (higher throughput)
   */
  private calculateLoadBasedChunkSize(systemLoad: number): number {
    const range = this.config.maxChunkSize - this.config.minChunkSize;
    
    if (systemLoad >= this.config.highLoadThreshold) {
      // High load: use minimum chunk size
      return this.config.minChunkSize;
    } else if (systemLoad <= this.config.lowLoadThreshold) {
      // Low load: use maximum chunk size for throughput
      return this.config.maxChunkSize;
    } else {
      // Medium load: interpolate
      const normalizedLoad = (systemLoad - this.config.lowLoadThreshold) / 
                            (this.config.highLoadThreshold - this.config.lowLoadThreshold);
      const chunkSize = this.config.maxChunkSize - (normalizedLoad * range);
      return Math.round(chunkSize);
    }
  }

  /**
   * SLO-based chunk size calculation.
   * High SLO risk -> smaller chunks (better latency)
   * Low SLO risk -> larger chunks (higher throughput)
   */
  private calculateSLOBasedChunkSize(sloRisk: number): number {
    const range = this.config.maxChunkSize - this.config.minChunkSize;
    
    // sloRisk > 1 means at risk of missing SLO
    if (sloRisk >= 1.0) {
      // Critical: use minimum chunk size
      return this.config.minChunkSize;
    } else if (sloRisk <= 0.3) {
      // Safe: use maximum chunk size
      return this.config.maxChunkSize;
    } else {
      // Moderate risk: interpolate
      const normalizedRisk = sloRisk / 1.0;
      const chunkSize = this.config.maxChunkSize - (normalizedRisk * range);
      return Math.round(chunkSize);
    }
  }

  /**
   * Hybrid chunk size calculation combining load and SLO factors.
   */
  private calculateHybridChunkSize(systemLoad: number, sloRisk: number): number {
    const loadTarget = this.calculateLoadBasedChunkSize(systemLoad);
    const sloTarget = this.calculateSLOBasedChunkSize(sloRisk);
    
    // Weighted average
    const combinedTarget = 
      loadTarget * this.config.loadWeight + 
      sloTarget * this.config.sloWeight;
    
    return Math.round(combinedTarget);
  }

  /**
   * Get decision with reasoning for a specific request.
   */
  getChunkingDecision(
    request: PDWorkloadRequest,
    systemLoad: number,
    sloRisk: number,
    slo: ServingSLO
  ): ChunkingDecision {
    const chunkSize = this.calculateOptimalChunkSize(systemLoad, sloRisk);
    
    let reasoning: string;
    if (this.config.strategy === "load_based") {
      if (systemLoad >= this.config.highLoadThreshold) {
        reasoning = `High system load (${(systemLoad * 100).toFixed(0)}%), using smaller chunks to reduce latency variance`;
      } else if (systemLoad <= this.config.lowLoadThreshold) {
        reasoning = `Low system load (${(systemLoad * 100).toFixed(0)}%), using larger chunks for better throughput`;
      } else {
        reasoning = `Moderate system load (${(systemLoad * 100).toFixed(0)}%), balanced chunk size`;
      }
    } else if (this.config.strategy === "slo_based") {
      if (sloRisk >= 1.0) {
        reasoning = `High SLO risk (${(sloRisk * 100).toFixed(0)}%), prioritizing latency with smaller chunks`;
      } else if (sloRisk <= 0.3) {
        reasoning = `Low SLO risk (${(sloRisk * 100).toFixed(0)}%), optimizing for throughput`;
      } else {
        reasoning = `Moderate SLO risk (${(sloRisk * 100).toFixed(0)}%), balanced optimization`;
      }
    } else {
      reasoning = `Hybrid strategy: load=${(systemLoad * 100).toFixed(0)}%, sloRisk=${(sloRisk * 100).toFixed(0)}%`;
    }

    return {
      requestId: request.id,
      recommendedChunkSize: chunkSize,
      strategy: this.config.strategy,
      systemLoad,
      sloRisk,
      reasoning
    };
  }

  /**
   * Create a chunked prefill plan with adaptive chunk size.
   */
  createAdaptivePlan(
    requestId: string,
    tokens: number[],
    cacheablePrefixes: Map<string, number>,
    systemLoad: number = 0.5,
    sloRisk: number = 0.5
  ): ChunkedPrefillPlan {
    // Calculate optimal chunk size
    const optimalChunkSize = this.calculateOptimalChunkSize(systemLoad, sloRisk);
    
    // Temporarily update base coordinator config
    const originalChunkSize = this.baseCoordinator['config'].chunkSize;
    this.baseCoordinator['config'].chunkSize = optimalChunkSize;
    
    // Create plan using base coordinator
    const plan = this.baseCoordinator.createPlan(requestId, tokens, cacheablePrefixes);
    
    // Restore original config
    this.baseCoordinator['config'].chunkSize = originalChunkSize;
    
    return plan;
  }

  /**
   * Get current metrics.
   */
  getMetrics(): AdaptiveChunkMetrics {
    return { ...this.metrics };
  }

  /**
   * Update configuration.
   */
  configure(config: Partial<AdaptiveChunkConfig>): void {
    this.config = { ...this.config, ...config };
    this.metrics.strategy = this.config.strategy;
  }

  /**
   * Get base coordinator for direct operations.
   */
  getBaseCoordinator(): ChunkedPrefillCoordinator {
    return this.baseCoordinator;
  }

  /**
   * Reset metrics and history.
   */
  reset(): void {
    this.metrics = this.initMetrics();
    this.loadHistory = [];
    this.sloRiskHistory = [];
    this.lastAdjustmentTime = 0;
  }

  /**
   * Generate metrics report.
   */
  generateReport(): string {
    const lines: string[] = [];
    
    lines.push('# Adaptive Chunked Prefill Report\n');
    lines.push(`Generated: ${new Date().toISOString()}\n`);
    
    lines.push('## Configuration\n');
    lines.push(`| Parameter | Value |`);
    lines.push(`|-----------|-------|`);
    lines.push(`| Enabled | ${this.config.enabled} |`);
    lines.push(`| Strategy | ${this.config.strategy} |`);
    lines.push(`| Min Chunk Size | ${this.config.minChunkSize} |`);
    lines.push(`| Max Chunk Size | ${this.config.maxChunkSize} |`);
    lines.push(`| High Load Threshold | ${(this.config.highLoadThreshold * 100).toFixed(0)}% |`);
    lines.push(`| Low Load Threshold | ${(this.config.lowLoadThreshold * 100).toFixed(0)}% |`);
    lines.push(`| Adjustment Factor | ${(this.config.adjustmentFactor * 100).toFixed(0)}% |`);
    
    lines.push('\n## Current State\n');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Current Chunk Size | ${this.metrics.currentChunkSize} |`);
    lines.push(`| System Load | ${(this.metrics.systemLoad * 100).toFixed(1)}% |`);
    lines.push(`| SLO Risk | ${(this.metrics.sloRisk * 100).toFixed(1)}% |`);
    lines.push(`| Total Adjustments | ${this.metrics.adjustments} |`);
    lines.push(`| Avg Chunk Size | ${Math.round(this.metrics.avgChunkSize)} |`);
    
    lines.push('\n## Strategy Behavior\n');
    lines.push(this.getStrategyExplanation());
    
    return lines.join('\n');
  }

  /**
   * Get explanation of current strategy behavior.
   */
  private getStrategyExplanation(): string {
    switch (this.config.strategy) {
      case "load_based":
        return `**Load-Based Strategy**: Chunk size is adjusted based on system load.
- High load (>=${(this.config.highLoadThreshold * 100).toFixed(0)}%): Use min chunk size (${this.config.minChunkSize}) to reduce latency variance
- Low load (<=${(this.config.lowLoadThreshold * 100).toFixed(0)}%): Use max chunk size (${this.config.maxChunkSize}) for throughput
- Medium load: Linear interpolation between min and max`;
        
      case "slo_based":
        return `**SLO-Based Strategy**: Chunk size is adjusted based on SLO compliance risk.
- High risk (>=100%): Use min chunk size (${this.config.minChunkSize}) to prioritize latency
- Low risk (<=30%): Use max chunk size (${this.config.maxChunkSize}) for throughput
- Moderate risk: Linear interpolation based on risk level`;
        
      case "hybrid":
      default:
        return `**Hybrid Strategy**: Combines load and SLO factors (weights: ${this.config.loadWeight}/${this.config.sloWeight}).
- Computes load-based target and SLO-based target
- Takes weighted average for final chunk size
- Provides balanced optimization for both throughput and latency`;
    }
  }
}

/**
 * Create a standard adaptive coordinator with recommended settings.
 */
export function createAdaptiveCoordinator(
  strategy: AdaptiveStrategy = "hybrid"
): AdaptiveChunkedPrefillCoordinator {
  return new AdaptiveChunkedPrefillCoordinator({
    enabled: true,
    strategy,
    minChunkSize: 128,
    maxChunkSize: 2048,
    highLoadThreshold: 0.8,
    lowLoadThreshold: 0.4,
    adjustmentFactor: 0.2,
    cooldownMs: 1000,
    sloWeight: 0.5,
    loadWeight: 0.5
  });
}

/**
 * Create aggressive adaptive coordinator for low-latency scenarios.
 */
export function createLowLatencyCoordinator(): AdaptiveChunkedPrefillCoordinator {
  return new AdaptiveChunkedPrefillCoordinator({
    enabled: true,
    strategy: "slo_based",
    minChunkSize: 64,
    maxChunkSize: 512,
    highLoadThreshold: 0.6,
    lowLoadThreshold: 0.3,
    adjustmentFactor: 0.3,
    cooldownMs: 500,
    sloWeight: 0.8,
    loadWeight: 0.2
  });
}

/**
 * Create throughput-optimized coordinator.
 */
export function createThroughputOptimizedCoordinator(): AdaptiveChunkedPrefillCoordinator {
  return new AdaptiveChunkedPrefillCoordinator({
    enabled: true,
    strategy: "load_based",
    minChunkSize: 256,
    maxChunkSize: 4096,
    highLoadThreshold: 0.9,
    lowLoadThreshold: 0.3,
    adjustmentFactor: 0.15,
    cooldownMs: 2000,
    sloWeight: 0.3,
    loadWeight: 0.7
  });
}
