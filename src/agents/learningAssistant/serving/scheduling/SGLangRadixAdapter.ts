/**
 * SGLang Radix Scheduler Adapter.
 * 
 * Wraps SGLangRadixAttentionSimulator to implement the AbstractScheduler interface.
 * Implements Longest-Shared-Prefix-First (LSP-First) scheduling.
 */
import { AbstractScheduler, type SchedulingWorkload, type SchedulingMetrics, type SchedulingResult } from "./SchedulerInterface.ts";
import { 
  SGLangRadixAttentionSimulator, 
  type RadixAttentionConfig,
  type RadixAttentionResult 
} from "../alignment/SGLangRadixAttentionSimulator.ts";
import type { ServingSLO } from "../ServingTrace.ts";

export type SGLangPolicy = "sglang_lsp" | "sglang_mixed" | "dfs_optimal";

export interface SGLangRadixAdapterConfig {
  policy?: SGLangPolicy;
  enableLSPFirst?: boolean;
  enableCompressedFSM?: boolean;
  maxBatchSize?: number;
  stepBudgetMs?: number;
  prefillChunkSize?: number;
  slo?: ServingSLO;
  maxSteps?: number;
}

/**
 * Adapter wrapping SGLangRadixAttentionSimulator to AbstractScheduler interface.
 */
export class SGLangRadixAdapter extends AbstractScheduler {
  private simulator: SGLangRadixAttentionSimulator;
  private config: Required<SGLangRadixAdapterConfig>;

  constructor(config: SGLangRadixAdapterConfig = {}) {
    super();
    this.config = {
      policy: config.policy ?? "sglang_lsp",
      enableLSPFirst: config.enableLSPFirst ?? true,
      enableCompressedFSM: config.enableCompressedFSM ?? true,
      maxBatchSize: config.maxBatchSize ?? 16,
      stepBudgetMs: config.stepBudgetMs ?? 100,
      prefillChunkSize: config.prefillChunkSize ?? 512,
      slo: config.slo ?? { ttftMs: 1000, tpotMs: 100, e2eMs: 10000 },
      maxSteps: config.maxSteps ?? 1000
    };
    
    const simulatorConfig: Partial<RadixAttentionConfig> = {
      enableLSPFirst: this.config.enableLSPFirst,
      enableCompressedFSM: this.config.enableCompressedFSM,
      maxBatchSize: this.config.maxBatchSize,
      stepBudgetMs: this.config.stepBudgetMs,
      prefillChunkSize: this.config.prefillChunkSize,
      slo: this.config.slo,
      maxSteps: this.config.maxSteps
    };
    
    this.simulator = new SGLangRadixAttentionSimulator(simulatorConfig);
  }

  schedule(workload: SchedulingWorkload): SchedulingMetrics {
    const result = this.simulator.runScheduling(workload.requests, this.config.policy);
    return this.extractMetrics(result);
  }

  scheduleWithDetails(workload: SchedulingWorkload): SchedulingResult {
    const result = this.simulator.runScheduling(workload.requests, this.config.policy);
    
    return {
      policyName: result.policyName,
      requestCount: result.requestCount,
      completedRequests: result.requestCount, // All scheduled requests complete in simulation
      droppedRequests: 0,
      ttftP50: result.latency.ttftP50,
      ttftP90: result.latency.ttftP90,
      ttftP99: result.latency.ttftP99,
      tpotP50: result.latency.tpotP50,
      tpotP90: result.latency.tpotP90,
      tpotP99: result.latency.tpotP99,
      avgTTFT: result.latency.ttftP50,
      avgTPOT: result.latency.tpotP50,
      avgE2E: result.latency.e2eP50,
      goodput: result.goodput,
      throughput: result.throughput,
      notes: result.notes
    };
  }

  getPolicyName(): string {
    return this.config.policy;
  }

  getConfig(): Record<string, unknown> {
    return {
      policy: this.config.policy,
      enableLSPFirst: this.config.enableLSPFirst,
      enableCompressedFSM: this.config.enableCompressedFSM,
      maxBatchSize: this.config.maxBatchSize,
      stepBudgetMs: this.config.stepBudgetMs,
      prefillChunkSize: this.config.prefillChunkSize,
      slo: this.config.slo,
      maxSteps: this.config.maxSteps
    };
  }

  /**
   * Get the underlying simulator for advanced operations.
   */
  getSimulator(): SGLangRadixAttentionSimulator {
    return this.simulator;
  }

  /**
   * Update simulator configuration.
   */
  configure(config: Partial<SGLangRadixAdapterConfig>): void {
    if (config.policy !== undefined) this.config.policy = config.policy;
    if (config.enableLSPFirst !== undefined) this.config.enableLSPFirst = config.enableLSPFirst;
    if (config.enableCompressedFSM !== undefined) this.config.enableCompressedFSM = config.enableCompressedFSM;
    if (config.maxBatchSize !== undefined) this.config.maxBatchSize = config.maxBatchSize;
    if (config.stepBudgetMs !== undefined) this.config.stepBudgetMs = config.stepBudgetMs;
    if (config.prefillChunkSize !== undefined) this.config.prefillChunkSize = config.prefillChunkSize;
    if (config.slo !== undefined) this.config.slo = config.slo;
    if (config.maxSteps !== undefined) this.config.maxSteps = config.maxSteps;
  }

  /**
   * Get cache metrics from the last run.
   */
  getCacheMetrics(): {
    avgCacheHitRatio: number;
    avgSharedPrefixDepth: number;
    prefillTokensSaved: number;
    ttftReductionMs: number;
  } | null {
    // The simulator doesn't expose cache metrics directly after run
    // This would need to be added to the simulator or tracked separately
    return null;
  }

  private extractMetrics(result: RadixAttentionResult): SchedulingMetrics {
    return {
      ttftP50: result.latency.ttftP50,
      ttftP90: result.latency.ttftP90,
      ttftP99: result.latency.ttftP99,
      tpotP50: result.latency.tpotP50,
      tpotP90: result.latency.tpotP90,
      tpotP99: result.latency.tpotP99,
      goodput: result.goodput,
      throughput: result.goodput // Use goodput as throughput approximation
    };
  }
}
