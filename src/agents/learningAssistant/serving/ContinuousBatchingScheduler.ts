/**
 * Continuous Batching Scheduler for LLM serving.
 * 
 * Features:
 * - Iteration-level scheduling (decides at each step whether to prefill or decode)
 * - Dynamic request management (add/remove requests from batch)
 * - SLO-aware scheduling with TTFT/TPOT constraints
 * - Multiple scheduling policies: FCFS, SJF (Shortest Job First), SLO-aware
 * - Integration with EnhancedPDServingSimulator for validation
 */
import type {
  PDWorkloadRequest,
  SchedulingDecision,
  BatchState,
  ContinuousBatchingResult,
  PDSimulationConfig,
  ServingSLO
} from "./ServingTrace.ts";
import { EnhancedPDServingSimulator } from "./EnhancedPDServingSimulator.ts";
import { generateSyntheticWorkload } from "./workload/ServingWorkloadModel.ts";
import { SIMULATION_CONSTANTS } from "./constants.ts";

export type ContinuousBatchingPolicy = "fcfs" | "sjf" | "slo_aware";

export interface SchedulerConfig {
  policy: ContinuousBatchingPolicy;
  maxBatchSize: number;
  stepBudgetMs: number; // Budget per iteration/step in ms
  prefillChunkSize: number;
  enableChunkedPrefill: boolean;
  slo: ServingSLO;
  maxSteps: number;
}

const DEFAULT_SCHEDULER_CONFIG: Required<Omit<SchedulerConfig, "policy">> & { policy: ContinuousBatchingPolicy } = {
  policy: "slo_aware",
  maxBatchSize: 16,
  stepBudgetMs: 100,
  prefillChunkSize: 512,
  enableChunkedPrefill: true,
  slo: { ttftMs: 1000, tpotMs: 100, e2eMs: 10000 },
  maxSteps: 1000
};

interface RequestState {
  request: PDWorkloadRequest;
  prefillProgress: number; // tokens processed
  decodeProgress: number; // tokens generated
  ttftActual: number | null;
  tpotActual: number[];
  arrivalStep: number;
  completionStep: number | null;
  priority: number; // Computed based on policy
  currentChunk: number;
}

export class ContinuousBatchingScheduler {
  private simulator: EnhancedPDServingSimulator;
  private config: Required<SchedulerConfig>;
  
  constructor(simulator?: EnhancedPDServingSimulator) {
    this.simulator = simulator ?? new EnhancedPDServingSimulator();
    this.config = { ...DEFAULT_SCHEDULER_CONFIG } as Required<SchedulerConfig>;
  }
  
  /**
   * Configure scheduler parameters.
   */
  configure(config: Partial<SchedulerConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Run continuous batching simulation with specified policy.
   */
  runScheduling(
    workload: PDWorkloadRequest[],
    policy: ContinuousBatchingPolicy,
    config?: Partial<SchedulerConfig>
  ): ContinuousBatchingResult {
    const cfg = { ...this.config, policy, ...config };
    const decisions: SchedulingDecision[] = [];
    const requestStates = this.initRequestStates(workload);
    
    let step = 0;
    let usedBudgetMs = 0;
    const totalBudgetMs = cfg.maxSteps * cfg.stepBudgetMs;
    
    const batchStats = {
      prefillChunksProcessed: 0,
      decodeStepsExecuted: 0,
      batchSizes: [] as number[]
    };
    
    // Main scheduling loop
    while (step < cfg.maxSteps && !this.allRequestsComplete(requestStates)) {
      // Update priorities based on policy
      this.updatePriorities(requestStates, cfg);
      
      // Get current batch state
      const batch = this.getCurrentBatch(requestStates, cfg);
      const activeRequests = batch.filter(id => requestStates.has(id));
      
      if (activeRequests.length === 0) {
        // No active requests, advance time
        decisions.push({
          type: "idle",
          requestId: "",
          timestampMs: step * cfg.stepBudgetMs,
          remainingBudget: cfg.stepBudgetMs
        });
        step++;
        continue;
      }
      
      // Decide what to do this step
      const decision = this.makeSchedulingDecision(
        requestStates,
        activeRequests,
        cfg,
        step
      );
      
      if (decision) {
        decisions.push(decision);
        usedBudgetMs += cfg.stepBudgetMs;
        
        if (decision.type === "prefill_chunk") {
          batchStats.prefillChunksProcessed++;
        } else if (decision.type === "decode_step") {
          batchStats.decodeStepsExecuted++;
        }
        
        // Update request states based on decision
        this.applyDecision(requestStates, decision, cfg);
      }
      
      batchStats.batchSizes.push(activeRequests.length);
      step++;
    }
    
    // Calculate final metrics
    const completedRequests = Array.from(requestStates.values())
      .filter(s => s.completionStep !== null);
    
    const ttftValues = completedRequests
      .filter(s => s.ttftActual !== null)
      .map(s => s.ttftActual!);
    
    const tpotValues = completedRequests
      .flatMap(s => s.tpotActual);
    
    const e2eValues = completedRequests
      .filter(s => s.completionStep !== null)
      .map(s => (s.completionStep! - s.arrivalStep) * cfg.stepBudgetMs);
    
    // Calculate goodput under SLO
    const good = completedRequests.filter(r => {
      if (cfg.slo.ttftMs && r.ttftActual && r.ttftActual > cfg.slo.ttftMs) return false;
      if (cfg.slo.tpotMs && r.tpotActual.length > 0 && Math.max(...r.tpotActual) > cfg.slo.tpotMs) return false;
      if (cfg.slo.e2eMs && r.completionStep !== null) {
        const e2e = (r.completionStep - r.arrivalStep) * cfg.stepBudgetMs;
        if (e2e > cfg.slo.e2eMs) return false;
      }
      return true;
    });
    
    const avgBatchSize = batchStats.batchSizes.length > 0
      ? batchStats.batchSizes.reduce((a, b) => a + b, 0) / batchStats.batchSizes.length
      : 0;
    
    return {
      policyName: policy,
      requestCount: workload.length,
      goodput: workload.length > 0 ? good.length / workload.length : 0,
      latency: {
        ttftP50: this.percentile(ttftValues, 50),
        ttftP90: this.percentile(ttftValues, 90),
        ttftP99: this.percentile(ttftValues, 99),
        tpotP50: this.percentile(tpotValues, 50),
        tpotP90: this.percentile(tpotValues, 90),
        tpotP99: this.percentile(tpotValues, 99),
        e2eP50: this.percentile(e2eValues, 50),
        e2eP90: this.percentile(e2eValues, 90),
        e2eP99: this.percentile(e2eValues, 99)
      },
      schedulingDecisions: decisions,
      batchStats: {
        avgBatchSize: Math.round(avgBatchSize * 100) / 100,
        maxBatchSize: Math.max(0, ...batchStats.batchSizes),
        prefillChunksProcessed: batchStats.prefillChunksProcessed,
        decodeStepsExecuted: batchStats.decodeStepsExecuted
      },
      notes: [
        `Policy: ${policy}`,
        `Max batch size: ${cfg.maxBatchSize}`,
        `Step budget: ${cfg.stepBudgetMs}ms`,
        `Prefill chunk size: ${cfg.prefillChunkSize}`,
        `Chunked prefill: ${cfg.enableChunkedPrefill ? 'enabled' : 'disabled'}`,
        `Total steps: ${step}`,
        `Avg batch size: ${avgBatchSize.toFixed(1)}`
      ]
    };
  }
  
  /**
   * Compare all scheduling policies.
   */
  comparePolicies(
    workload: PDWorkloadRequest[],
    config?: Partial<SchedulerConfig>
  ): ContinuousBatchingResult[] {
    return [
      this.runScheduling(workload, "fcfs", config),
      this.runScheduling(workload, "sjf", config),
      this.runScheduling(workload, "slo_aware", config)
    ];
  }
  
  /**
   * Initialize request states from workload.
   */
  private initRequestStates(workload: PDWorkloadRequest[]): Map<string, RequestState> {
    const states = new Map<string, RequestState>();
    const stepInterval = this.config.stepBudgetMs;
    
    for (const request of workload) {
      const arrivalStep = Math.floor(request.arrivalMs / stepInterval);
      states.set(request.id, {
        request,
        prefillProgress: 0,
        decodeProgress: 0,
        ttftActual: null,
        tpotActual: [],
        arrivalStep,
        completionStep: null,
        priority: 0,
        currentChunk: 0
      });
    }
    
    return states;
  }
  
  /**
   * Update priorities based on scheduling policy.
   */
  private updatePriorities(
    states: Map<string, RequestState>,
    config: Required<SchedulerConfig>
  ): void {
    const now = Date.now(); // Use step as proxy
    
    for (const [id, state] of states) {
      if (state.completionStep !== null) {
        state.priority = Infinity; // Completed, won't be scheduled
        continue;
      }
      
      const remainingPrefill = state.request.prefillTokens - state.prefillProgress;
      const remainingDecode = state.request.decodeTokens - state.decodeProgress;
      
      switch (config.policy) {
        case "fcfs":
          // First come, first served - arrival time is priority
          state.priority = state.arrivalStep;
          break;
          
        case "sjf":
          // Shortest job first - total remaining work
          state.priority = remainingPrefill + remainingDecode;
          break;
          
        case "slo_aware":
          // SLO-aware: prioritize requests at risk
          const arrivalTime = state.arrivalStep * config.stepBudgetMs;
          const waitingTime = now - arrivalTime;
          
          let sloRisk = 0;
          
          // TTFT risk (waiting for prefill to complete)
          if (remainingPrefill > 0) {
            const estimatedTTFT = remainingPrefill * SIMULATION_CONSTANTS.PREFILL_MS_PER_TOKEN + SIMULATION_CONSTANTS.BASE_PREFILL_OVERHEAD_MS; // Simplified estimate
            const risk = (waitingTime + estimatedTTFT) / (config.slo.ttftMs ?? 1000);
            sloRisk = Math.max(sloRisk, risk);
          }
          
          // TPOT risk (decode performance)
          if (remainingDecode > 0) {
            const estimatedTPOT = SIMULATION_CONSTANTS.DECODE_MS_PER_TOKEN; // Simplified
            const risk = estimatedTPOT / (config.slo.tpotMs ?? 100);
            sloRisk = Math.max(sloRisk, risk);
          }
          
          // E2E risk
          const estimatedE2E = remainingPrefill * SIMULATION_CONSTANTS.PREFILL_MS_PER_TOKEN + remainingDecode * SIMULATION_CONSTANTS.DECODE_MS_PER_TOKEN;
          const risk = (waitingTime + estimatedE2E) / (config.slo.e2eMs ?? 10000);
          sloRisk = Math.max(sloRisk, risk);
          
          // Combine with FCFS as tiebreaker
          state.priority = -sloRisk + state.arrivalStep * 0.001;
          break;
      }
    }
  }
  
  /**
   * Get current batch of request IDs to process.
   */
  private getCurrentBatch(
    states: Map<string, RequestState>,
    config: Required<SchedulerConfig>
  ): string[] {
    const activeRequests: Array<{ id: string; priority: number }> = [];
    
    for (const [id, state] of states) {
      if (state.completionStep === null && state.priority !== Infinity) {
        activeRequests.push({ id, priority: state.priority });
      }
    }
    
    // Sort by priority (lower is higher priority)
    activeRequests.sort((a, b) => a.priority - b.priority);
    
    // Return top N requests up to max batch size
    return activeRequests
      .slice(0, config.maxBatchSize)
      .map(r => r.id);
  }
  
  /**
   * Make scheduling decision for the current step.
   */
  private makeSchedulingDecision(
    states: Map<string, RequestState>,
    batch: string[],
    config: Required<SchedulerConfig>,
    step: number
  ): SchedulingDecision | null {
    if (batch.length === 0) return null;
    
    // Check which requests need prefill vs decode
    const needsPrefill = batch.filter(id => {
      const state = states.get(id)!;
      return state.prefillProgress < state.request.prefillTokens;
    });
    
    const needsDecode = batch.filter(id => {
      const state = states.get(id)!;
      return state.prefillProgress >= state.request.prefillTokens &&
             state.decodeProgress < state.request.decodeTokens;
    });
    
    const requestId = batch[0]; // Use highest priority request
    const state = states.get(requestId)!;
    
    if (config.enableChunkedPrefill && needsPrefill.length > 0) {
      // Use chunked prefill
      const chunkSize = Math.min(
        config.prefillChunkSize,
        state.request.prefillTokens - state.prefillProgress
      );
      
      return {
        type: "prefill_chunk",
        requestId,
        chunkIndex: state.currentChunk,
        tokensProcessed: chunkSize,
        timestampMs: step * config.stepBudgetMs,
        remainingBudget: config.stepBudgetMs
      };
    } else if (needsDecode.length > 0) {
      // Execute decode step
      return {
        type: "decode_step",
        requestId: needsDecode[0],
        tokensProcessed: 1,
        timestampMs: step * config.stepBudgetMs,
        remainingBudget: config.stepBudgetMs
      };
    } else if (needsPrefill.length > 0) {
      // Regular prefill (no chunking)
      return {
        type: "prefill_chunk",
        requestId: needsPrefill[0],
        chunkIndex: 0,
        tokensProcessed: state.request.prefillTokens - state.prefillProgress,
        timestampMs: step * config.stepBudgetMs,
        remainingBudget: config.stepBudgetMs
      };
    }
    
    return null;
  }
  
  /**
   * Apply scheduling decision to request states.
   */
  private applyDecision(
    states: Map<string, RequestState>,
    decision: SchedulingDecision,
    config: Required<SchedulerConfig>
  ): void {
    const state = states.get(decision.requestId);
    if (!state) return;
    
    if (decision.type === "prefill_chunk" && decision.tokensProcessed) {
      const wasPrefilling = state.prefillProgress < state.request.prefillTokens;
      state.prefillProgress += decision.tokensProcessed;
      state.currentChunk++;
      
      // Check if prefill completed (TTFT reached)
      if (wasPrefilling && state.prefillProgress >= state.request.prefillTokens) {
        state.ttftActual = decision.timestampMs - state.arrivalStep * config.stepBudgetMs;
      }
    } else if (decision.type === "decode_step") {
      state.decodeProgress += 1;
      state.tpotActual.push(config.stepBudgetMs);
      
      // Check if request completed
      if (state.decodeProgress >= state.request.decodeTokens) {
        state.completionStep = Math.floor(decision.timestampMs / config.stepBudgetMs);
      }
    }
  }
  
  /**
   * Check if all requests are complete.
   */
  private allRequestsComplete(states: Map<string, RequestState>): boolean {
    for (const state of states.values()) {
      if (state.completionStep === null) return false;
    }
    return true;
  }
  
  /**
   * Calculate percentile.
   */
  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return Math.round(sorted[Math.max(0, idx)] * 100) / 100;
  }
  
  /**
   * Generate synthetic workload for continuous batching testing.
   */
  generateWorkload(
    requestCount: number,
    qps: number,
    options?: {
      prefillHeavy?: boolean;
      decodeHeavy?: boolean;
      highPriority?: number;
    }
  ): PDWorkloadRequest[] {
    return generateSyntheticWorkload(requestCount, qps, {
      prefillHeavy: options?.prefillHeavy,
      decodeHeavy: options?.decodeHeavy,
      highPriorityRatio: options?.highPriority ?? 0.3,
      idPrefix: "cb-req"
    });
  }
  
  /**
   * Integrate with EnhancedPDSimulator for validation.
   */
  validateWithSimulator(workload: PDWorkloadRequest[]): {
    continuousBatching: ContinuousBatchingResult;
    pdSimulator: ReturnType<EnhancedPDServingSimulator["simulateEnhancedPD"]>;
    comparison: {
      goodputDifference: number;
      ttftP50Difference: number;
      tpotP50Difference: number;
    };
  } {
    const cbResult = this.runScheduling(workload, "slo_aware");
    const pdResult = this.simulator.simulateEnhancedPD(workload);
    
    return {
      continuousBatching: cbResult,
      pdSimulator: pdResult,
      comparison: {
        goodputDifference: Math.round((cbResult.goodput - pdResult.goodput) * 1000) / 10,
        ttftP50Difference: Math.round((cbResult.latency.ttftP50 - pdResult.latency.ttftP50) * 100) / 100,
        tpotP50Difference: Math.round((cbResult.latency.tpotP50 - pdResult.latency.tpotP50) * 100) / 100
      }
    };
  }
}

export const continuousBatchingScheduler = new ContinuousBatchingScheduler();
