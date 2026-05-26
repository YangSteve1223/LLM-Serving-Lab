/**
 * Abstract Scheduler Interface.
 * 
 * Provides a unified interface for different scheduling policies (Continuous Batching, Radix-based).
 * This enables swapping scheduling strategies without changing consuming code.
 */
import type { PDWorkloadRequest, PDSimulationConfig } from "../ServingTrace.ts";

/**
 * Shared system metrics state type.
 * Combines SystemState from ContextBudgetPlanner and RLStrategySelector.
 */
export interface SystemMetricsState {
  gpuMemoryPressure: number; // 0-1, higher = more pressure
  concurrentRequests: number;
  avgPromptLength: number; // tokens
  cacheHitRate: number; // 0-1
  sloUrgency?: number; // 0-1, higher = more urgent (from ContextBudgetPlanner)
}

export interface SchedulingWorkload {
  requests: PDWorkloadRequest[];
  config: Partial<PDSimulationConfig>;
}

export interface SchedulingMetrics {
  ttftP50: number;
  ttftP90: number;
  ttftP99: number;
  tpotP50: number;
  tpotP90: number;
  tpotP99: number;
  goodput: number;
  throughput: number;
}

export interface SchedulingResult extends SchedulingMetrics {
  policyName: string;
  requestCount: number;
  completedRequests: number;
  droppedRequests: number;
  avgTTFT: number;
  avgTPOT: number;
  avgE2E: number;
  notes: string[];
}

export abstract class AbstractScheduler {
  /**
   * Schedule workload with this scheduler.
   * @param workload - Workload to schedule
   * @returns SchedulingMetrics with performance metrics
   */
  abstract schedule(workload: SchedulingWorkload): SchedulingMetrics;

  /**
   * Run scheduling simulation and get detailed results.
   * @param workload - Workload to schedule
   * @returns SchedulingResult with detailed metrics
   */
  abstract scheduleWithDetails(workload: SchedulingWorkload): SchedulingResult;

  /**
   * Get the name of the scheduling policy.
   */
  abstract getPolicyName(): string;

  /**
   * Get configuration options for this scheduler.
   */
  abstract getConfig(): Record<string, unknown>;
}
