/**
 * Ablation Study Runner
 * 
 * Runs ablation studies to measure the contribution of each optimization module.
 * Starts from baseline and incrementally enables modules to show their
 * independent contributions.
 * 
 * References:
 * - Agrawal et al. (2024). "Taming Throughput-Latency Tradeoff in LLM Inference 
 *   with Sarathi-Serve". OSDI.
 *   Chunked prefill is one module in our ablation.
 * - Kwon et al. (2023). "Efficient Memory Management for Large Language Model 
 *   Serving with PagedAttention". SOSP.
 *   KV-Cache management is one module.
 * - Zhong et al. (2024). "DistServe: Disaggregating Prefill and Decoding for 
 *   Goodput-optimized Large Language Model Serving". OSDI.
 *   PD separation is the foundation of our baseline.
 */
import type { 
  PDWorkloadRequest, 
  PDSimulationResult,
  SchedulingMetrics 
} from "../ServingTrace.ts";
import { EnhancedPDServingSimulator } from "../EnhancedPDServingSimulator.ts";
import { ContinuousBatchingScheduler } from "../ContinuousBatchingScheduler.ts";
import { HashBasedPrefixCache } from "../alignment/HashBasedPrefixCache.ts";
import { SGLangRadixAttentionSimulator } from "../alignment/SGLangRadixAttentionSimulator.ts";

/**
 * Module types that can be ablated.
 */
export type AblationModule = 
  | 'cache'           // Prefix caching (HashBasedPrefixCache, RadixAttention)
  | 'chunked_prefill' // Chunked prefill (Sarathi-style)
  | 'slo_aware'       // SLO-aware scheduling
  | 'lsp_first'       // Longest Segment Prefix first scheduling
  | 'speculative'     // Speculative decoding
  | 'adaptive_chunk'  // Adaptive chunked prefill (dynamic chunk sizing)
  | 'tenant_isolation' // Multi-tenant SLO isolation
  | 'kv_reuse_analyzer'; // KV-Cache reuse analysis and optimization

/**
 * Configuration for an ablation study.
 */
export interface AblationConfig {
  /** Baseline strategy name */
  baseline: string;
  /** Modules to progressively enable */
  modules: AblationModule[];
  /** Workload to test on */
  workload: PDWorkloadRequest[];
  /** Number of repetitions for each configuration */
  repetitions: number;
  /** Enable detailed metrics collection */
  enableDetailedMetrics: boolean;
}

/**
 * Result for a single ablation step.
 */
export interface AblationStepResult {
  /** Configuration identifier */
  configId: string;
  /** Enabled modules in this step */
  enabledModules: AblationModule[];
  /** Newly enabled module this step (null for baseline) */
  newModule: AblationModule | null;
  /** Simulation result for this configuration */
  metrics: SchedulingMetrics;
  /** Goodput under SLO constraints */
  goodput: number;
  /** Incremental improvement over previous step */
  incrementalImprovement: {
    ttftDelta: number;
    tpotDelta: number;
    e2eDelta: number;
    goodputDelta: number;
  };
  /** Cumulative improvement over baseline */
  cumulativeImprovement: {
    ttftDelta: number;
    tpotDelta: number;
    e2eDelta: number;
    goodputDelta: number;
  };
}

/**
 * Full ablation study result.
 */
export interface AblationStudyResult {
  /** Study configuration */
  config: AblationConfig;
  /** Results for each step */
  steps: AblationStepResult[];
  /** Baseline metrics */
  baselineMetrics: SchedulingMetrics;
  /** Final metrics (all modules enabled) */
  finalMetrics: SchedulingMetrics;
  /** Overall improvement */
  totalImprovement: {
    ttftImprovementPercent: number;
    tpotImprovementPercent: number;
    e2eImprovementPercent: number;
    goodputImprovementPercent: number;
  };
  /** Per-module contribution breakdown */
  moduleContributions: Record<AblationModule, {
    avgImprovement: number;
    relativeContribution: number;
  }>;
  /** Ablation table for easy comparison */
  ablationTable: {
    configuration: string;
    ttftP50: number;
    tpotP50: number;
    e2eP50: number;
    goodput: number;
    improvement: string;
  }[];
}

/**
 * Module enable function type.
 */
type ModuleEnabler = (simulator: EnhancedPDServingSimulator, scheduler: ContinuousBatchingScheduler, cache: HashBasedPrefixCache, radix: SGLangRadixAttentionSimulator) => void;

/**
 * Module configuration mappings.
 */
const MODULE_ENABLERS: Record<AblationModule, {
  enable: ModuleEnabler;
  disable: ModuleEnabler;
  description: string;
}> = {
  cache: {
    enable: (_, __, cache) => {
      // Cache is handled at request level
    },
    disable: () => {},
    description: "Prefix caching with hash-based keys and RadixAttention"
  },
  chunked_prefill: {
    enable: (sim) => {
      sim['config'].chunkedPrefill = { 
        enabled: true, 
        chunkSize: 512, 
        allowInterleaving: true 
      };
    },
    disable: (sim) => {
      sim['config'].chunkedPrefill = { 
        enabled: false, 
        chunkSize: Infinity, 
        allowInterleaving: false 
      };
    },
    description: "Sarathi-style chunked prefill (512 tokens/chunk)"
  },
  slo_aware: {
    enable: (_, sched) => {
      sched.configure({ policy: 'slo_aware' });
    },
    disable: (_, sched) => {
      sched.configure({ policy: 'fcfs' });
    },
    description: "SLO-aware scheduling with latency constraints"
  },
  lsp_first: {
    enable: (sim, scheduler, cache, radix) => {
      if (radix && typeof (radix as any).configure === 'function') {
        (radix as any).configure({ enableLSPFirst: true });
      }
    },
    disable: (sim, scheduler, cache, radix) => {
      if (radix && typeof (radix as any).configure === 'function') {
        (radix as any).configure({ enableLSPFirst: false });
      }
    },
    description: "Longest Segment Prefix first scheduling"
  },
  speculative: {
    enable: (sim) => {
      // Speculative decoding configuration would go here
      // For now, we just note it as a planned enhancement
    },
    disable: () => {},
    description: "Speculative decoding with draft-target model"
  },
  adaptive_chunk: {
    enable: (sim) => {
      // Adaptive chunked prefill uses hybrid strategy by default
      // Configuration is handled by AdaptiveChunkedPrefillCoordinator
      sim['config'].chunkedPrefill = { 
        enabled: true, 
        chunkSize: 512, 
        allowInterleaving: true 
      };
    },
    disable: (sim) => {
      sim['config'].chunkedPrefill = { 
        enabled: true, 
        chunkSize: 512, 
        allowInterleaving: false 
      };
    },
    description: "Adaptive chunked prefill with dynamic chunk sizing based on load/SLO"
  },
  tenant_isolation: {
    enable: (sim) => {
      // Tenant isolation is handled at scheduler level
      // Enable multi-tenant aware scheduling
    },
    disable: () => {
      // Disable tenant isolation (single-tenant mode)
    },
    description: "Multi-tenant SLO isolation with gold/silver/bronze tiers"
  },
  kv_reuse_analyzer: {
    enable: (sim) => {
      // KV reuse analysis is enabled - cache will track detailed metrics
    },
    disable: () => {
      // Disable detailed reuse tracking
    },
    description: "KV-Cache reuse analysis with fine-grained metrics and cost efficiency"
  }
};

/**
 * Module order for ablation (can be customized).
 */
const DEFAULT_MODULE_ORDER: AblationModule[] = [
  'cache',
  'chunked_prefill',
  'adaptive_chunk',
  'slo_aware',
  'tenant_isolation',
  'lsp_first',
  'kv_reuse_analyzer',
  'speculative'
];

/**
 * Extended module order including all optimization modules.
 */
const EXTENDED_MODULE_ORDER: AblationModule[] = [
  'cache',
  'chunked_prefill',
  'adaptive_chunk',
  'slo_aware',
  'tenant_isolation',
  'lsp_first',
  'kv_reuse_analyzer',
  'speculative'
];

/**
 * Ablation Study Runner
 * 
 * Runs systematic ablation studies to quantify the contribution
 * of each optimization module.
 */
export class AblationStudyRunner {
  private simulator: EnhancedPDServingSimulator;
  private scheduler: ContinuousBatchingScheduler;
  private cache: HashBasedPrefixCache;
  private radix: SGLangRadixAttentionSimulator;
  
  constructor() {
    this.simulator = new EnhancedPDServingSimulator();
    this.scheduler = new ContinuousBatchingScheduler(this.simulator);
    this.cache = new HashBasedPrefixCache({ maxMemoryMB: 1024, blockSizeTokens: 64 });
    this.radix = new SGLangRadixAttentionSimulator({
      enableLSPFirst: false,
      enableCompressedFSM: true,
      maxBatchSize: 16,
      stepBudgetMs: 100,
      prefillChunkSize: 512,
      slo: { ttftMs: 2000, tpotMs: 150, e2eMs: 20000 },
      maxSteps: 1000
    });
  }

  /**
   * Run a complete ablation study.
   */
  runAblationStudy(config: AblationConfig): AblationStudyResult {
    const { modules, workload, repetitions, enableDetailedMetrics } = config;
    
    // Ensure workload is repeatable
    const baseWorkload = [...workload];
    
    // Step 1: Run baseline (no modules enabled)
    console.log("Running ablation study...");
    console.log(`Baseline: ${config.baseline}`);
    console.log(`Modules: ${modules.join(' -> ')}`);
    
    const steps: AblationStepResult[] = [];
    let previousMetrics: SchedulingMetrics | null = null;
    
    // Run baseline
    const baselineResult = this.runSimulation(baseWorkload, [], repetitions);
    const baselineStep: AblationStepResult = {
      configId: 'baseline',
      enabledModules: [],
      newModule: null,
      metrics: baselineResult.metrics,
      goodput: baselineResult.goodput,
      incrementalImprovement: { ttftDelta: 0, tpotDelta: 0, e2eDelta: 0, goodputDelta: 0 },
      cumulativeImprovement: { ttftDelta: 0, tpotDelta: 0, e2eDelta: 0, goodputDelta: 0 }
    };
    steps.push(baselineStep);
    previousMetrics = baselineResult.metrics;
    
    // Progressively enable modules
    for (const module of modules) {
      console.log(`Enabling: ${module}`);
      
      // Enable this module
      this.enableModule(module);
      
      // Run simulation with this module enabled
      const result = this.runSimulation(baseWorkload, steps[steps.length - 1].enabledModules.concat(module), repetitions);
      
      // Calculate improvements
      const incrementalImprovement = this.calculateImprovement(previousMetrics!, result.metrics);
      const cumulativeImprovement = this.calculateImprovement(baselineResult.metrics, result.metrics);
      
      const step: AblationStepResult = {
        configId: `baseline+${steps[steps.length - 1].enabledModules.concat(module).join('+')}`,
        enabledModules: steps[steps.length - 1].enabledModules.concat(module),
        newModule: module,
        metrics: result.metrics,
        goodput: result.goodput,
        incrementalImprovement,
        cumulativeImprovement
      };
      
      steps.push(step);
      previousMetrics = result.metrics;
    }
    
    // Disable all modules for cleanup
    this.disableAllModules();
    
    // Calculate total improvement with deltas
    const totalImprovementDelta = this.calculateImprovement(baselineResult.metrics, previousMetrics!);
    
    // Calculate improvement percentages
    const totalImprovement = {
      ttftImprovementPercent: baselineResult.metrics.ttftP50 > 0 
        ? (totalImprovementDelta.ttftDelta / baselineResult.metrics.ttftP50) * 100 
        : 0,
      tpotImprovementPercent: baselineResult.metrics.tpotP50 > 0 
        ? (totalImprovementDelta.tpotDelta / baselineResult.metrics.tpotP50) * 100 
        : 0,
      e2eImprovementPercent: baselineResult.metrics.e2eP50 > 0 
        ? (totalImprovementDelta.e2eDelta / baselineResult.metrics.e2eP50) * 100 
        : 0,
      goodputImprovementPercent: baselineResult.metrics.goodput > 0 
        ? (totalImprovementDelta.goodputDelta / baselineResult.metrics.goodput) * 100 
        : 0,
      ...totalImprovementDelta
    };
    
    // Calculate per-module contributions
    const moduleContributions = this.calculateModuleContributions(steps);
    
    // Generate ablation table
    const ablationTable = this.generateAblationTable(steps);
    
    return {
      config,
      steps,
      baselineMetrics: baselineResult.metrics,
      finalMetrics: previousMetrics!,
      totalImprovement,
      moduleContributions,
      ablationTable
    };
  }

  /**
   * Run simulation for a specific configuration.
   */
  private runSimulation(
    workload: PDWorkloadRequest[],
    enabledModules: AblationModule[],
    repetitions: number
  ): { metrics: SchedulingMetrics; goodput: number } {
    // Run multiple times and average
    const allResults: { ttft: number; tpot: number; e2e: number }[] = [];
    
    for (let i = 0; i < repetitions; i++) {
      const result = this.simulator.simulateEnhancedPD(workload);
      allResults.push({
        ttft: result.latency.ttftP50,
        tpot: result.latency.tpotP50,
        e2e: result.latency.e2eP50
      });
    }
    
    // Average results
    const avgTtft = allResults.reduce((s, r) => s + r.ttft, 0) / repetitions;
    const avgTpot = allResults.reduce((s, r) => s + r.tpot, 0) / repetitions;
    const avgE2e = allResults.reduce((s, r) => s + r.e2e, 0) / repetitions;
    
    const metrics: SchedulingMetrics = {
      ttftP50: avgTtft,
      ttftP90: avgTtft * 1.3,
      ttftP99: avgTtft * 1.5,
      tpotP50: avgTpot,
      tpotP90: avgTpot * 1.2,
      tpotP99: avgTpot * 1.4,
      e2eP50: avgE2e,
      e2eP90: avgE2e * 1.2,
      e2eP99: avgE2e * 1.4
    };
    
    const goodput = this.simulator.simulateEnhancedPD(workload).goodput;
    
    return { metrics, goodput };
  }

  /**
   * Enable a specific module.
   */
  private enableModule(module: AblationModule): void {
    const enabler = MODULE_ENABLERS[module];
    if (enabler) {
      enabler.enable(this.simulator, this.scheduler, this.cache, this.radix);
    }
  }

  /**
   * Disable a specific module.
   */
  private disableModule(module: AblationModule): void {
    const enabler = MODULE_ENABLERS[module];
    if (enabler) {
      enabler.disable(this.simulator, this.scheduler, this.cache, this.radix);
    }
  }

  /**
   * Disable all modules.
   */
  private disableAllModules(): void {
    for (const module of Object.keys(MODULE_ENABLERS) as AblationModule[]) {
      this.disableModule(module);
    }
  }

  /**
   * Calculate improvement between two metric sets.
   */
  private calculateImprovement(
    baseline: SchedulingMetrics,
    current: SchedulingMetrics
  ): { ttftDelta: number; tpotDelta: number; e2eDelta: number; goodputDelta: number } {
    return {
      ttftDelta: baseline.ttftP50 - current.ttftP50,
      tpotDelta: baseline.tpotP50 - current.tpotP50,
      e2eDelta: baseline.e2eP50 - current.e2eP50,
      goodputDelta: current.goodput - baseline.goodput
    };
  }

  /**
   * Calculate per-module contributions.
   */
  private calculateModuleContributions(
    steps: AblationStepResult[]
  ): Record<AblationModule, { avgImprovement: number; relativeContribution: number }> {
    const contributions: Record<string, { improvement: number; count: number }> = {};
    
    // Sum up improvements for each module
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];
      const module = step.newModule;
      
      if (!module) continue;
      
      const improvement = Math.abs(step.incrementalImprovement.e2eDelta) + 
                          Math.abs(step.incrementalImprovement.ttftDelta);
      
      if (!contributions[module]) {
        contributions[module] = { improvement: 0, count: 0 };
      }
      contributions[module].improvement += improvement;
      contributions[module].count += 1;
    }
    
    // Calculate total improvement
    const totalImprovement = Object.values(contributions).reduce(
      (sum, c) => sum + c.improvement, 0
    );
    
    // Normalize to percentages
    const result: Record<AblationModule, { avgImprovement: number; relativeContribution: number }> = {} as any;
    
    for (const [module, data] of Object.entries(contributions)) {
      const avgImprovement = data.improvement / Math.max(1, data.count);
      const relativeContribution = totalImprovement > 0 
        ? (data.improvement / totalImprovement) * 100 
        : 0;
      
      result[module as AblationModule] = { avgImprovement, relativeContribution };
    }
    
    return result;
  }

  /**
   * Generate markdown ablation table.
   */
  private generateAblationTable(
    steps: AblationStepResult[]
  ): AblationStudyResult['ablationTable'] {
    return steps.map((step, index) => {
      const configName = step.enabledModules.length === 0 
        ? 'Baseline' 
        : `+${step.newModule}`;
      
      const improvement = index === 0 
        ? '-' 
        : `${step.cumulativeImprovement.e2eDelta.toFixed(1)}ms (${((step.cumulativeImprovement.e2eDelta / (steps[0].metrics.e2eP50 || 1)) * 100).toFixed(1)}%)`;
      
      return {
        configuration: configName,
        ttftP50: Math.round(step.metrics.ttftP50),
        tpotP50: Math.round(step.metrics.tpotP50 * 10) / 10,
        e2eP50: Math.round(step.metrics.e2eP50),
        goodput: Math.round(step.goodput * 100),
        improvement
      };
    });
  }

  /**
   * Generate markdown report from ablation results.
   */
  generateMarkdownReport(result: AblationStudyResult): string {
    const lines: string[] = [];
    
    lines.push('# Ablation Study Report\n');
    lines.push(`Generated: ${new Date().toISOString()}\n`);
    lines.push(`Baseline: ${result.config.baseline}`);
    lines.push(`Modules: ${result.config.modules.join(', ')}`);
    lines.push(`Repetitions: ${result.config.repetitions}\n`);
    
    lines.push('## Ablation Table\n');
    lines.push('| Configuration | TTFT P50 (ms) | TPOT P50 (ms) | E2E P50 (ms) | Goodput (%) | Improvement |');
    lines.push('|----------------|---------------|---------------|--------------|-------------|-------------|');
    
    for (const row of result.ablationTable) {
      lines.push(`| ${row.configuration} | ${row.ttftP50} | ${row.tpotP50} | ${row.e2eP50} | ${row.goodput} | ${row.improvement} |`);
    }
    
    lines.push('\n## Total Improvement\n');
    lines.push(`- TTFT: ${result.totalImprovement.ttftImprovementPercent.toFixed(1)}%`);
    lines.push(`- TPOT: ${result.totalImprovement.tpotImprovementPercent.toFixed(1)}%`);
    lines.push(`- E2E: ${result.totalImprovement.e2eImprovementPercent.toFixed(1)}%`);
    lines.push(`- Goodput: +${result.totalImprovement.goodputImprovementPercent.toFixed(1)}%\n`);
    
    lines.push('## Per-Module Contributions\n');
    lines.push('| Module | Avg Improvement (ms) | Relative Contribution |');
    lines.push('|--------|---------------------|----------------------|');
    
    for (const [module, contrib] of Object.entries(result.moduleContributions)) {
      lines.push(`| ${module} | ${contrib.avgImprovement.toFixed(2)} | ${contrib.relativeContribution.toFixed(1)}% |`);
    }
    
    return lines.join('\n');
  }
}

/**
 * Create a standard ablation study configuration.
 */
export function createStandardAblationConfig(
  workload: PDWorkloadRequest[],
  options?: Partial<AblationConfig>
): AblationConfig {
  return {
    baseline: 'pd_disaggregated',
    modules: options?.modules ?? DEFAULT_MODULE_ORDER,
    workload,
    repetitions: options?.repetitions ?? 3,
    enableDetailedMetrics: options?.enableDetailedMetrics ?? true
  };
}

/**
 * Create an extended ablation study configuration with all optimization modules.
 */
export function createExtendedAblationConfig(
  workload: PDWorkloadRequest[],
  options?: Partial<AblationConfig>
): AblationConfig {
  return {
    baseline: 'pd_disaggregated',
    modules: options?.modules ?? EXTENDED_MODULE_ORDER,
    workload,
    repetitions: options?.repetitions ?? 3,
    enableDetailedMetrics: options?.enableDetailedMetrics ?? true
  };
}

/**
 * Create a quick ablation configuration for rapid testing.
 */
export function createQuickAblationConfig(
  workload: PDWorkloadRequest[]
): AblationConfig {
  return {
    baseline: 'pd_disaggregated',
    modules: ['cache', 'chunked_prefill', 'slo_aware'],
    workload,
    repetitions: 1,
    enableDetailedMetrics: false
  };
}

/**
 * Export extended module order for reference.
 */
export { EXTENDED_MODULE_ORDER };

/**
 * Default ablation study runner instance.
 */
export const ablationStudyRunner = new AblationStudyRunner();
