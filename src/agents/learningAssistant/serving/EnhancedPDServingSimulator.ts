/**
 * Enhanced PD Serving Simulator with advanced cost modeling.
 * 
 * Features:
 * - Hierarchical KV Cache transfer modeling with pipelined layer-by-layer transfer
 * - Chunked prefill scheduling (SARATHI-style)
 * - Heterogeneous resource allocation (compute-heavy vs memory-heavy GPUs)
 * - Model-specific KV cache size estimation (e.g., Llama-70B)
 * - SLO-aware scheduling with budget optimization
 */
import type {
  EnhancedPDConfig,
  GPUConfig,
  NetworkTopology,
  ChunkedPrefillConfig,
  EnhancedPDWorkloadRequest,
  PDWorkloadRequest,
  PDSimulationConfig,
  PDSimulationResult,
  PrefillChunk,
  LayerKVTransferEvent,
  ServingSLO
} from "./ServingTrace.ts";
import { round } from "./utils/MathUtils.ts";
import { SIMULATION_CONSTANTS } from "./constants.ts";
import { generateSyntheticWorkload as createWorkload } from "./workload/ServingWorkloadModel.ts";

// Llama-70B model parameters
const LLAMA_70B_KV_SIZE_PER_TOKEN_PER_LAYER_MB = 0.64; // ~640MB for 80 layers
const LLAMA_70B_NUM_LAYERS = 80;

// Default GPU configurations
const DEFAULT_PREFILL_GPU: GPUConfig = {
  gpuType: "compute_heavy",
  flopsTFLOPS: 1000, // A100/H100 class
  memoryBWGBps: 2039,
  ibBandwidthGBps: 400,
  kvCachePerLayerMB: LLAMA_70B_KV_SIZE_PER_TOKEN_PER_LAYER_MB
};

const DEFAULT_DECODE_GPU: GPUConfig = {
  gpuType: "memory_heavy",
  flopsTFLOPS: 500,
  memoryBWGBps: 3300, // HBM3
  ibBandwidthGBps: 400,
  kvCachePerLayerMB: LLAMA_70B_KV_SIZE_PER_TOKEN_PER_LAYER_MB
};

const DEFAULT_NETWORK: NetworkTopology = {
  prefillToDecodeIBBandwidthGBps: 50, // 50GB/s IB
  numNetworkHops: 1
};

const DEFAULT_CHUNK_CONFIG: ChunkedPrefillConfig = {
  enabled: true,
  chunkSize: 512, // tokens per chunk (SARATHI-style)
  allowInterleaving: true
};

export interface EnhancedSimulatorStats {
  totalPrefillComputeMs: number;
  totalKVTransferMs: number;
  totalDecodeMs: number;
  layerTransferEvents: Map<string, LayerKVTransferEvent[]>;
  chunkDetails: Map<string, PrefillChunk[]>;
  effectiveTTFTBreakdown: {
    prefillCompute: number;
    pipelineOverlap: number;
    lastLayerTransfer: number;
  };
}

export class EnhancedPDServingSimulator {
  private config: Required<EnhancedPDConfig>;
  
  constructor(config: EnhancedPDConfig = {}) {
    this.config = this.mergeConfig(config);
  }

  private mergeConfig(config: EnhancedPDConfig): Required<EnhancedPDConfig> {
    const slo = config.slo ?? { ttftMs: 1000, tpotMs: 100, e2eMs: 10000 };
    const baseConfig = {
      slo,
      prefillWorkers: config.prefillWorkers ?? 2,
      decodeWorkers: config.decodeWorkers ?? 4,
      monolithicWorkers: config.monolithicWorkers ?? 4,
      prefillBaseMs: config.prefillBaseMs ?? SIMULATION_CONSTANTS.BASE_PREFILL_OVERHEAD_MS,
      decodeBaseMs: config.decodeBaseMs ?? SIMULATION_CONSTANTS.BASE_DECODE_OVERHEAD_MS,
      kvBaseMs: config.kvBaseMs ?? 5,
      prefillMsPerToken: config.prefillMsPerToken ?? SIMULATION_CONSTANTS.PREFILL_MS_PER_TOKEN,
      decodeMsPerToken: config.decodeMsPerToken ?? SIMULATION_CONSTANTS.DECODE_MS_PER_TOKEN,
      kvMsPerToken: config.kvMsPerToken ?? 0.015,
      interferencePenalty: config.interferencePenalty ?? 1.18,
      // Enhanced config
      modelName: config.modelName ?? "llama-70b",
      numLayers: config.numLayers ?? LLAMA_70B_NUM_LAYERS,
      kvSizePerTokenMB: config.kvSizePerTokenMB ?? LLAMA_70B_KV_SIZE_PER_TOKEN_PER_LAYER_MB,
      prefillGPU: config.prefillGPU ?? DEFAULT_PREFILL_GPU,
      decodeGPU: config.decodeGPU ?? DEFAULT_DECODE_GPU,
      networkTopology: config.networkTopology ?? DEFAULT_NETWORK,
      chunkedPrefill: config.chunkedPrefill ?? DEFAULT_CHUNK_CONFIG,
      prefillBudgetRatio: config.prefillBudgetRatio ?? 0.4,
      decodeBudgetRatio: config.decodeBudgetRatio ?? 0.6
    };
    return baseConfig;
  }

  /**
   * Calculate KV cache transfer time using hierarchical pipeline model.
   * T_transfer = KV_size × num_layers × seq_len / bandwidth
   * With pipelining: transfer starts after first layer compute completes
   */
  calculateKVTransferTime(prefillTokens: number): {
    totalTransferMs: number;
    lastLayerTransferMs: number;
    effectiveTTFTOverhead: number;
    layerEvents: LayerKVTransferEvent[];
  } {
    const cfg = this.config;
    const kvSizePerToken = cfg.kvSizePerTokenMB * cfg.numLayers; // Total KV per token
    const totalKVSizeMB = kvSizePerToken * prefillTokens;
    const bandwidthGBps = cfg.networkTopology.prefillToDecodeIBBandwidthGBps;
    const numHops = cfg.networkTopology.numNetworkHops;
    
    // Base transfer time
    const baseTransferMs = (totalKVSizeMB / bandwidthGBps) * 1000;
    
    // Hierarchical pipelining: transfer starts after each layer completes
    const layerComputeTimeMs = cfg.prefillBaseMs + prefillTokens * cfg.prefillMsPerToken;
    const layerComputePerLayer = layerComputeTimeMs / cfg.numLayers;
    
    const layerEvents: LayerKVTransferEvent[] = [];
    let cumulativeTransferMs = 0;
    
    for (let layer = 0; layer < cfg.numLayers; layer++) {
      // Transfer starts after layer compute, with pipelining
      const layerStartComputeMs = layer * layerComputePerLayer;
      const transferStartMs = layerStartComputeMs + layerComputePerLayer;
      
      // Transfer time per layer (proportional to tokens)
      const layerKVSizeMB = cfg.kvSizePerTokenMB * prefillTokens;
      const layerTransferMs = (layerKVSizeMB / bandwidthGBps) * 1000 * numHops;
      
      layerEvents.push({
        layer,
        transferStartMs: round(transferStartMs),
        transferEndMs: round(transferStartMs + layerTransferMs),
        transferSizeMB: round(layerKVSizeMB)
      });
      
      cumulativeTransferMs += layerTransferMs;
    }
    
    // Effective TTFT: prefill compute + pipeline overlap + last layer transfer
    const lastLayerTransferMs = layerEvents[layerEvents.length - 1]?.transferEndMs - 
                                 layerEvents[layerEvents.length - 1]?.transferStartMs ?? 0;
    const pipelineOverlap = cumulativeTransferMs - lastLayerTransferMs;
    const effectiveTTFTOverhead = lastLayerTransferMs;
    
    return {
      totalTransferMs: round(cumulativeTransferMs),
      lastLayerTransferMs: round(lastLayerTransferMs),
      effectiveTTFTOverhead: round(effectiveTTFTOverhead),
      layerEvents
    };
  }

  /**
   * Chunk prefill tokens for SARATHI-style scheduling.
   * Breaks long prefill into smaller chunks to eliminate head-of-line blocking.
   */
  chunkPrefill(prefillTokens: number, cacheableTokens: number = 0): PrefillChunk[] {
    const cfg = this.config;
    const chunkSize = cfg.chunkedPrefill.chunkSize;
    const chunks: PrefillChunk[] = [];
    
    const nonCacheableTokens = Math.max(0, prefillTokens - cacheableTokens);
    let tokenOffset = 0;
    let chunkIndex = 0;
    
    // First chunk: cacheable prefix (fast)
    if (cacheableTokens > 0) {
      const computeMs = cfg.prefillBaseMs + cacheableTokens * cfg.prefillMsPerToken * 0.35;
      chunks.push({
        chunkIndex: chunkIndex++,
        startToken: 0,
        endToken: cacheableTokens,
        computeMs: round(computeMs),
        transferMs: 0, // Cache hit, no transfer needed
        completedLayers: cfg.numLayers
      });
      tokenOffset = cacheableTokens;
    }
    
    // Remaining chunks: non-cacheable tokens
    while (tokenOffset < prefillTokens) {
      const remainingTokens = prefillTokens - tokenOffset;
      const chunkTokens = Math.min(chunkSize, remainingTokens);
      
      const computeMs = cfg.prefillBaseMs + chunkTokens * cfg.prefillMsPerToken;
      const transferResult = this.calculateKVTransferTime(chunkTokens);
      
      chunks.push({
        chunkIndex: chunkIndex++,
        startToken: tokenOffset,
        endToken: tokenOffset + chunkTokens,
        computeMs: round(computeMs),
        transferMs: transferResult.lastLayerTransferMs,
        completedLayers: cfg.numLayers
      });
      
      tokenOffset += chunkTokens;
    }
    
    return chunks;
  }

  /**
   * Simulate prefill with chunked scheduling and KV pipelining.
   */
  simulatePrefillWithChunks(request: EnhancedPDWorkloadRequest): {
    totalPrefillMs: number;
    effectiveTTFTMs: number;
    chunks: PrefillChunk[];
    layerTransfers: LayerKVTransferEvent[];
  } {
    const cfg = this.config;
    const chunks = this.chunkPrefill(request.prefillTokens, request.cacheablePrefixTokens ?? 0);
    
    // Calculate total prefill time with pipelining
    let totalPrefillMs = 0;
    let lastChunkEndTime = 0;
    const layerTransfers: LayerKVTransferEvent[] = [];
    
    for (const chunk of chunks) {
      const chunkStartTime = Math.max(lastChunkEndTime, totalPrefillMs);
      const chunkEndTime = chunkStartTime + chunk.computeMs + chunk.transferMs;
      
      if (chunk.transferMs > 0) {
        const transferResult = this.calculateKVTransferTime(chunk.endToken - chunk.startToken);
        transferResult.layerEvents.forEach((event) => {
          layerTransfers.push({
            ...event,
            transferStartMs: event.transferStartMs + chunkStartTime,
            transferEndMs: event.transferEndMs + chunkStartTime
          });
        });
      }
      
      lastChunkEndTime = chunkEndTime;
      totalPrefillMs = Math.max(totalPrefillMs, chunkEndTime);
    }
    
    // Effective TTFT: prefill compute + last chunk's KV transfer
    const lastChunk = chunks[chunks.length - 1];
    const effectiveTTFTMs = lastChunk.computeMs + lastChunk.transferMs;
    
    return {
      totalPrefillMs: round(totalPrefillMs),
      effectiveTTFTMs: round(effectiveTTFTMs),
      chunks,
      layerTransfers
    };
  }

  /**
   * Simulate decode phase with memory-bound GPU characteristics.
   */
  simulateDecode(decodeTokens: number): number {
    const cfg = this.config;
    // Decode is memory-bound, different cost model
    const decodeMs = cfg.decodeBaseMs + decodeTokens * cfg.decodeMsPerToken;
    return round(decodeMs);
  }

  /**
   * Simulate heterogeneous resource allocation.
   * Prefill: compute-bound (high FLOPs, lower memory bandwidth)
   * Decode: memory-bound (lower FLOPs, high memory bandwidth)
   */
  simulateHeterogeneousAllocation(workload: PDWorkloadRequest[]): {
    prefillUtilization: number;
    decodeUtilization: number;
    budgetEfficiency: number;
    unmetDemand: { prefill: number; decode: number };
  } {
    const cfg = this.config;
    
    // Calculate total compute demand
    let totalPrefillDemand = 0;
    let totalDecodeDemand = 0;
    
    for (const req of workload) {
      const prefillMs = cfg.prefillBaseMs + req.prefillTokens * cfg.prefillMsPerToken;
      const decodeMs = cfg.decodeBaseMs + req.decodeTokens * cfg.decodeMsPerToken;
      totalPrefillDemand += prefillMs;
      totalDecodeDemand += decodeMs;
    }
    
    // Calculate available capacity based on budget ratios
    const maxHorizonMs = Math.max(...workload.map(r => r.arrivalMs + 5000));
    const prefillCapacity = maxHorizonMs * cfg.prefillWorkers * cfg.prefillBudgetRatio;
    const decodeCapacity = maxHorizonMs * cfg.decodeWorkers * cfg.decodeBudgetRatio;
    
    // Calculate utilization
    const prefillUtil = totalPrefillDemand / prefillCapacity;
    const decodeUtil = totalDecodeDemand / decodeCapacity;
    
    // Calculate budget efficiency
    const totalBudget = prefillCapacity + decodeCapacity;
    const totalDemand = totalPrefillDemand + totalDecodeDemand;
    const budgetEfficiency = Math.min(1, totalDemand / totalBudget);
    
    // Calculate unmet demand
    const unmetPrefill = Math.max(0, totalPrefillDemand - prefillCapacity);
    const unmetDecode = Math.max(0, totalDecodeDemand - decodeCapacity);
    
    return {
      prefillUtilization: round(Math.min(1, prefillUtil)),
      decodeUtilization: round(Math.min(1, decodeUtil)),
      budgetEfficiency: round(budgetEfficiency),
      unmetDemand: {
        prefill: round(unmetPrefill),
        decode: round(unmetDecode)
      }
    };
  }

  /**
   * Full enhanced PD simulation with all features.
   */
  simulateEnhancedPD(workload: PDWorkloadRequest[], config: PDSimulationConfig = {}): PDSimulationResult {
    const cfg = this.mergeConfig(config);
    const requests = this.sortByArrival(workload);
    
    // Step 1: Simulate prefill with chunks and KV pipelining
    const prefillWorkers = Array.from({ length: cfg.prefillWorkers }, () => 0);
    const decodeWorkers = Array.from({ length: cfg.decodeWorkers }, () => 0);
    
    const runs: Array<{
      ttft: number;
      tpot: number;
      e2e: number;
      prefillQueue: number;
      decodeQueue: number;
      prefillBusy: number;
      decodeBusy: number;
      chunks: PrefillChunk[];
      layerTransfers: LayerKVTransferEvent[];
    }> = [];
    
    const prefillDone: Array<{
      request: PDWorkloadRequest;
      ready: number;
      chunks: PrefillChunk[];
      layerTransfers: LayerKVTransferEvent[];
      prefillMs: number;
    }> = [];
    
    // Process prefill phase
    for (const request of requests) {
      const workerIndex = this.minIndex(prefillWorkers);
      const cacheDiscount = Math.min(
        (request.cacheablePrefixTokens ?? 0) * cfg.prefillMsPerToken * 0.35,
        (cfg.prefillBaseMs + request.prefillTokens * cfg.prefillMsPerToken) * 0.3
      );
      
      const prefillMs = Math.max(
        cfg.prefillBaseMs,
        cfg.prefillBaseMs + request.prefillTokens * cfg.prefillMsPerToken - cacheDiscount
      );
      
      const start = Math.max(request.arrivalMs, prefillWorkers[workerIndex]);
      const done = start + prefillMs;
      prefillWorkers[workerIndex] = done;
      
      // Calculate KV transfer with pipelining
      const kvResult = this.calculateKVTransferTime(request.prefillTokens);
      
      prefillDone.push({
        request,
        ready: done + kvResult.lastLayerTransferMs,
        chunks: this.chunkPrefill(request.prefillTokens, request.cacheablePrefixTokens ?? 0),
        layerTransfers: kvResult.layerEvents,
        prefillMs
      });
    }
    
    // Sort by ready time and priority
    const decodeReady = prefillDone.sort((a, b) => {
      if (a.request.priority !== b.request.priority) {
        return a.request.priority === "interactive" ? -1 : 1;
      }
      // SLO-aware: prioritize requests at risk
      const aRisk = this.calculateSLORisk(a.request, cfg.slo, a.ready - a.request.arrivalMs);
      const bRisk = this.calculateSLORisk(b.request, cfg.slo, b.ready - b.request.arrivalMs);
      return bRisk - aRisk || a.ready - b.ready;
    });
    
    // Process decode phase
    for (const item of decodeReady) {
      const workerIndex = this.minIndex(decodeWorkers);
      const decodeMs = this.simulateDecode(item.request.decodeTokens);
      const start = Math.max(item.ready, decodeWorkers[workerIndex]);
      const done = start + decodeMs;
      decodeWorkers[workerIndex] = done;
      
      runs.push({
        ttft: item.ready - item.request.arrivalMs,
        tpot: item.request.decodeTokens > 0 ? decodeMs / item.request.decodeTokens : 0,
        e2e: done - item.request.arrivalMs,
        prefillQueue: item.prefillMs,
        decodeQueue: start - item.ready,
        prefillBusy: item.prefillMs,
        decodeBusy: decodeMs,
        chunks: item.chunks,
        layerTransfers: item.layerTransfers
      });
    }
    
    // Calculate heterogeneous allocation stats
    const heteroStats = this.simulateHeterogeneousAllocation(workload);
    
    // Calculate goodput under SLO
    const horizon = Math.max(1, ...runs.map((run, index) => workload[index]?.arrivalMs ?? 0), ...runs.map((run) => run.e2e));
    const good = runs.filter((run) => {
      if (cfg.slo.ttftMs && run.ttft > cfg.slo.ttftMs) return false;
      if (cfg.slo.tpotMs && run.tpot > cfg.slo.tpotMs) return false;
      if (cfg.slo.e2eMs && run.e2e > cfg.slo.e2eMs) return false;
      return true;
    });
    const goodput = good.length / workload.length;
    
    // Calculate utilization
    const totalPrefillBusy = runs.reduce((sum, run) => sum + run.prefillBusy, 0);
    const totalDecodeBusy = runs.reduce((sum, run) => sum + run.decodeBusy, 0);
    const prefillUtil = totalPrefillBusy / (cfg.prefillWorkers * horizon);
    const decodeUtil = totalDecodeBusy / (cfg.decodeWorkers * horizon);
    
    return {
      policyName: "pd_disaggregated",
      requestCount: workload.length,
      goodput: round(goodput),
      latency: {
        ttftP50: this.percentile(runs.map(r => r.ttft), 50),
        ttftP90: this.percentile(runs.map(r => r.ttft), 90),
        ttftP99: this.percentile(runs.map(r => r.ttft), 99),
        tpotP50: this.percentile(runs.map(r => r.tpot), 50),
        tpotP90: this.percentile(runs.map(r => r.tpot), 90),
        tpotP99: this.percentile(runs.map(r => r.tpot), 99),
        e2eP50: this.percentile(runs.map(r => r.e2e), 50),
        e2eP90: this.percentile(runs.map(r => r.e2e), 90),
        e2eP99: this.percentile(runs.map(r => r.e2e), 99)
      },
      utilization: {
        prefillUtilization: round(prefillUtil),
        decodeUtilization: round(decodeUtil)
      },
      queueing: {
        prefillQueueP90: this.percentile(runs.map(r => r.prefillQueue), 90),
        decodeQueueP90: this.percentile(runs.map(r => r.decodeQueue), 90)
      },
      notes: [
        `Enhanced PD simulation with KV pipelining (${cfg.numLayers} layers)`,
        `Model: ${cfg.modelName}, KV size: ${cfg.kvSizePerTokenMB}MB/token/layer`,
        `Chunked prefill: ${cfg.chunkedPrefill.enabled ? `enabled (chunk=${cfg.chunkedPrefill.chunkSize})` : 'disabled'}`,
        `Heterogeneous allocation: prefill=${round(cfg.prefillBudgetRatio * 100)}%, decode=${round(cfg.decodeBudgetRatio * 100)}%`,
        `Heterogeneous stats: prefill_util=${round(heteroStats.prefillUtilization)}, decode_util=${round(heteroStats.decodeUtilization)}, efficiency=${round(heteroStats.budgetEfficiency)}`,
        `TTFT includes layer-by-layer KV transfer with pipeline overlap`
      ]
    };
  }

  /**
   * Calculate SLO risk score for a request.
   */
  private calculateSLORisk(request: PDWorkloadRequest, slo: ServingSLO | undefined, currentTTFT: number): number {
    if (!slo?.ttftMs) return 0;
    return currentTTFT / slo.ttftMs;
  }

  /**
   * Compare enhanced PD policies with detailed metrics.
   */
  compareEnhancedPolicies(workload: PDWorkloadRequest[], config: EnhancedPDConfig = {}): PDSimulationResult[] {
    const results: PDSimulationResult[] = [];
    
    // 1. Baseline: Monolithic
    results.push(this.simulateMonolithic(workload, config));
    
    // 2. Basic PD Disaggregated
    results.push(this.simulatePDDisaggregated(workload, config));
    
    // 3. Enhanced PD with all features
    results.push(this.simulateEnhancedPD(workload, config));
    
    return results;
  }

  private simulateMonolithic(workload: PDWorkloadRequest[], config: PDSimulationConfig): PDSimulationResult {
    const cfg = this.mergeConfig(config);
    const workers = Array.from({ length: cfg.monolithicWorkers }, () => 0);
    const runs: Array<{ ttft: number; tpot: number; e2e: number; prefillQueue: number; decodeQueue: number; prefillBusy: number; decodeBusy: number }> = [];
    
    // Monolithic: prefill and decode share resources, causing interference
    // Calculate average interference multiplier for reporting
    let interferenceMultiplierSum = 0;
    
    for (const request of this.sortByArrival(workload)) {
      const workerIndex = this.minIndex(workers);
      // Monolithic interference penalty is higher due to resource sharing
      const interferenceMultiplier = cfg.interferencePenalty * (1 + Math.log10(request.prefillTokens + request.decodeTokens) * 0.05);
      interferenceMultiplierSum += interferenceMultiplier;
      const prefillMs = (cfg.prefillBaseMs + request.prefillTokens * cfg.prefillMsPerToken) * interferenceMultiplier;
      const decodeMs = (cfg.decodeBaseMs + request.decodeTokens * cfg.decodeMsPerToken) * interferenceMultiplier;
      const start = Math.max(request.arrivalMs, workers[workerIndex]);
      const prefillDone = start + prefillMs;
      const done = prefillDone + decodeMs;
      workers[workerIndex] = done;
      
      runs.push({
        ttft: prefillDone - request.arrivalMs,
        tpot: request.decodeTokens > 0 ? decodeMs / request.decodeTokens : 0,
        e2e: done - request.arrivalMs,
        prefillQueue: start - request.arrivalMs,
        decodeQueue: 0,
        prefillBusy: prefillMs,
        decodeBusy: decodeMs
      });
    }
    
    const avgInterferenceMultiplier = workload.length > 0 ? interferenceMultiplierSum / workload.length : cfg.interferencePenalty;
    
    const horizon = Math.max(1, ...runs.map(r => r.e2e));
    const slo = config.slo ?? {};
    const good = runs.filter(run => {
      if (slo.ttftMs && run.ttft > slo.ttftMs) return false;
      if (slo.tpotMs && run.tpot > slo.tpotMs) return false;
      if (slo.e2eMs && run.e2e > slo.e2eMs) return false;
      return true;
    });
    const goodput = good.length / workload.length;
    
    // Calculate utilization for monolithic case
    const totalBusy = runs.reduce((sum, run) => sum + run.prefillBusy + run.decodeBusy, 0);
    const totalCapacity = cfg.monolithicWorkers * horizon;
    const monolithicUtil = totalCapacity > 0 ? totalBusy / totalCapacity : 0;
    
    // For monolithic, both prefill and decode share the same workers
    // Estimate split based on total compute time
    const totalPrefillMs = runs.reduce((sum, run) => sum + run.prefillBusy, 0);
    const totalDecodeMs = runs.reduce((sum, run) => sum + run.decodeBusy, 0);
    const prefillRatio = totalBusy > 0 ? totalPrefillMs / totalBusy : 0.5;
    
    // Estimate effective utilization for each phase
    // (Monolithic doesn't truly separate, but we report implied utilization)
    const impliedPrefillUtil = prefillRatio * monolithicUtil;
    const impliedDecodeUtil = (1 - prefillRatio) * monolithicUtil;
    
    return {
      policyName: "monolithic_shared",
      requestCount: workload.length,
      goodput: round(goodput),
      latency: {
        ttftP50: this.percentile(runs.map(r => r.ttft), 50),
        ttftP90: this.percentile(runs.map(r => r.ttft), 90),
        ttftP99: this.percentile(runs.map(r => r.ttft), 99),
        tpotP50: this.percentile(runs.map(r => r.tpot), 50),
        tpotP90: this.percentile(runs.map(r => r.tpot), 90),
        tpotP99: this.percentile(runs.map(r => r.tpot), 99),
        e2eP50: this.percentile(runs.map(r => r.e2e), 50),
        e2eP90: this.percentile(runs.map(r => r.e2e), 90),
        e2eP99: this.percentile(runs.map(r => r.e2e), 99)
      },
      utilization: {
        prefillUtilization: round(impliedPrefillUtil),
        decodeUtilization: round(impliedDecodeUtil),
        monolithicUtilization: round(monolithicUtil)
      },
      queueing: {
        prefillQueueP90: this.percentile(runs.map(r => r.prefillQueue), 90),
        decodeQueueP90: 0 // Monolithic doesn't have decode queue between phases
      },
      notes: [
        `Baseline: monolithic serving with interference penalty (avg ${round(avgInterferenceMultiplier)}x)`,
        `Implied utilization breakdown: prefill=${round(impliedPrefillUtil * 100)}%, decode=${round(impliedDecodeUtil * 100)}%`,
        `Monolithic constraint: prefill and decode cannot overlap`
      ]
    };
  }

  private simulatePDDisaggregated(workload: PDWorkloadRequest[], config: PDSimulationConfig): PDSimulationResult {
    const cfg = this.mergeConfig(config);
    const prefillWorkers = Array.from({ length: cfg.prefillWorkers }, () => 0);
    const decodeWorkers = Array.from({ length: cfg.decodeWorkers }, () => 0);
    
    const prefillDone = this.sortByArrival(workload).map(request => {
      const workerIndex = this.minIndex(prefillWorkers);
      const cacheDiscount = Math.min(
        (request.cacheablePrefixTokens ?? 0) * cfg.prefillMsPerToken * 0.35,
        (cfg.prefillBaseMs + request.prefillTokens * cfg.prefillMsPerToken) * 0.3
      );
      const prefillMs = Math.max(cfg.prefillBaseMs, cfg.prefillBaseMs + request.prefillTokens * cfg.prefillMsPerToken - cacheDiscount);
      const start = Math.max(request.arrivalMs, prefillWorkers[workerIndex]);
      const done = start + prefillMs;
      prefillWorkers[workerIndex] = done;
      
      const kvMs = cfg.kvBaseMs + request.prefillTokens * cfg.kvMsPerToken;
      
      return { request, ready: done + kvMs, prefillMs };
    });
    
    const runs: Array<{ ttft: number; tpot: number; e2e: number; prefillQueue: number; decodeQueue: number; prefillBusy: number; decodeBusy: number }> = [];
    
    for (const item of prefillDone.sort((a, b) => a.ready - b.ready)) {
      const workerIndex = this.minIndex(decodeWorkers);
      const decodeMs = cfg.decodeBaseMs + item.request.decodeTokens * cfg.decodeMsPerToken;
      const start = Math.max(item.ready, decodeWorkers[workerIndex]);
      const done = start + decodeMs;
      decodeWorkers[workerIndex] = done;
      
      runs.push({
        ttft: item.ready - item.request.arrivalMs,
        tpot: item.request.decodeTokens > 0 ? decodeMs / item.request.decodeTokens : 0,
        e2e: done - item.request.arrivalMs,
        prefillQueue: item.prefillMs,
        decodeQueue: start - item.ready,
        prefillBusy: item.prefillMs,
        decodeBusy: decodeMs
      });
    }
    
    const horizon = Math.max(1, ...runs.map(r => r.e2e));
    const slo = config.slo ?? {};
    const good = runs.filter(run => {
      if (slo.ttftMs && run.ttft > slo.ttftMs) return false;
      if (slo.tpotMs && run.tpot > slo.tpotMs) return false;
      if (slo.e2eMs && run.e2e > slo.e2eMs) return false;
      return true;
    });
    const goodput = good.length / workload.length;
    
    const totalPrefillBusy = runs.reduce((sum, run) => sum + run.prefillBusy, 0);
    const totalDecodeBusy = runs.reduce((sum, run) => sum + run.decodeBusy, 0);
    const prefillUtil = totalPrefillBusy / (cfg.prefillWorkers * horizon);
    const decodeUtil = totalDecodeBusy / (cfg.decodeWorkers * horizon);
    
    return {
      policyName: "pd_disaggregated",
      requestCount: workload.length,
      goodput: round(goodput),
      latency: {
        ttftP50: this.percentile(runs.map(r => r.ttft), 50),
        ttftP90: this.percentile(runs.map(r => r.ttft), 90),
        ttftP99: this.percentile(runs.map(r => r.ttft), 99),
        tpotP50: this.percentile(runs.map(r => r.tpot), 50),
        tpotP90: this.percentile(runs.map(r => r.tpot), 90),
        tpotP99: this.percentile(runs.map(r => r.tpot), 99),
        e2eP50: this.percentile(runs.map(r => r.e2e), 50),
        e2eP90: this.percentile(runs.map(r => r.e2e), 90),
        e2eP99: this.percentile(runs.map(r => r.e2e), 99)
      },
      utilization: {
        prefillUtilization: round(prefillUtil),
        decodeUtilization: round(decodeUtil)
      },
      queueing: {
        prefillQueueP90: this.percentile(runs.map(r => r.prefillQueue), 90),
        decodeQueueP90: this.percentile(runs.map(r => r.decodeQueue), 90)
      },
      notes: ["Basic PD disaggregation without enhanced features"]
    };
  }

  /**
   * Generate synthetic workload for testing.
   */
  generateSyntheticWorkload(requestCount: number, qps: number, config?: { prefillHeavy?: boolean; decodeHeavy?: boolean }): PDWorkloadRequest[] {
    return createWorkload(requestCount, qps, {
      prefillHeavy: config?.prefillHeavy,
      decodeHeavy: config?.decodeHeavy,
      highPriorityRatio: 0.8, // 80% interactive, 20% background (matches original behavior)
      idPrefix: "synthetic"
    });
  }

  /**
   * Get configuration summary for debugging.
   */
  getConfigSummary(): Record<string, unknown> {
    const cfg = this.config;
    return {
      modelName: cfg.modelName,
      numLayers: cfg.numLayers,
      kvSizePerTokenMB: cfg.kvSizePerTokenMB,
      totalKVSizePerTokenMB: cfg.kvSizePerTokenMB * cfg.numLayers,
      prefillWorkers: cfg.prefillWorkers,
      decodeWorkers: cfg.decodeWorkers,
      chunkedPrefill: cfg.chunkedPrefill,
      networkTopology: cfg.networkTopology,
      prefillGPU: cfg.prefillGPU,
      decodeGPU: cfg.decodeGPU,
      budgetRatios: {
        prefill: cfg.prefillBudgetRatio,
        decode: cfg.decodeBudgetRatio
      }
    };
  }

  private sortByArrival(workload: PDWorkloadRequest[]): PDWorkloadRequest[] {
    return [...workload].sort((a, b) => a.arrivalMs - b.arrivalMs);
  }

  private minIndex(arr: number[]): number {
    let minVal = arr[0];
    let minIdx = 0;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] < minVal) {
        minVal = arr[i];
        minIdx = i;
      }
    }
    return minIdx;
  }

  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return round(sorted[Math.max(0, idx)]);
  }
}

export const enhancedPDServingSimulator = new EnhancedPDServingSimulator();
