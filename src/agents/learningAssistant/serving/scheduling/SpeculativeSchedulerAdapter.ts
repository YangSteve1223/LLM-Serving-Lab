/**
 * Speculative Scheduler Adapter
 * 
 * Integrates Speculative Decoding with the AbstractScheduler interface.
 * Routes requests to speculative decoding when beneficial, falls back to base scheduler otherwise.
 * 
 * Features:
 * - Automatic speculative request routing based on request characteristics
 * - Configurable acceptance threshold and speculation parameters
 * - Integration with ContinuousBatchingAdapter or SGLangRadixAdapter as base scheduler
 * - Performance metrics tracking for both paths
 */
import { AbstractScheduler, type SchedulingWorkload, type SchedulingMetrics, type SchedulingResult } from "./SchedulerInterface.ts";
import { 
  SpeculativeDecodingSimulator, 
  type SpeculativeDecodingConfig,
  type SpeculativeWorkloadRequest,
  type SpeculativeResult,
  DEFAULT_SPECULATIVE_CONFIG 
} from "../speculative/SpeculativeDecodingSimulator.ts";
import type { PDWorkloadRequest } from "../ServingTrace.ts";

/**
 * Criteria for determining if a request should use speculative decoding.
 */
export interface SpeculativeRoutingCriteria {
  /** Minimum decode tokens for speculative path */
  minDecodeTokens: number;
  /** Maximum decode tokens for speculative path */
  maxDecodeTokens: number;
  /** Minimum prefill tokens (speculative helps with longer prefill) */
  minPrefillTokens: number;
  /** Enable for interactive priority requests */
  enableForInteractive: boolean;
  /** Enable for background priority requests */
  enableForBackground: boolean;
}

/**
 * Default routing criteria.
 */
export const DEFAULT_ROUTING_CRITERIA: SpeculativeRoutingCriteria = {
  minDecodeTokens: 50,
  maxDecodeTokens: 500,
  minPrefillTokens: 200,
  enableForInteractive: true,
  enableForBackground: false
};

/**
 * Configuration for SpeculativeSchedulerAdapter.
 */
export interface SpeculativeSchedulerAdapterConfig {
  /** Base scheduler adapter (ContinuousBatchingAdapter or SGLangRadixAdapter) */
  baseScheduler: AbstractScheduler;
  /** Speculative decoding configuration */
  speculativeConfig?: Partial<SpeculativeDecodingConfig>;
  /** Routing criteria for speculative path */
  routingCriteria?: Partial<SpeculativeRoutingCriteria>;
  /** Enable adaptive threshold based on load */
  enableAdaptiveThreshold?: boolean;
  /** Load threshold for adaptive mode (0-1) */
  adaptiveLoadThreshold?: number;
}

/**
 * Statistics from speculative scheduling.
 */
export interface SpeculativeSchedulerStats {
  totalRequests: number;
  speculativeRequests: number;
  baseSchedulerRequests: number;
  avgAcceptanceRate: number;
  avgSpeedupRatio: number;
  speculativeTTFTImprovement: number;
  speculativeTPOTImprovement: number;
}

/**
 * Speculative Scheduler Adapter
 * 
 * Wraps a base scheduler and optionally routes requests through speculative decoding.
 */
export class SpeculativeSchedulerAdapter extends AbstractScheduler {
  private baseScheduler: AbstractScheduler;
  private speculativeSimulator: SpeculativeDecodingSimulator;
  private speculativeConfig: Required<SpeculativeDecodingConfig>;
  private routingCriteria: SpeculativeRoutingCriteria;
  private enableAdaptiveThreshold: boolean;
  private adaptiveLoadThreshold: number;
  
  // Stats tracking
  private stats: SpeculativeSchedulerStats;
  
  constructor(config: SpeculativeSchedulerAdapterConfig) {
    super();
    
    this.baseScheduler = config.baseScheduler;
    this.speculativeConfig = { ...DEFAULT_SPECULATIVE_CONFIG, ...config.speculativeConfig };
    this.routingCriteria = { ...DEFAULT_ROUTING_CRITERIA, ...config.routingCriteria };
    this.enableAdaptiveThreshold = config.enableAdaptiveThreshold ?? false;
    this.adaptiveLoadThreshold = config.adaptiveLoadThreshold ?? 0.8;
    
    this.speculativeSimulator = new SpeculativeDecodingSimulator(this.speculativeConfig);
    
    this.stats = {
      totalRequests: 0,
      speculativeRequests: 0,
      baseSchedulerRequests: 0,
      avgAcceptanceRate: 0,
      avgSpeedupRatio: 0,
      speculativeTTFTImprovement: 0,
      speculativeTPOTImprovement: 0
    };
  }

  /**
   * Determine if a request should use speculative decoding.
   */
  shouldUseSpeculative(request: PDWorkloadRequest): boolean {
    const criteria = this.routingCriteria;
    
    // Check explicit flag FIRST - this allows overriding the default criteria
    if ("enableSpeculative" in request && typeof request.enableSpeculative === "boolean") {
      return request.enableSpeculative;
    }
    
    // Check decode tokens range
    if (request.decodeTokens < criteria.minDecodeTokens || 
        request.decodeTokens > criteria.maxDecodeTokens) {
      return false;
    }
    
    // Check prefill tokens minimum
    if (request.prefillTokens < criteria.minPrefillTokens) {
      return false;
    }
    
    // Check priority
    if (request.priority === "interactive" && !criteria.enableForInteractive) {
      return false;
    }
    if (request.priority === "background" && !criteria.enableForBackground) {
      return false;
    }
    
    return true;
  }

  /**
   * Schedule workload with speculative decoding optimization.
   */
  schedule(workload: SchedulingWorkload): SchedulingMetrics {
    const results = this.scheduleWithDetails(workload);
    
    return {
      ttftP50: results.ttftP50,
      ttftP90: results.ttftP90,
      ttftP99: results.ttftP99,
      tpotP50: results.tpotP50,
      tpotP90: results.tpotP90,
      tpotP99: results.tpotP99,
      goodput: results.goodput,
      throughput: results.throughput
    };
  }

  /**
   * Schedule workload with detailed results.
   */
  scheduleWithDetails(workload: SchedulingWorkload): SchedulingResult {
    const requests = workload.requests;
    
    if (requests.length === 0) {
      return this.createEmptyResult();
    }
    
    // Separate requests into speculative and base paths
    const speculativeRequests: SpeculativeWorkloadRequest[] = [];
    const baseRequests: PDWorkloadRequest[] = [];
    
    for (const req of requests) {
      if (this.shouldUseSpeculative(req)) {
        speculativeRequests.push({
          ...req,
          enableSpeculative: true,
          contentAcceptanceRate: this.speculativeConfig.typicalAcceptanceRate
        });
      } else {
        baseRequests.push(req);
      }
    }
    
    // Update stats
    this.stats.totalRequests += requests.length;
    this.stats.speculativeRequests += speculativeRequests.length;
    this.stats.baseSchedulerRequests += baseRequests.length;
    
    // Process speculative requests
    const speculativeResults: SpeculativeResult[] = [];
    let speculativeTTFTSum = 0;
    let speculativeTPOTSum = 0;
    let acceptanceRateSum = 0;
    let speedupRatioSum = 0;
    
    for (const req of speculativeRequests) {
      const result = this.speculativeSimulator.simulate(req);
      speculativeResults.push(result);
      speculativeTTFTSum += result.baselineLatencyMs;
      speculativeTPOTSum += result.speculativeLatencyMs;
      acceptanceRateSum += result.acceptanceRate;
      speedupRatioSum += result.speedupRatio;
    }
    
    // Process base requests
    const baseResults = baseRequests.length > 0 
      ? this.baseScheduler.scheduleWithDetails({ requests: baseRequests, config: workload.config })
      : null;
    
    // Aggregate metrics
    const aggregated = this.aggregateResults(
      speculativeResults,
      baseResults,
      speculativeTTFTSum,
      speculativeTPOTSum,
      acceptanceRateSum,
      speedupRatioSum
    );
    
    // Update running stats
    this.updateStats(speculativeResults, baseResults);
    
    return {
      policyName: `speculative_${this.baseScheduler.getPolicyName()}`,
      requestCount: requests.length,
      completedRequests: aggregated.completedRequests,
      droppedRequests: aggregated.droppedRequests,
      ttftP50: aggregated.ttftP50,
      ttftP90: aggregated.ttftP90,
      ttftP99: aggregated.ttftP99,
      tpotP50: aggregated.tpotP50,
      tpotP90: aggregated.tpotP90,
      tpotP99: aggregated.tpotP99,
      avgTTFT: aggregated.avgTTFT,
      avgTPOT: aggregated.avgTPOT,
      avgE2E: aggregated.avgE2E,
      goodput: aggregated.goodput,
      throughput: aggregated.throughput,
      notes: [
        `Speculative requests: ${speculativeRequests.length}/${requests.length}`,
        `Base scheduler: ${baseRequests.length} requests`,
        `Avg acceptance rate: ${(this.stats.avgAcceptanceRate * 100).toFixed(1)}%`,
        `Avg speedup: ${this.stats.avgSpeedupRatio.toFixed(2)}x`
      ]
    };
  }

  /**
   * Aggregate results from speculative and base scheduler paths.
   */
  private aggregateResults(
    speculativeResults: SpeculativeResult[],
    baseResult: SchedulingResult | null,
    speculativeTTFTSum: number,
    speculativeTPOTSum: number,
    acceptanceRateSum: number,
    speedupRatioSum: number
  ): SchedulingMetrics & { completedRequests: number; droppedRequests: number; avgTTFT: number; avgTPOT: number; avgE2E: number } {
    const totalRequests = this.stats.totalRequests;
    
    // Calculate speculative metrics
    const speculativeAvgTTFT = speculativeResults.length > 0 
      ? speculativeTTFTSum / speculativeResults.length 
      : 0;
    const speculativeAvgTPOT = speculativeResults.length > 0 
      ? speculativeTPOTSum / speculativeResults.length 
      : 0;
    
    // Use base result metrics if available
    const baseAvgTTFT = baseResult?.avgTTFT ?? 0;
    const baseAvgTPOT = baseResult?.avgTPOT ?? 0;
    const baseAvgE2E = baseResult?.avgE2E ?? 0;
    const baseTTFTs = this.extractPercentiles(baseResult, "ttft");
    const baseTPOTs = this.extractPercentiles(baseResult, "tpot");
    
    // Combine metrics weighted by request counts
    const specCount = speculativeResults.length;
    const baseCount = baseResult?.requestCount ?? 0;
    
    // Weighted average TTFT
    const totalTTFT = (speculativeAvgTTFT * specCount) + (baseAvgTTFT * baseCount);
    const avgTTFT = totalRequests > 0 ? totalTTFT / totalRequests : 0;
    
    // Weighted average TPOT
    const totalTPOT = (speculativeAvgTPOT * specCount) + (baseAvgTPOT * baseCount);
    const avgTPOT = totalRequests > 0 ? totalTPOT / totalRequests : 0;
    
    // E2E estimate (speculative is faster)
    const avgE2E = baseAvgE2E > 0 
      ? baseAvgE2E * (avgTTFT / Math.max(1, baseAvgTTFT)) 
      : avgTTFT + avgTPOT * 100;
    
    // Goodput: speculative should improve goodput
    const baseGoodput = baseResult?.goodput ?? 1;
    const speculativeGoodputBoost = speculativeResults.length > 0 
      ? (speedupRatioSum / speculativeResults.length - 1) * 0.05 // Up to 5% boost
      : 0;
    const goodput = Math.min(1, baseGoodput + speculativeGoodputBoost);
    
    // Throughput improvement
    const baseThroughput = baseResult?.throughput ?? 0;
    const avgSpeedup = speculativeResults.length > 0 
      ? speedupRatioSum / speculativeResults.length 
      : 1;
    const throughput = baseThroughput * ((specCount * avgSpeedup + baseCount) / Math.max(1, totalRequests));
    
    return {
      ttftP50: baseTTFTs.p50 ?? avgTTFT,
      ttftP90: baseTTFTs.p90 ?? avgTTFT * 1.5,
      ttftP99: baseTTFTs.p99 ?? avgTTFT * 2,
      tpotP50: baseTPOTs.p50 ?? avgTPOT,
      tpotP90: baseTPOTs.p90 ?? avgTPOT * 1.5,
      tpotP99: baseTPOTs.p99 ?? avgTPOT * 2,
      avgTTFT,
      avgTPOT,
      avgE2E,
      goodput,
      throughput,
      completedRequests: baseCount + specCount,
      droppedRequests: totalRequests - baseCount - specCount
    };
  }

  /**
   * Extract percentile values from scheduling result.
   */
  private extractPercentiles(result: SchedulingResult | null, metric: "ttft" | "tpot"): {
    p50: number;
    p90: number;
    p99: number;
  } {
    if (!result) {
      return { p50: 0, p90: 0, p99: 0 };
    }
    return {
      p50: metric === "ttft" ? result.ttftP50 : result.tpotP50,
      p90: metric === "ttft" ? result.ttftP90 : result.tpotP90,
      p99: metric === "ttft" ? result.ttftP99 : result.tpotP99
    };
  }

  /**
   * Update running statistics.
   */
  private updateStats(speculativeResults: SpeculativeResult[], baseResult: SchedulingResult | null): void {
    if (speculativeResults.length === 0) return;
    
    // Running average for acceptance rate
    const newAcceptanceSum = speculativeResults.reduce((sum, r) => sum + r.acceptanceRate, 0);
    const prevAcceptanceSum = this.stats.avgAcceptanceRate * (this.stats.speculativeRequests - speculativeResults.length);
    const totalAcceptanceSum = prevAcceptanceSum + newAcceptanceSum;
    this.stats.avgAcceptanceRate = totalAcceptanceSum / this.stats.speculativeRequests;
    
    // Running average for speedup ratio
    const newSpeedupSum = speculativeResults.reduce((sum, r) => sum + r.speedupRatio, 0);
    const prevSpeedupSum = this.stats.avgSpeedupRatio * (this.stats.speculativeRequests - speculativeResults.length);
    const totalSpeedupSum = prevSpeedupSum + newSpeedupSum;
    this.stats.avgSpeedupRatio = totalSpeedupSum / this.stats.speculativeRequests;
    
    // TTFT improvement (speculative is faster)
    if (speculativeResults.length > 0 && baseResult) {
      const speculativeAvgTTFT = speculativeResults.reduce((sum, r) => sum + r.speculativeLatencyMs, 0) / speculativeResults.length;
      const improvement = baseResult.ttftP50 - speculativeAvgTTFT;
      const alpha = 0.2; // Smoothing factor
      this.stats.speculativeTTFTImprovement = 
        alpha * improvement + (1 - alpha) * this.stats.speculativeTTFTImprovement;
    }
    
    // TPOT improvement
    if (speculativeResults.length > 0) {
      const speculativeAvgTPOT = speculativeResults.reduce((sum, r) => sum + r.speculativeLatencyMs, 0) / speculativeResults.length;
      const improvement = speculativeAvgTPOT > 0 
        ? (speculativeResults[0].baselineLatencyMs / speculativeResults.length - speculativeAvgTPOT)
        : 0;
      const alpha = 0.2;
      this.stats.speculativeTPOTImprovement = 
        alpha * improvement + (1 - alpha) * this.stats.speculativeTPOTImprovement;
    }
  }

  /**
   * Create empty result for zero workload.
   */
  private createEmptyResult(): SchedulingResult {
    return {
      policyName: `speculative_${this.baseScheduler.getPolicyName()}`,
      requestCount: 0,
      completedRequests: 0,
      droppedRequests: 0,
      ttftP50: 0,
      ttftP90: 0,
      ttftP99: 0,
      tpotP50: 0,
      tpotP90: 0,
      tpotP99: 0,
      avgTTFT: 0,
      avgTPOT: 0,
      avgE2E: 0,
      goodput: 0,
      throughput: 0,
      notes: ["No requests to schedule"]
    };
  }

  /**
   * Get policy name.
   */
  getPolicyName(): string {
    return `speculative_${this.baseScheduler.getPolicyName()}`;
  }

  /**
   * Get configuration.
   */
  getConfig(): Record<string, unknown> {
    return {
      baseScheduler: this.baseScheduler.getPolicyName(),
      speculativeConfig: this.speculativeConfig,
      routingCriteria: this.routingCriteria,
      enableAdaptiveThreshold: this.enableAdaptiveThreshold,
      adaptiveLoadThreshold: this.adaptiveLoadThreshold
    };
  }

  /**
   * Get statistics from scheduling runs.
   */
  getStats(): SpeculativeSchedulerStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      speculativeRequests: 0,
      baseSchedulerRequests: 0,
      avgAcceptanceRate: 0,
      avgSpeedupRatio: 0,
      speculativeTTFTImprovement: 0,
      speculativeTPOTImprovement: 0
    };
  }

  /**
   * Update speculative decoding configuration.
   */
  configureSpeculative(config: Partial<SpeculativeDecodingConfig>): void {
    this.speculativeConfig = { ...this.speculativeConfig, ...config };
    this.speculativeSimulator.configure(config);
  }

  /**
   * Update routing criteria.
   */
  configureRouting(criteria: Partial<SpeculativeRoutingCriteria>): void {
    this.routingCriteria = { ...this.routingCriteria, ...criteria };
  }

  /**
   * Get the underlying speculative simulator.
   */
  getSimulator(): SpeculativeDecodingSimulator {
    return this.speculativeSimulator;
  }

  /**
   * Get the base scheduler.
   */
  getBaseScheduler(): AbstractScheduler {
    return this.baseScheduler;
  }
}
