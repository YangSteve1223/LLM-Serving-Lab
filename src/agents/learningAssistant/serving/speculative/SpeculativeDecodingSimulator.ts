/**
 * Speculative Decoding Simulator
 * 
 * Simulates speculative decoding with draft model + target model architecture.
 * Based on the following key papers:
 * 
 * References:
 * - Leviathan et al. (2023). "Fast Inference from Transformers via Speculative Decoding". ICML.
 *   Introduces the core idea of using a draft model to propose tokens and a target model to verify.
 * - SpecInfer (Miao et al., 2024). "SpecInfer: Accelerating Large Language Model Serving with 
 *   Tree-based Speculative Inference". MLSys. 
 *   Extends to tree-based speculation with multiple speculative models.
 * - Medusa (Cai et al., 2024). "Medusa: Simple LLM Inference Acceleration Framework with 
 *   Multiple Decoding Heads". ICML.
 *   Uses multiple prediction heads on the target model instead of separate draft models.
 * - EAGLE (Li et al., 2024). "EAGLE: Speculative Sampling Requires Rethinking Feature Uncertainty".
 *   Performs autoregression on feature representations for better speedup.
 */
import type { PDWorkloadRequest, SchedulingMetrics } from "../ServingTrace.ts";
import { DeterministicRandom } from "../utils/DeterministicRandom.ts";

/**
 * Configuration for speculative decoding simulation.
 */
export interface SpeculativeDecodingConfig {
  /** Number of speculative tokens to generate per round */
  numSpeculativeTokens: number;
  /** Acceptance threshold for speculation (0-1) */
  acceptanceThreshold: number;
  /** Draft model speedup relative to target (e.g., 0.1 means draft is 10x faster) */
  draftModelSpeedup: number;
  /** Enable tree-based speculation (SpecInfer-style) */
  enableTreeSpeculation: boolean;
  /** Number of draft candidates per position */
  numDraftCandidates: number;
  /** Typical acceptance rate for draft tokens */
  typicalAcceptanceRate: number;
}

/**
 * Result of a single speculative decoding round.
 */
export interface SpeculativeRoundResult {
  draftTokens: number;
  acceptedTokens: number;
  rejectedToken: number; // Position of first rejection (0-indexed)
  roundSpeedup: number;
  energySavings: number;
}

/**
 * Result of simulating speculative decoding for a request.
 */
export interface SpeculativeResult {
  requestId: string;
  totalTokens: number;
  rounds: SpeculativeRoundResult[];
  totalDraftTokens: number;
  totalAcceptedTokens: number;
  acceptanceRate: number;
  speedupRatio: number;
  energySavings: number;
  baselineLatencyMs: number;
  speculativeLatencyMs: number;
}

/**
 * Comparison between speculative and baseline decoding.
 */
export interface ComparisonResult {
  baselineMetrics: SchedulingMetrics;
  speculativeMetrics: SchedulingMetrics;
  speedupRatio: number;
  acceptanceRate: number;
  energySavings: number;
  improvementTTFT: number;
  improvementTPOT: number;
  improvementE2E: number;
}

/**
 * PD Workload Request with speculative parameters.
 */
export interface SpeculativeWorkloadRequest extends PDWorkloadRequest {
  /** Enable speculative decoding for this request */
  enableSpeculative?: boolean;
  /** Custom acceptance rate for this request's content type */
  contentAcceptanceRate?: number;
}

/**
 * Default speculative decoding configuration.
 */
export const DEFAULT_SPECULATIVE_CONFIG: Required<SpeculativeDecodingConfig> = {
  numSpeculativeTokens: 4,
  acceptanceThreshold: 0.7,
  draftModelSpeedup: 0.1, // Draft is 10x faster (100x smaller model)
  enableTreeSpeculation: true,
  numDraftCandidates: 3,
  typicalAcceptanceRate: 0.65
};

/**
 * Speculative Decoding Simulator
 * 
 * Implements the draft-target model speculation pattern:
 * 1. Draft model generates k candidate tokens quickly
 * 2. Target model verifies all k tokens in parallel
 * 3. Accepted tokens are kept, rejected tokens are resampled
 * 
 * The speedup comes from the fact that draft verification (batch forward pass)
 * takes roughly the same time as a single decode step, but can accept multiple tokens.
 */
export class SpeculativeDecodingSimulator {
  private config: Required<SpeculativeDecodingConfig>;
  private rng: DeterministicRandom;
  
  constructor(config: Partial<SpeculativeDecodingConfig> = {}, seed?: number) {
    this.config = { ...DEFAULT_SPECULATIVE_CONFIG, ...config };
    this.rng = new DeterministicRandom(seed ?? 42);
  }

  /**
   * Configure the simulator parameters.
   */
  configure(config: Partial<SpeculativeDecodingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Simulate speculative decoding for a single request.
   * 
   * The simulation models the following process:
   * 1. Draft model generates numSpeculativeTokens candidate tokens
   * 2. Target model batch-verifies all candidates
   * 3. Tokens with probability >= acceptanceThreshold are accepted
   * 4. First rejected token triggers resample, rest are discarded
   * 5. Process repeats until all tokens are generated
   * 
   * @param request The workload request to simulate
   * @returns SpeculativeResult with detailed metrics
   */
  simulate(request: SpeculativeWorkloadRequest): SpeculativeResult {
    const { 
      numSpeculativeTokens, 
      acceptanceThreshold, 
      draftModelSpeedup,
      enableTreeSpeculation,
      numDraftCandidates,
      typicalAcceptanceRate
    } = this.config;
    
    const requestId = request.id || `req-${Date.now()}`;
    const totalTokens = request.decodeTokens;
    
    // Use custom acceptance rate if provided, otherwise use typical
    const acceptanceRate = request.contentAcceptanceRate ?? typicalAcceptanceRate;
    
    const rounds: SpeculativeRoundResult[] = [];
    let totalDraftTokens = 0;
    let totalAcceptedTokens = 0;
    
    let remainingTokens = totalTokens;
    
    while (remainingTokens > 0) {
      // Number of tokens to speculate this round
      const tokensToSpeculate = Math.min(remainingTokens, numSpeculativeTokens);
      
      // Simulate acceptance process with position decay model
      // Earlier positions in a draft sequence have higher acceptance rates
      // because the draft model is more confident about tokens closer to its
      // last generated token. This follows empirical observations from
      // Leviathan et al. (2023) and SpecInfer.
      let acceptedCount = 0;
      let rejectedPosition = tokensToSpeculate; // Default: all accepted
      
      if (enableTreeSpeculation) {
        // SpecInfer-style: with tree speculation, we can have multiple candidates
        // per position, increasing acceptance probability
        const treeAcceptanceBoost = 1 + (numDraftCandidates - 1) * 0.3;
        
        // Simulate token-by-token acceptance with position decay and tree boost
        for (let i = 0; i < tokensToSpeculate; i++) {
          // Position decay: earlier tokens have higher acceptance
          // Decay factor: 0.1 per position (first token ~base rate, last token ~0.4 * base rate)
          const positionDecay = 1 - (i / tokensToSpeculate) * 0.6;
          const positionAcceptanceRate = Math.min(0.95, acceptanceRate * positionDecay * treeAcceptanceBoost);
          const positionAcceptance = this.rng.random() < positionAcceptanceRate;
          
          if (positionAcceptance) {
            acceptedCount++;
          } else if (rejectedPosition === tokensToSpeculate) {
            rejectedPosition = i;
          }
        }
      } else {
        // Standard speculation: acceptance with position decay
        for (let i = 0; i < tokensToSpeculate; i++) {
          // Position decay: earlier tokens have higher acceptance
          const positionDecay = 1 - (i / tokensToSpeculate) * 0.6;
          const positionAcceptanceRate = Math.min(0.95, acceptanceRate * positionDecay);
          
          if (this.rng.random() < positionAcceptanceRate) {
            acceptedCount++;
          } else if (rejectedPosition === tokensToSpeculate) {
            rejectedPosition = i;
          }
        }
      }
      
      // Calculate round metrics
      const draftTokens = tokensToSpeculate;
      const roundSpeedup = this.calculateSpeedup(draftTokens, acceptedCount);
      const energySavings = this.calculateEnergySavings(draftTokens, acceptedCount, draftModelSpeedup);
      
      rounds.push({
        draftTokens,
        acceptedTokens: acceptedCount,
        rejectedToken: rejectedPosition,
        roundSpeedup,
        energySavings
      });
      
      totalDraftTokens += draftTokens;
      totalAcceptedTokens += acceptedCount;
      remainingTokens -= acceptedCount;
      
      // If rejected early, we need one extra target-only decode step
      if (rejectedPosition < tokensToSpeculate) {
        remainingTokens--;
        totalDraftTokens++; // Count the rejected speculation
      }
      
      // Safety break for very long generations
      if (rounds.length > totalTokens * 2) break;
    }
    
    const overallAcceptanceRate = totalDraftTokens > 0 
      ? totalAcceptedTokens / totalDraftTokens 
      : 1;
    
    // Calculate speedup ratio
    // Baseline: each token requires one decode step
    // Speculative: draft is faster, and we batch verify
    const baselineDecodeSteps = totalTokens;
    const speculativeSteps = rounds.length;
    const speedupRatio = baselineDecodeSteps / Math.max(1, speculativeSteps);
    
    // Energy savings: draft model is much smaller and faster
    // E_savings = (1 - draft_energy / target_energy) * accepted_ratio
    const energySavingsTotal = rounds.reduce((sum, r) => sum + r.energySavings, 0);
    
    // Calculate latency
    // Baseline: each token ~10ms (decodeMsPerToken)
    // Speculative: draft verification batch + occasional target-only steps
    const baselineLatencyMs = totalTokens * 10;
    const speculativeLatencyMs = (speculativeSteps * 12) + (totalTokens - totalAcceptedTokens) * 5;
    
    return {
      requestId,
      totalTokens,
      rounds,
      totalDraftTokens,
      totalAcceptedTokens,
      acceptanceRate: overallAcceptanceRate,
      speedupRatio,
      energySavings: energySavingsTotal,
      baselineLatencyMs,
      speculativeLatencyMs
    };
  }

  /**
   * Calculate speedup for a single round.
   * 
   * Speedup = (draft_tokens / target_time) / (accepted_tokens / target_time)
   *         = draft_tokens / accepted_tokens
   * 
   * But draft is faster, so actual speedup considers draft model speed.
   * Speedup = accepted_tokens / (accepted_tokens * draft_time_ratio + rejected_tokens * 1)
   *         = accepted / (accepted * c + rejected) where c = draft_time / target_time
   */
  calculateSpeedup(draftTokens: number, acceptedTokens: number): number {
    const { draftModelSpeedup } = this.config;
    
    if (acceptedTokens === 0) return 1;
    
    const rejectedTokens = draftTokens - acceptedTokens;
    const draftTimeRatio = draftModelSpeedup;
    
    // Effective speedup considering draft efficiency and acceptance rate
    const speedup = acceptedTokens / (acceptedTokens * draftTimeRatio + rejectedTokens);
    
    return Math.min(speedup, draftTokens); // Cap at max possible speedup
  }

  /**
   * Calculate energy savings from speculative decoding.
   * 
   * Draft models are much smaller, so using them saves energy.
   * Energy_saved = (target_energy - draft_energy) * accepted_tokens / target_energy
   *              = (1 - draft_ratio) * accepted / total
   */
  calculateEnergySavings(draftTokens: number, acceptedTokens: number, draftRatio: number): number {
    if (draftTokens === 0) return 0;
    
    // Draft model uses less energy per token
    // We save energy for accepted tokens, but spend some for rejected ones
    const energyPerDraftToken = draftRatio;
    const energyPerTargetToken = 1;
    
    const draftEnergy = draftTokens * energyPerDraftToken;
    const targetEnergyIfNoSpeculation = draftTokens * energyPerTargetToken;
    
    // Net savings (could be negative if too many rejections)
    const savings = targetEnergyIfNoSpeculation - draftEnergy;
    
    return Math.max(0, savings * (acceptedTokens / draftTokens));
  }

  /**
   * Benchmark speculative decoding against baseline for a workload.
   */
  benchmarkVsBaseline(workload: SpeculativeWorkloadRequest[]): ComparisonResult {
    const baselineMetrics = this.simulateBaseline(workload);
    const speculativeMetrics = this.simulateWithSpeculation(workload);
    
    const totalSpeedup = baselineMetrics.e2eP50 > 0 
      ? speculativeMetrics.e2eP50 / baselineMetrics.e2eP50 
      : 1;
    
    const avgAcceptanceRate = workload.length > 0 
      ? workload.reduce((sum, req) => {
          const result = this.simulate(req);
          return sum + result.acceptanceRate;
        }, 0) / workload.length
      : 0;
    
    const avgEnergySavings = workload.length > 0
      ? workload.reduce((sum, req) => {
          const result = this.simulate(req);
          return sum + result.energySavings;
        }, 0) / workload.length
      : 0;
    
    return {
      baselineMetrics,
      speculativeMetrics,
      speedupRatio: totalSpeedup,
      acceptanceRate: avgAcceptanceRate,
      energySavings: avgEnergySavings,
      improvementTTFT: baselineMetrics.ttftP50 - speculativeMetrics.ttftP50,
      improvementTPOT: baselineMetrics.tpotP50 - speculativeMetrics.tpotP50,
      improvementE2E: baselineMetrics.e2eP50 - speculativeMetrics.e2eP50
    };
  }

  /**
   * Simulate baseline (non-speculative) decoding for a workload.
   */
  private simulateBaseline(workload: PDWorkloadRequest[]): SchedulingMetrics {
    const ttftValues: number[] = [];
    const tpotValues: number[] = [];
    const e2eValues: number[] = [];
    
    for (const request of workload) {
      // TTFT: prefill time
      const ttft = request.prefillTokens * 0.18 + 25;
      
      // TPOT: decode time per token (baseline)
      const tpot = 10; // ms per token
      
      // E2E: ttft + decode time
      const e2e = ttft + request.decodeTokens * tpot;
      
      ttftValues.push(ttft);
      tpotValues.push(tpot);
      e2eValues.push(e2e);
    }
    
    return {
      ttftP50: this.percentile(ttftValues, 50),
      ttftP90: this.percentile(ttftValues, 90),
      ttftP99: this.percentile(ttftValues, 99),
      tpotP50: this.percentile(tpotValues, 50),
      tpotP90: this.percentile(tpotValues, 90),
      tpotP99: this.percentile(tpotValues, 99),
      e2eP50: this.percentile(e2eValues, 50),
      e2eP90: this.percentile(e2eValues, 90),
      e2eP99: this.percentile(e2eValues, 99)
    };
  }

  /**
   * Simulate speculative decoding for a workload.
   */
  private simulateWithSpeculation(workload: SpeculativeWorkloadRequest[]): SchedulingMetrics {
    const ttftValues: number[] = [];
    const tpotValues: number[] = [];
    const e2eValues: number[] = [];
    
    for (const request of workload) {
      const result = this.simulate(request);
      
      // TTFT is same (prefill phase)
      const ttft = request.prefillTokens * 0.18 + 25;
      
      // TPOT improved due to speculation
      const tpot = 10 / result.speedupRatio;
      
      // E2E: ttft + speculative decode time
      const e2e = ttft + result.speculativeLatencyMs;
      
      ttftValues.push(ttft);
      tpotValues.push(tpot);
      e2eValues.push(e2e);
    }
    
    return {
      ttftP50: this.percentile(ttftValues, 50),
      ttftP90: this.percentile(ttftValues, 90),
      ttftP99: this.percentile(ttftValues, 99),
      tpotP50: this.percentile(tpotValues, 50),
      tpotP90: this.percentile(tpotValues, 90),
      tpotP99: this.percentile(tpotValues, 99),
      e2eP50: this.percentile(e2eValues, 50),
      e2eP90: this.percentile(e2eValues, 90),
      e2eP99: this.percentile(e2eValues, 99)
    };
  }

  /**
   * Calculate percentile of a list.
   */
  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}

/**
 * Default speculative decoding simulator instance.
 */
export const speculativeDecodingSimulator = new SpeculativeDecodingSimulator();
