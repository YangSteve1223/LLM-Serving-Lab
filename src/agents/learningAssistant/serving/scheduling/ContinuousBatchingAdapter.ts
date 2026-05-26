/**
 * Continuous Batching Scheduler Adapter.
 * 
 * Wraps ContinuousBatchingScheduler to implement the AbstractScheduler interface.
 */
import { AbstractScheduler, type SchedulingWorkload, type SchedulingMetrics, type SchedulingResult } from "./SchedulerInterface.ts";
import { ContinuousBatchingScheduler, type ContinuousBatchingPolicy, type SchedulerConfig } from "../ContinuousBatchingScheduler.ts";
import type { PDSimulationConfig } from "../ServingTrace.ts";

export interface ContinuousBatchingAdapterConfig {
  policy?: ContinuousBatchingPolicy;
  maxBatchSize?: number;
  stepBudgetMs?: number;
  prefillChunkSize?: number;
  enableChunkedPrefill?: boolean;
  slo?: { ttftMs: number; tpotMs: number; e2eMs: number };
  maxSteps?: number;
}

/**
 * Adapter wrapping ContinuousBatchingScheduler to AbstractScheduler interface.
 */
export class ContinuousBatchingAdapter extends AbstractScheduler {
  private scheduler: ContinuousBatchingScheduler;
  private config: Required<ContinuousBatchingAdapterConfig>;

  constructor(config: ContinuousBatchingAdapterConfig = {}) {
    super();
    this.config = {
      policy: config.policy ?? "slo_aware",
      maxBatchSize: config.maxBatchSize ?? 16,
      stepBudgetMs: config.stepBudgetMs ?? 100,
      prefillChunkSize: config.prefillChunkSize ?? 512,
      enableChunkedPrefill: config.enableChunkedPrefill ?? true,
      slo: config.slo ?? { ttftMs: 1000, tpotMs: 100, e2eMs: 10000 },
      maxSteps: config.maxSteps ?? 1000
    };
    
    this.scheduler = new ContinuousBatchingScheduler();
    this.scheduler.configure({
      policy: this.config.policy,
      maxBatchSize: this.config.maxBatchSize,
      stepBudgetMs: this.config.stepBudgetMs,
      prefillChunkSize: this.config.prefillChunkSize,
      enableChunkedPrefill: this.config.enableChunkedPrefill,
      slo: this.config.slo,
      maxSteps: this.config.maxSteps
    });
  }

  schedule(workload: SchedulingWorkload): SchedulingMetrics {
    const result = this.scheduler.runScheduling(
      workload.requests,
      this.config.policy,
      workload.config as Partial<SchedulerConfig>
    );
    
    return this.extractMetrics(result);
  }

  scheduleWithDetails(workload: SchedulingWorkload): SchedulingResult {
    const rawResult = this.scheduler.runScheduling(
      workload.requests,
      this.config.policy,
      workload.config as Partial<SchedulerConfig>
    );
    
    // Calculate completed requests based on goodput
    const completedRequests = Math.floor(rawResult.goodput * rawResult.requestCount);
    
    return {
      policyName: this.getPolicyName(),
      requestCount: rawResult.requestCount,
      completedRequests,
      droppedRequests: rawResult.requestCount - completedRequests,
      ttftP50: rawResult.latency.ttftP50,
      ttftP90: rawResult.latency.ttftP90,
      ttftP99: rawResult.latency.ttftP99,
      tpotP50: rawResult.latency.tpotP50,
      tpotP90: rawResult.latency.tpotP90,
      tpotP99: rawResult.latency.tpotP99,
      avgTTFT: rawResult.latency.ttftP50, // Use P50 as average approximation
      avgTPOT: rawResult.latency.tpotP50,
      avgE2E: rawResult.latency.e2eP50,
      goodput: rawResult.goodput,
      throughput: this.extractMetrics(rawResult).throughput,
      notes: rawResult.notes
    };
  }

  getPolicyName(): string {
    return `continuous_batching_${this.config.policy}`;
  }

  getConfig(): Record<string, unknown> {
    return {
      policy: this.config.policy,
      maxBatchSize: this.config.maxBatchSize,
      stepBudgetMs: this.config.stepBudgetMs,
      prefillChunkSize: this.config.prefillChunkSize,
      enableChunkedPrefill: this.config.enableChunkedPrefill,
      slo: this.config.slo,
      maxSteps: this.config.maxSteps
    };
  }

  /**
   * Get the underlying scheduler for advanced operations.
   */
  getScheduler(): ContinuousBatchingScheduler {
    return this.scheduler;
  }

  /**
   * Update scheduler configuration.
   */
  configure(config: Partial<ContinuousBatchingAdapterConfig>): void {
    if (config.policy !== undefined) this.config.policy = config.policy;
    if (config.maxBatchSize !== undefined) this.config.maxBatchSize = config.maxBatchSize;
    if (config.stepBudgetMs !== undefined) this.config.stepBudgetMs = config.stepBudgetMs;
    if (config.prefillChunkSize !== undefined) this.config.prefillChunkSize = config.prefillChunkSize;
    if (config.enableChunkedPrefill !== undefined) this.config.enableChunkedPrefill = config.enableChunkedPrefill;
    if (config.slo !== undefined) this.config.slo = config.slo;
    if (config.maxSteps !== undefined) this.config.maxSteps = config.maxSteps;
    
    this.scheduler.configure({
      policy: this.config.policy,
      maxBatchSize: this.config.maxBatchSize,
      stepBudgetMs: this.config.stepBudgetMs,
      prefillChunkSize: this.config.prefillChunkSize,
      enableChunkedPrefill: this.config.enableChunkedPrefill,
      slo: this.config.slo,
      maxSteps: this.config.maxSteps
    });
  }

  private extractMetrics(result: {
    latency: { ttftP50: number; ttftP90: number; ttftP99: number; tpotP50: number; tpotP90: number; tpotP99: number };
    goodput: number;
    requestCount: number;
    batchStats?: { prefillChunksProcessed: number; decodeStepsExecuted: number };
  }): SchedulingMetrics {
    // Calculate throughput based on completed requests and steps
    const totalSteps = (result.batchStats?.prefillChunksProcessed ?? 0) + (result.batchStats?.decodeStepsExecuted ?? 0);
    const throughput = totalSteps > 0 ? result.requestCount / totalSteps : 0;
    
    return {
      ttftP50: result.latency.ttftP50,
      ttftP90: result.latency.ttftP90,
      ttftP99: result.latency.ttftP99,
      tpotP50: result.latency.tpotP50,
      tpotP90: result.latency.tpotP90,
      tpotP99: result.latency.tpotP99,
      goodput: result.goodput,
      throughput
    };
  }
}
