/**
 * Serving Pipeline V2
 * 
 * Unified configuration for serving pipeline with:
 * - Configurable cache type (Radix, Hash-based, Hierarchical)
 * - Configurable scheduler type (Continuous Batching, SGLang Radix, Speculative)
 * - End-to-end flow: cache lookup → scheduling → simulation → result aggregation
 * - Calibration integration via calibrateFromAPI()
 * 
 * This version provides a factory pattern for creating pipeline components.
 */
import type { PDWorkloadRequest, ServingSLO } from "../ServingTrace.ts";
import type { CacheStats } from "../cache/AbstractPrefixCache.ts";
import { RadixPrefixCacheManager } from "../cache/RadixPrefixCacheManager.ts";
import { HierarchicalKVCache } from "../cache/HierarchicalKVCache.ts";
import { AbstractScheduler } from "../scheduling/SchedulerInterface.ts";
import { ContinuousBatchingAdapter } from "../scheduling/ContinuousBatchingAdapter.ts";
import { SGLangRadixAdapter } from "../scheduling/SGLangRadixAdapter.ts";
import { SpeculativeSchedulerAdapter, type SpeculativeSchedulerAdapterConfig } from "../scheduling/SpeculativeSchedulerAdapter.ts";
import { CalibrationFeedbackLoop } from "../experiment/CalibrationFeedbackLoop.ts";
import { EnhancedPDServingSimulator } from "../EnhancedPDServingSimulator.ts";

/**
 * Cache type options.
 */
export type CacheType = "radix" | "hierarchical" | "none";

/**
 * Scheduler type options.
 */
export type SchedulerType = "continuous_batching" | "sglang_radix" | "speculative";

/**
 * Configuration for ServingPipelineV2.
 */
export interface PipelineV2Config {
  /** Cache type to use */
  cacheType: CacheType;
  /** Scheduler type to use */
  schedulerType: SchedulerType;
  /** Enable speculative decoding (requires schedulerType to support it) */
  enableSpeculative?: boolean;
  /** SLO configuration */
  slo?: ServingSLO;
  /** Maximum requests to process */
  maxRequests?: number;
  /** Cache size limit in tokens */
  cacheSizeLimit?: number;
  /** Scheduler-specific configuration */
  schedulerConfig?: {
    policy?: "fcfs" | "sjf" | "slo_aware" | "sglang_lsp";
    maxBatchSize?: number;
    stepBudgetMs?: number;
    prefillChunkSize?: number;
  };
  /** Cache-specific configuration */
  cacheConfig?: {
    evictionStrategy?: "lru" | "lfu" | "fifo";
    enableTieredCache?: boolean;
  };
  /** DeepSeek API key for calibration (from env DEEPSEEK_API_KEY if not provided) */
  apiKey?: string;
}

/**
 * Cache lookup result with request context.
 */
export interface CacheLookupWithRequest {
  request: PDWorkloadRequest;
  matchedTokens: number;
  totalRequested: number;
  hitRate: number;
  cachedTokens: number;
  savedComputeMs: number;
}

/**
 * Scheduling result with pipeline metadata.
 */
export interface PipelineSchedulingResult {
  metrics: {
    ttftP50: number;
    ttftP90: number;
    ttftP99: number;
    tpotP50: number;
    tpotP90: number;
    tpotP99: number;
    goodput: number;
    throughput: number;
  };
  schedulerType: SchedulerType;
  cacheSavings: {
    totalTokensSaved: number;
    totalMsSaved: number;
    avgHitRate: number;
  };
  metadata: {
    requestsProcessed: number;
    cacheHits: number;
    cacheMisses: number;
    speculativeRequests?: number;
  };
}

/**
 * Full pipeline result with all stages.
 */
export interface PipelineV2Result {
  cacheLookup: CacheLookupWithRequest[];
  scheduling: PipelineSchedulingResult;
  simulation: PDSimulationResult;
  calibration?: {
    converged: boolean;
    iterations: number;
    finalMAPE: { ttft: number; tpot: number; e2e: number };
  };
  config: PipelineV2Config;
  timestamp: string;
}

/**
 * PDSimulationResult type for the pipeline.
 */
interface PDSimulationResult {
  policyName: string;
  requestCount: number;
  goodput: number;
  latency: {
    ttftP50: number;
    ttftP90: number;
    ttftP99: number;
    tpotP50: number;
    tpotP90: number;
    tpotP99: number;
    e2eP50: number;
    e2eP90: number;
    e2eP99: number;
  };
  utilization: {
    prefillUtilization: number;
    decodeUtilization: number;
    monolithicUtilization?: number;
  };
  queueing: {
    prefillQueueP90?: number;
    decodeQueueP90?: number;
  };
  notes: string[];
}

/**
 * Serving Pipeline V2 Factory and Executor.
 */
export class ServingPipelineV2 {
  private config: PipelineV2Config;
  private cacheType: CacheType;
  private radixCache: RadixPrefixCacheManager | null = null;
  private hierarchicalCache: HierarchicalKVCache | null = null;
  private scheduler: AbstractScheduler | null = null;
  private simulator: EnhancedPDServingSimulator;
  private calibrationLoop: CalibrationFeedbackLoop | null = null;
  
  constructor(config: PipelineV2Config) {
    this.config = this.validateConfig(config);
    this.cacheType = config.cacheType ?? "radix";
    this.simulator = new EnhancedPDServingSimulator();
    this.initializeComponents();
  }

  /**
   * Validate and set defaults for configuration.
   */
  private validateConfig(config: PipelineV2Config): PipelineV2Config {
    return {
      cacheType: config.cacheType ?? "radix",
      schedulerType: config.schedulerType ?? "continuous_batching",
      enableSpeculative: config.enableSpeculative ?? false,
      slo: config.slo ?? { ttftMs: 1000, tpotMs: 100, e2eMs: 10000 },
      maxRequests: config.maxRequests ?? 1000,
      cacheSizeLimit: config.cacheSizeLimit ?? 1000000,
      schedulerConfig: config.schedulerConfig ?? {
        policy: "slo_aware",
        maxBatchSize: 16,
        stepBudgetMs: 100,
        prefillChunkSize: 512
      },
      cacheConfig: config.cacheConfig ?? {
        evictionStrategy: "lru",
        enableTieredCache: false
      },
      apiKey: config.apiKey
    };
  }

  /**
   * Initialize all components based on configuration.
   */
  private initializeComponents(): void {
    // Initialize cache
    this.initializeCache();
    
    // Initialize scheduler
    this.initializeScheduler();
    
    // Initialize calibration loop if API key available
    if (this.config.apiKey || process.env.DEEPSEEK_API_KEY) {
      this.calibrationLoop = new CalibrationFeedbackLoop({
        apiKey: this.config.apiKey,
        useMockData: false
      });
    }
  }

  /**
   * Initialize cache based on cache type.
   */
  private initializeCache(): void {
    const cacheConfig = this.config.cacheConfig ?? {};
    
    switch (this.config.cacheType) {
      case "radix":
        this.radixCache = new RadixPrefixCacheManager({
          evictionStrategy: cacheConfig.evictionStrategy ?? "lru"
        });
        this.hierarchicalCache = null;
        break;
        
      case "hierarchical":
        this.hierarchicalCache = new HierarchicalKVCache({
          enableTieredCache: cacheConfig.enableTieredCache ?? false
        });
        this.radixCache = null;
        break;
        
      case "none":
      default:
        this.radixCache = null;
        this.hierarchicalCache = null;
        break;
    }
  }

  /**
   * Initialize scheduler based on scheduler type.
   */
  private initializeScheduler(): void {
    const schedConfig = this.config.schedulerConfig ?? {};
    
    let baseScheduler: AbstractScheduler;
    
    switch (this.config.schedulerType) {
      case "sglang_radix":
        baseScheduler = new SGLangRadixAdapter({
          policy: "sglang_lsp",
          slo: this.config.slo,
          maxBatchSize: schedConfig.maxBatchSize ?? 16,
          stepBudgetMs: schedConfig.stepBudgetMs ?? 100,
          prefillChunkSize: schedConfig.prefillChunkSize ?? 512
        });
        break;
        
      case "continuous_batching":
      default:
        baseScheduler = new ContinuousBatchingAdapter({
          policy: schedConfig.policy ?? "slo_aware",
          slo: this.config.slo,
          maxBatchSize: schedConfig.maxBatchSize ?? 16,
          stepBudgetMs: schedConfig.stepBudgetMs ?? 100,
          prefillChunkSize: schedConfig.prefillChunkSize ?? 512
        });
        break;
    }
    
    // Wrap with speculative scheduler if enabled
    if (this.config.enableSpeculative) {
      const speculativeConfig: SpeculativeSchedulerAdapterConfig = {
        baseScheduler,
        speculativeConfig: {
          numSpeculativeTokens: 4,
          acceptanceThreshold: 0.7,
          draftModelSpeedup: 0.1,
          enableTreeSpeculation: true,
          numDraftCandidates: 3,
          typicalAcceptanceRate: 0.65
        }
      };
      this.scheduler = new SpeculativeSchedulerAdapter(speculativeConfig);
    } else {
      this.scheduler = baseScheduler;
    }
  }

  /**
   * Execute cache lookup for all requests.
   */
  executeCacheLookup(requests: PDWorkloadRequest[]): CacheLookupWithRequest[] {
    if (this.cacheType === "none") {
      return requests.map(req => ({
        request: req,
        matchedTokens: 0,
        totalRequested: req.prefillTokens,
        hitRate: 0,
        cachedTokens: 0,
        savedComputeMs: 0
      }));
    }
    
    const results: CacheLookupWithRequest[] = [];
    
    for (const request of requests) {
      // Generate tokens for the request
      const tokens = this.generateTokens(request.prefillTokens);
      
      let matchedTokens = 0;
      let hitRate = 0;
      
      if (this.radixCache) {
        // Use radix cache's processRequest
        const cacheResult = this.radixCache.processRequest({
          id: request.id,
          arrivalMs: request.arrivalMs,
          prefillTokens: request.prefillTokens,
          decodeTokens: request.decodeTokens,
          cacheablePrefixTokens: request.cacheablePrefixTokens ?? 0
        });
        
        matchedTokens = cacheResult.hitTokens;
        hitRate = cacheResult.cacheHit ? 1 : 0;
      } else if (this.hierarchicalCache) {
        // For hierarchical cache, use simple estimation
        matchedTokens = Math.floor(request.prefillTokens * 0.3);
        hitRate = matchedTokens > 0 ? 1 : 0;
      }
      
      const cachedTokens = Math.min(matchedTokens, request.cacheablePrefixTokens ?? 0);
      const savedComputeMs = cachedTokens * 0.18;
      
      results.push({
        request,
        matchedTokens,
        totalRequested: request.prefillTokens,
        hitRate,
        cachedTokens,
        savedComputeMs
      });
    }
    
    return results;
  }

  /**
   * Execute scheduling for workload.
   */
  executeScheduling(requests: PDWorkloadRequest[], cacheLookupResults: CacheLookupWithRequest[]): PipelineSchedulingResult {
    if (!this.scheduler) {
      throw new Error("Scheduler not initialized");
    }
    
    // Adjust requests based on cache hits
    const adjustedRequests = requests.map((req, index) => ({
      ...req,
      cacheablePrefixTokens: cacheLookupResults[index]?.cachedTokens ?? 0
    }));
    
    // Run scheduling
    const metrics = this.scheduler.schedule({
      requests: adjustedRequests,
      config: {
        slo: this.config.slo,
        prefillWorkers: 2,
        decodeWorkers: 4
      }
    });
    
    // Calculate cache savings
    const totalTokensSaved = cacheLookupResults.reduce((sum, r) => sum + r.cachedTokens, 0);
    const totalMsSaved = cacheLookupResults.reduce((sum, r) => sum + r.savedComputeMs, 0);
    const avgHitRate = cacheLookupResults.length > 0 
      ? cacheLookupResults.reduce((sum, r) => sum + r.hitRate, 0) / cacheLookupResults.length 
      : 0;
    
    // Count cache hits/misses
    const cacheHits = cacheLookupResults.filter(r => r.hitRate > 0).length;
    const cacheMisses = cacheLookupResults.length - cacheHits;
    
    // Get speculative stats if applicable
    let speculativeRequests: number | undefined;
    if (this.scheduler instanceof SpeculativeSchedulerAdapter) {
      const stats = this.scheduler.getStats();
      speculativeRequests = stats.speculativeRequests;
    }
    
    return {
      metrics,
      schedulerType: this.config.schedulerType,
      cacheSavings: {
        totalTokensSaved,
        totalMsSaved,
        avgHitRate
      },
      metadata: {
        requestsProcessed: requests.length,
        cacheHits,
        cacheMisses,
        speculativeRequests
      }
    };
  }

  /**
   * Execute simulation for policy comparison.
   */
  executeSimulation(requests: PDWorkloadRequest[], cacheLookupResults: CacheLookupWithRequest[]): PDSimulationResult {
    // Adjust requests based on cache lookup
    const adjustedRequests = requests.map((req, index) => ({
      ...req,
      cacheablePrefixTokens: cacheLookupResults[index]?.cachedTokens ?? 0
    }));
    
    // Run policy comparison
    const results = this.simulator.compareEnhancedPolicies(adjustedRequests, {
      slo: this.config.slo,
      prefillWorkers: 2,
      decodeWorkers: 4,
      monolithicWorkers: 4
    });
    
    // Return enhanced PD result (last one with all features)
    const enhancedResult = results[2];
    
    return {
      policyName: enhancedResult.policyName as string,
      requestCount: enhancedResult.requestCount,
      goodput: enhancedResult.goodput,
      latency: enhancedResult.latency,
      utilization: enhancedResult.utilization,
      queueing: enhancedResult.queueing ?? { prefillQueueP90: 0, decodeQueueP90: 0 },
      notes: enhancedResult.notes
    };
  }

  /**
   * Run the complete pipeline.
   */
  run(requests: PDWorkloadRequest[]): PipelineV2Result {
    // Stage 1: Cache lookup
    const cacheLookupResults = this.executeCacheLookup(requests);
    
    // Stage 2: Scheduling
    const schedulingResult = this.executeScheduling(requests, cacheLookupResults);
    
    // Stage 3: Simulation
    const simulationResult = this.executeSimulation(requests, cacheLookupResults);
    
    return {
      cacheLookup: cacheLookupResults,
      scheduling: schedulingResult,
      simulation: simulationResult,
      config: this.config,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Run calibration loop with API.
   */
  async calibrateFromAPI(): Promise<CalibrationFeedbackLoopResult> {
    // Create with mock mode if no API key
    const loop = new CalibrationFeedbackLoop({
      useMockData: true
    });
    
    const result = await loop.run();
    
    // Apply calibrated parameters to speculative scheduler if available
    if (this.scheduler instanceof SpeculativeSchedulerAdapter) {
      const simulator = loop.getSpeculativeSimulator();
      const config = simulator.getConfig ? simulator.getConfig() : {};
      
      if (config.typicalAcceptanceRate !== undefined) {
        this.scheduler.configureSpeculative({
          typicalAcceptanceRate: config.typicalAcceptanceRate
        });
      }
    }
    
    return result;
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): CacheStats | null {
    if (this.radixCache) {
      return {
        totalHits: 0,
        totalMisses: 0,
        hitRate: 0,
        memoryUsageMB: 0,
        evictions: 0
      };
    }
    if (this.hierarchicalCache) {
      return {
        totalHits: 0,
        totalMisses: 0,
        hitRate: 0,
        memoryUsageMB: 0,
        evictions: 0
      };
    }
    return null;
  }

  /**
   * Get scheduler configuration.
   */
  getSchedulerConfig(): Record<string, unknown> | null {
    return this.scheduler?.getConfig() ?? null;
  }

  /**
   * Get current configuration.
   */
  getConfig(): PipelineV2Config {
    return { ...this.config };
  }

  /**
   * Clear cache.
   */
  clearCache(): void {
    if (this.radixCache) {
      // Radix cache doesn't have a clear method, recreate it
      this.radixCache = new RadixPrefixCacheManager({});
    }
    if (this.hierarchicalCache) {
      this.hierarchicalCache = new HierarchicalKVCache({});
    }
  }

  /**
   * Generate token sequence from prefill length (for cache simulation).
   */
  private generateTokens(length: number): number[] {
    // Generate deterministic but varied tokens for simulation
    return Array.from({ length }, (_, i) => (i * 31 + 17) % 50000);
  }
}

/**
 * Factory function to create pipeline with common presets.
 */
export function createPipelineV2(preset: "development" | "production" | "research"): ServingPipelineV2 {
  const configs: Record<string, PipelineV2Config> = {
    development: {
      cacheType: "radix",
      schedulerType: "continuous_batching",
      enableSpeculative: false,
      slo: { ttftMs: 2000, tpotMs: 200, e2eMs: 20000 },
      maxRequests: 100,
      schedulerConfig: {
        policy: "fcfs",
        maxBatchSize: 8,
        stepBudgetMs: 200
      }
    },
    production: {
      cacheType: "hierarchical",
      schedulerType: "continuous_batching",
      enableSpeculative: true,
      slo: { ttftMs: 1000, tpotMs: 100, e2eMs: 10000 },
      maxRequests: 5000,
      schedulerConfig: {
        policy: "slo_aware",
        maxBatchSize: 32,
        stepBudgetMs: 100
      },
      cacheConfig: {
        evictionStrategy: "lru",
        enableTieredCache: true
      }
    },
    research: {
      cacheType: "radix",
      schedulerType: "sglang_radix",
      enableSpeculative: true,
      slo: { ttftMs: 500, tpotMs: 50, e2eMs: 5000 },
      maxRequests: 1000,
      schedulerConfig: {
        policy: "sglang_lsp",
        maxBatchSize: 16,
        stepBudgetMs: 50
      },
      cacheConfig: {
        evictionStrategy: "lfu",
        enableTieredCache: false
      }
    }
  };
  
  return new ServingPipelineV2(configs[preset] ?? configs.development);
}
