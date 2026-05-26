/**
 * Speculative Decoding Scheduling Integration
 * 
 * Integrates speculative decoding with the PD separation serving scheduler.
 * Implements dynamic speculation window adjustment based on workload characteristics.
 * 
 * References:
 * - Agrawal et al. (2024). "Taming Throughput-Latency Tradeoff in LLM Inference 
 *   with Sarathi-Serve". OSDI.
 *   Discusses scheduling decisions that could benefit from speculation.
 * - Liu et al. (2024). "Optimizing Speculative Decoding for Serving Large Language 
 *   Models Using Goodput". CoRR.
 *   Optimizes speculation parameters for serving workloads.
 */
import type { PDWorkloadRequest } from "../ServingTrace.ts";
import { SpeculativeDecodingSimulator, type SpeculativeResult, type SpeculativeWorkloadRequest } from "./SpeculativeDecodingSimulator.ts";
import { getRecommendedPair, type DraftTargetPairConfig } from "./DraftTargetPair.ts";

/**
 * Scheduling decision types for speculative decoding.
 */
export type SpeculativeDecision = 
  | 'speculate'      // Use speculative decoding
  | 'direct_decode'  // Direct decode (speculation overhead not worth it)
  | 'batch_verify';  // Batch multiple requests for verification

/**
 * Configuration for speculative scheduling integration.
 */
export interface SpeculativeSchedulingConfig {
  /** Enable speculative decoding */
  enabled: boolean;
  
  /** Minimum decode tokens to consider speculation worthwhile */
  minDecodeTokensForSpeculation: number;
  
  /** Maximum speculation window size */
  maxSpeculationWindow: number;
  
  /** Dynamic window adjustment based on acceptance rate */
  enableDynamicWindow: boolean;
  
  /** Target acceptance rate for window adjustment */
  targetAcceptanceRate: number;
  
  /** Batch size for batched verification */
  batchVerificationSize: number;
  
  /** Override draft-target pair ID */
  draftTargetPairId?: string;
}

/**
 * Default configuration.
 */
export const DEFAULT_SPECULATIVE_SCHEDULING_CONFIG: Required<SpeculativeSchedulingConfig> = {
  enabled: true,
  minDecodeTokensForSpeculation: 32,
  maxSpeculationWindow: 6,
  enableDynamicWindow: true,
  targetAcceptanceRate: 0.65,
  batchVerificationSize: 4
};

/**
 * Workload characteristics for speculation decisions.
 */
export interface WorkloadCharacteristics {
  /** Average decode length */
  avgDecodeLength: number;
  /** Variance in decode length */
  decodeLengthVariance: number;
  /** Request arrival rate */
  arrivalRate: number;
  /** Ratio of interactive to background requests */
  interactiveRatio: number;
  /** Observed acceptance rate from recent requests */
  observedAcceptanceRate: number;
}

/**
 * Result of a speculation scheduling decision.
 */
export interface SpeculativeSchedulingResult {
  decision: SpeculativeDecision;
  requestId: string;
  optimalWindowSize: number;
  expectedSpeedup: number;
  reasoning: string;
  speculativeResult?: SpeculativeResult;
}

/**
 * Integration of speculative decoding with the serving scheduler.
 * 
 * This module bridges speculative decoding with the existing PD separation
 * architecture by:
 * 1. Analyzing workload characteristics to decide when to speculate
 * 2. Dynamically adjusting speculation window size based on acceptance rates
 * 3. Batching multiple requests for efficient verification
 * 4. Integrating with the decode phase of PD separation
 */
export class SpeculativeSchedulingIntegration {
  private config: Required<SpeculativeSchedulingConfig>;
  private simulator: SpeculativeDecodingSimulator;
  private recentResults: SpeculativeResult[] = [];
  private currentWindowSize: number;
  private draftTargetPair?: DraftTargetPairConfig;
  
  constructor(
    config: Partial<SpeculativeSchedulingConfig> = {},
    simulator?: SpeculativeDecodingSimulator
  ) {
    this.config = { ...DEFAULT_SPECULATIVE_SCHEDULING_CONFIG, ...config };
    this.simulator = simulator || new SpeculativeDecodingSimulator({
      numSpeculativeTokens: this.config.maxSpeculationWindow
    });
    this.currentWindowSize = this.config.maxSpeculationWindow;
    
    // Load draft-target pair if specified
    if (this.config.draftTargetPairId) {
      this.draftTargetPair = this.findDraftTargetPair(this.config.draftTargetPairId);
    }
  }

  /**
   * Decide whether and how to apply speculative decoding to a request.
   * 
   * Decision logic:
   * 1. If request is too short, skip speculation (overhead not worth it)
   * 2. If acceptance rate is low, reduce window or skip
   * 3. If high throughput demand, consider batch verification
   */
  decideSpeculation(
    request: PDWorkloadRequest,
    workloadCharacteristics?: WorkloadCharacteristics
  ): SpeculativeSchedulingResult {
    const requestId = request.id || `req-${Date.now()}`;
    
    // Check if speculation is enabled
    if (!this.config.enabled) {
      return {
        decision: 'direct_decode',
        requestId,
        optimalWindowSize: 0,
        expectedSpeedup: 1.0,
        reasoning: 'Speculative decoding disabled'
      };
    }
    
    // Check minimum decode tokens
    if (request.decodeTokens < this.config.minDecodeTokensForSpeculation) {
      return {
        decision: 'direct_decode',
        requestId,
        optimalWindowSize: 0,
        expectedSpeedup: 1.0,
        reasoning: `Request too short (${request.decodeTokens} < ${this.config.minDecodeTokensForSpeculation} tokens)`
      };
    }
    
    // Calculate optimal window size
    const optimalWindow = this.calculateOptimalWindow(workloadCharacteristics);
    
    // Check if batch verification is beneficial
    if (workloadCharacteristics && this.shouldBatchVerify(workloadCharacteristics)) {
      return {
        decision: 'batch_verify',
        requestId,
        optimalWindowSize: optimalWindow,
        expectedSpeedup: this.estimateBatchSpeedup(optimalWindow),
        reasoning: 'Batch verification mode for high-throughput workload'
      };
    }
    
    // Estimate expected speedup
    const expectedSpeedup = this.estimateSpeedup(optimalWindow, workloadCharacteristics);
    
    // If speedup is marginal, skip speculation
    if (expectedSpeedup < 1.2) {
      return {
        decision: 'direct_decode',
        requestId,
        optimalWindowSize: 0,
        expectedSpeedup: 1.0,
        reasoning: `Speedup (${expectedSpeedup.toFixed(2)}x) not worth speculation overhead`
      };
    }
    
    // Simulate with optimal window
    const speculativeRequest: SpeculativeWorkloadRequest = {
      ...request,
      enableSpeculative: true,
      contentAcceptanceRate: this.estimateAcceptanceRate(workloadCharacteristics)
    };
    
    const simResult = this.simulateWithWindow(speculativeRequest, optimalWindow);
    
    // Update window based on actual acceptance rate
    if (this.config.enableDynamicWindow) {
      this.adjustWindow(simResult.acceptanceRate);
    }
    
    return {
      decision: 'speculate',
      requestId,
      optimalWindowSize: optimalWindow,
      expectedSpeedup: simResult.speedupRatio,
      reasoning: `Speculate with window=${optimalWindow}, expected speedup=${simResult.speedupRatio.toFixed(2)}x`,
      speculativeResult: simResult
    };
  }

  /**
   * Calculate optimal speculation window based on workload.
   * 
   * Larger windows can yield more speedup but also lower acceptance rates.
   * We use a simple model: optimal_window ≈ max_window * (observed_acceptance / target_acceptance)
   */
  private calculateOptimalWindow(
    characteristics?: WorkloadCharacteristics
  ): number {
    const { maxSpeculationWindow, targetAcceptanceRate } = this.config;
    
    if (!characteristics || !this.config.enableDynamicWindow) {
      return maxSpeculationWindow;
    }
    
    // Adjust window based on observed acceptance rate
    const acceptanceRatio = characteristics.observedAcceptanceRate / targetAcceptanceRate;
    const adjustedWindow = Math.round(maxSpeculationWindow * Math.min(1.5, Math.max(0.5, acceptanceRatio)));
    
    return Math.min(maxSpeculationWindow, Math.max(1, adjustedWindow));
  }

  /**
   * Determine if batch verification should be used.
   * 
   * Batch verification is beneficial when:
   * 1. High arrival rate (many concurrent requests)
   * 2. Requests have similar decode lengths
   */
  private shouldBatchVerify(characteristics: WorkloadCharacteristics): boolean {
    const { batchVerificationSize } = this.config;
    
    // High arrival rate indicates batch opportunity
    if (characteristics.arrivalRate < batchVerificationSize) {
      return false;
    }
    
    // Low variance means requests are similar (good for batching)
    const cv = Math.sqrt(characteristics.decodeLengthVariance) / Math.max(1, characteristics.avgDecodeLength);
    
    return cv < 0.5 && characteristics.arrivalRate > batchVerificationSize * 2;
  }

  /**
   * Estimate speedup for batch verification mode.
   */
  private estimateBatchSpeedup(windowSize: number): number {
    // Batch verification amortizes overhead across multiple requests
    const baseSpeedup = this.simulator.calculateSpeedup(windowSize, Math.round(windowSize * 0.65));
    const batchMultiplier = 1 + Math.log(this.config.batchVerificationSize) * 0.1;
    
    return baseSpeedup * batchMultiplier;
  }

  /**
   * Estimate expected speedup for a given window.
   */
  private estimateSpeedup(
    windowSize: number,
    characteristics?: WorkloadCharacteristics
  ): number {
    const acceptanceRate = this.estimateAcceptanceRate(characteristics);
    const acceptedTokens = Math.round(windowSize * acceptanceRate);
    
    return this.simulator.calculateSpeedup(windowSize, acceptedTokens);
  }

  /**
   * Estimate acceptance rate based on workload characteristics.
   */
  private estimateAcceptanceRate(characteristics?: WorkloadCharacteristics): number {
    if (this.draftTargetPair) {
      return this.draftTargetPair.expectedAcceptanceRate;
    }
    
    if (characteristics?.observedAcceptanceRate > 0) {
      // Use exponential moving average of recent observations
      const recentAvg = characteristics.observedAcceptanceRate;
      const historicalAvg = this.getHistoricalAcceptanceRate();
      
      return historicalAvg > 0 
        ? 0.7 * recentAvg + 0.3 * historicalAvg 
        : recentAvg;
    }
    
    return this.config.targetAcceptanceRate;
  }

  /**
   * Get historical average acceptance rate from recent results.
   */
  private getHistoricalAcceptanceRate(): number {
    if (this.recentResults.length === 0) return 0;
    
    const sum = this.recentResults.reduce((acc, r) => acc + r.acceptanceRate, 0);
    return sum / this.recentResults.length;
  }

  /**
   * Simulate speculative decoding with a specific window size.
   */
  private simulateWithWindow(
    request: SpeculativeWorkloadRequest,
    windowSize: number
  ): SpeculativeResult {
    // Temporarily adjust simulator config
    const originalConfig = { ...this.config };
    this.simulator.configure({ numSpeculativeTokens: windowSize });
    
    const result = this.simulator.simulate(request);
    
    // Store result for future window adjustment
    this.recentResults.push(result);
    if (this.recentResults.length > 100) {
      this.recentResults.shift();
    }
    
    // Restore config
    this.simulator.configure({ 
      numSpeculativeTokens: this.config.maxSpeculationWindow 
    });
    
    return result;
  }

  /**
   * Dynamically adjust speculation window based on recent acceptance rates.
   */
  private adjustWindow(observedAcceptanceRate: number): void {
    const { targetAcceptanceRate, maxSpeculationWindow } = this.config;
    
    // Calculate adjustment factor
    const ratio = observedAcceptanceRate / targetAcceptanceRate;
    
    // Adjust window: decrease if acceptance is low, increase if high
    let adjustment: number;
    if (ratio > 1.1) {
      adjustment = 1; // Keep or slightly increase
    } else if (ratio < 0.9) {
      adjustment = -1; // Decrease window
    } else {
      adjustment = 0; // Stable
    }
    
    this.currentWindowSize = Math.min(
      maxSpeculationWindow,
      Math.max(1, this.currentWindowSize + adjustment)
    );
  }

  /**
   * Get current speculation window size.
   */
  getCurrentWindowSize(): number {
    return this.currentWindowSize;
  }

  /**
   * Get statistics about recent speculation performance.
   */
  getPerformanceStats(): {
    avgAcceptanceRate: number;
    avgSpeedup: number;
    totalRequests: number;
    speculationRate: number;
    currentWindow: number;
  } {
    const totalRequests = this.recentResults.length;
    
    if (totalRequests === 0) {
      return {
        avgAcceptanceRate: 0,
        avgSpeedup: 1.0,
        totalRequests: 0,
        speculationRate: 0,
        currentWindow: this.currentWindowSize
      };
    }
    
    const sumAcceptance = this.recentResults.reduce((acc, r) => acc + r.acceptanceRate, 0);
    const sumSpeedup = this.recentResults.reduce((acc, r) => acc + r.speedupRatio, 0);
    
    return {
      avgAcceptanceRate: sumAcceptance / totalRequests,
      avgSpeedup: sumSpeedup / totalRequests,
      totalRequests,
      speculationRate: this.recentResults.length / Math.max(1, totalRequests),
      currentWindow: this.currentWindowSize
    };
  }

  /**
   * Find draft-target pair by ID.
   */
  private findDraftTargetPair(pairId: string): DraftTargetPairConfig | undefined {
    // This would typically look up from a registry
    // For now, use the getRecommendedPair function
    return getRecommendedPair(pairId);
  }

  /**
   * Process a batch of requests for speculative decoding.
   * 
   * Groups requests by characteristics and applies batch verification
   * when beneficial.
   */
  processBatch(
    requests: PDWorkloadRequest[],
    workloadCharacteristics?: WorkloadCharacteristics
  ): SpeculativeSchedulingResult[] {
    return requests.map(request => 
      this.decideSpeculation(request, workloadCharacteristics)
    );
  }
}

/**
 * Default instance.
 */
export const speculativeSchedulingIntegration = new SpeculativeSchedulingIntegration();
