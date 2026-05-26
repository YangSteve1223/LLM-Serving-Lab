/**
 * Predefined Experiment Configurations
 * 
 * Provides standardized experiment configurations for common research scenarios:
 * 1. E2E Latency Benchmark - Compare monolithic vs PD separation
 * 2. Cache Scaling Study - Performance under different cache capacities
 * 3. Scheduler Comparison - FCFS vs SJF vs SLO-aware
 * 4. Speculative Decoding Ablation - Different acceptance rates
 * 5. Multi-tenant SLO Isolation - Gold/silver/bronze tier isolation
 * 6. KV Reuse Analysis - Different prefix overlap scenarios
 * 
 * References:
 * - Agrawal et al. (2024). "Taming Throughput-Latency Tradeoff in LLM Inference 
 *   with Sarathi-Serve". OSDI.
 * - Kwon et al. (2023). "Efficient Memory Management for Large Language Model 
 *   Serving with PagedAttention". SOSP.
 * - Zhong et al. (2024). "DistServe: Disaggregating Prefill and Decoding for 
 *   Goodput-optimized Large Language Model Serving". OSDI.
 */
import type { ExperimentConfig } from "./ExperimentConfig.ts";

/**
 * Predefined experiment identifiers.
 */
export type PredefinedExperimentId =
  | 'e2e_latency_benchmark'
  | 'cache_scaling_study'
  | 'scheduler_comparison'
  | 'speculative_ablation'
  | 'tenant_isolation'
  | 'kv_reuse_analysis';

/**
 * Metadata for predefined experiments.
 */
export interface PredefinedExperimentMetadata {
  id: PredefinedExperimentId;
  name: string;
  description: string;
  category: 'performance' | 'optimization' | 'isolation' | 'ablation';
  expectedDuration: string;
  keyMetrics: string[];
}

/**
 * Predefined experiments metadata registry.
 */
export const PREDEFINED_EXPERIMENTS: Record<PredefinedExperimentId, PredefinedExperimentMetadata> = {
  e2e_latency_benchmark: {
    id: 'e2e_latency_benchmark',
    name: 'End-to-End Latency Benchmark',
    description: 'Compare monolithic vs PD-separated vs hybrid architectures for latency performance',
    category: 'performance',
    expectedDuration: '5 min',
    keyMetrics: ['TTFT', 'TPOT', 'E2E Latency', 'Goodput']
  },
  cache_scaling_study: {
    id: 'cache_scaling_study',
    name: 'Cache Capacity Scaling Study',
    description: 'Analyze performance scaling with different KV cache capacities',
    category: 'optimization',
    expectedDuration: '15 min',
    keyMetrics: ['Cache Hit Rate', 'TTFT', 'Memory Utilization']
  },
  scheduler_comparison: {
    id: 'scheduler_comparison',
    name: 'Scheduler Policy Comparison',
    description: 'Compare FCFS, SJF, and SLO-aware scheduling policies',
    category: 'performance',
    expectedDuration: '10 min',
    keyMetrics: ['P50/P90/P99 Latency', 'Goodput', 'SLO Compliance']
  },
  speculative_ablation: {
    id: 'speculative_ablation',
    name: 'Speculative Decoding Ablation',
    description: 'Analyze impact of different acceptance rates on speculative decoding',
    category: 'ablation',
    expectedDuration: '12 min',
    keyMetrics: ['Speedup', 'Token Acceptance Rate', 'Decode Efficiency']
  },
  tenant_isolation: {
    id: 'tenant_isolation',
    name: 'Multi-tenant SLO Isolation',
    description: 'Evaluate isolation guarantees for gold/silver/bronze tenant tiers',
    category: 'isolation',
    expectedDuration: '8 min',
    keyMetrics: ['SLO Violation Rate', 'Fairness Index', 'Throughput']
  },
  kv_reuse_analysis: {
    id: 'kv_reuse_analysis',
    name: 'KV Cache Reuse Analysis',
    description: 'Analyze cache efficiency under different prefix overlap patterns',
    category: 'optimization',
    expectedDuration: '20 min',
    keyMetrics: ['Cache Hit Rate', 'TTFT Reduction', 'Memory Efficiency']
  }
};

/**
 * Generate E2E Latency Benchmark configuration.
 * Compares monolithic vs PD-separated vs hybrid architectures.
 */
export function createE2ELatencyBenchmarkConfig(seed: number = 42): ExperimentConfig[] {
  return [
    // Monolithic baseline
    {
      id: 'e2e_monolithic_baseline',
      name: 'Monolithic Architecture Baseline',
      description: 'Traditional colocation serving as baseline',
      createdAt: new Date().toISOString(),
      seed: seed,
      workload: {
        requestCount: 100,
        tokenDistribution: 'realistic',
        avgPromptTokens: 1024,
        avgCompletionTokens: 256,
        qps: 10,
        duration: '60s',
        variance: 0.3
      },
      simulator: {
        architecture: 'monolithic',
        prefillGpu: { gpuType: 'balanced', numGpus: 8 },
        decodeGpu: { gpuType: 'balanced', numGpus: 8 }
      },
      cache: { type: 'none', capacityMB: 0 },
      scheduler: { type: 'fcfs' },
      statistical: {
        repetitions: 10,
        warmupIterations: 5,
        confidenceLevel: 0.95,
        significanceThreshold: 0.05
      }
    },
    // PD Separated
    {
      id: 'e2e_pd_separated',
      name: 'PD-Separated Architecture',
      description: 'Disaggregated prefill and decode stages',
      createdAt: new Date().toISOString(),
      seed: seed + 1,
      workload: {
        requestCount: 100,
        tokenDistribution: 'realistic',
        avgPromptTokens: 1024,
        avgCompletionTokens: 256,
        qps: 10,
        duration: '60s',
        variance: 0.3
      },
      simulator: {
        architecture: 'pd_separated',
        prefillGpu: { gpuType: 'compute_heavy', numGpus: 2 },
        decodeGpu: { gpuType: 'memory_heavy', numGpus: 4 },
        kvTransferMs: 5
      },
      cache: { type: 'none', capacityMB: 0 },
      scheduler: { type: 'fcfs' },
      statistical: {
        repetitions: 10,
        warmupIterations: 5,
        confidenceLevel: 0.95,
        significanceThreshold: 0.05
      }
    },
    // PD Separated with Radix Cache
    {
      id: 'e2e_pd_with_cache',
      name: 'PD-Separated with Radix Cache',
      description: 'PD separation with prefix caching',
      createdAt: new Date().toISOString(),
      seed: seed + 2,
      workload: {
        requestCount: 100,
        tokenDistribution: 'realistic',
        avgPromptTokens: 1024,
        avgCompletionTokens: 256,
        qps: 10,
        duration: '60s',
        variance: 0.3
      },
      simulator: {
        architecture: 'pd_separated',
        prefillGpu: { gpuType: 'compute_heavy', numGpus: 2 },
        decodeGpu: { gpuType: 'memory_heavy', numGpus: 4 },
        kvTransferMs: 3
      },
      cache: {
        type: 'radix',
        capacityMB: 2048,
        blockSizeTokens: 64,
        evictionPolicy: 'lru',
        enableCompression: true
      },
      scheduler: { type: 'fcfs' },
      statistical: {
        repetitions: 10,
        warmupIterations: 5,
        confidenceLevel: 0.95,
        significanceThreshold: 0.05
      }
    },
    // Hybrid Architecture
    {
      id: 'e2e_hybrid',
      name: 'Hybrid Architecture',
      description: 'Colocation for short requests, PD separation for long',
      createdAt: new Date().toISOString(),
      seed: seed + 3,
      workload: {
        requestCount: 100,
        tokenDistribution: 'realistic',
        avgPromptTokens: 1024,
        avgCompletionTokens: 256,
        qps: 10,
        duration: '60s',
        variance: 0.3
      },
      simulator: {
        architecture: 'hybrid',
        prefillGpu: { gpuType: 'compute_heavy', numGpus: 2 },
        decodeGpu: { gpuType: 'memory_heavy', numGpus: 4 }
      },
      cache: { type: 'radix', capacityMB: 2048, blockSizeTokens: 64, evictionPolicy: 'lru' },
      scheduler: { type: 'slo_aware', sloTargetMs: 2000, slo: { ttftMs: 2000, tpotMs: 150, e2eMs: 20000 } },
      statistical: {
        repetitions: 10,
        warmupIterations: 5,
        confidenceLevel: 0.95,
        significanceThreshold: 0.05
      },
      enableChunkedPrefill: true,
      chunkSize: 512,
      enableLSPFirst: true
    }
  ];
}

/**
 * Generate Cache Scaling Study configurations.
 * Tests different cache capacities to find optimal size.
 */
export function createCacheScalingStudyConfig(seed: number = 42): ExperimentConfig[] {
  const capacities = [256, 512, 1024, 2048, 4096];
  
  return capacities.map((capacity, idx) => ({
    id: `cache_scaling_${capacity}mb`,
    name: `Cache Scaling - ${capacity}MB`,
    description: `KV cache capacity of ${capacity}MB`,
    createdAt: new Date().toISOString(),
    seed: seed + idx,
    workload: {
      requestCount: 100,
      tokenDistribution: 'realistic',
      avgPromptTokens: 1024,
      avgCompletionTokens: 256,
      qps: 10,
      duration: '60s',
      variance: 0.3
    },
    simulator: {
      architecture: 'pd_separated',
      prefillGpu: { gpuType: 'compute_heavy', numGpus: 2 },
      decodeGpu: { gpuType: 'memory_heavy', numGpus: 4 },
      kvTransferMs: 3
    },
    cache: {
      type: idx === 0 ? 'none' : 'radix',
      capacityMB: capacity,
      blockSizeTokens: 64,
      evictionPolicy: 'lru'
    },
    scheduler: { type: 'slo_aware', sloTargetMs: 2000, slo: { ttftMs: 2000, tpotMs: 150, e2eMs: 20000 } },
    statistical: {
      repetitions: 10,
      warmupIterations: 5,
      confidenceLevel: 0.95,
      significanceThreshold: 0.05
    },
    enableChunkedPrefill: true,
    chunkSize: 512
  }));
}

/**
 * Generate Scheduler Comparison configurations.
 * Compares FCFS, SJF, and SLO-aware schedulers.
 */
export function createSchedulerComparisonConfig(seed: number = 42): ExperimentConfig[] {
  const schedulerTypes: Array<{ type: 'fcfs' | 'sjf' | 'slo_aware', name: string }> = [
    { type: 'fcfs', name: 'FCFS' },
    { type: 'sjf', name: 'SJF' },
    { type: 'slo_aware', name: 'SLO-aware' }
  ];

  return schedulerTypes.map((sched, idx) => ({
    id: `scheduler_${sched.name.toLowerCase()}`,
    name: `${sched.name} Scheduler`,
    description: `${sched.name} scheduling policy`,
    createdAt: new Date().toISOString(),
    seed: seed + idx,
    workload: {
      requestCount: 100,
      tokenDistribution: 'realistic',
      avgPromptTokens: 1024,
      avgCompletionTokens: 256,
      qps: 10,
      duration: '60s',
      variance: 0.3
    },
    simulator: {
      architecture: 'pd_separated',
      prefillGpu: { gpuType: 'compute_heavy', numGpus: 2 },
      decodeGpu: { gpuType: 'memory_heavy', numGpus: 4 },
      kvTransferMs: 3
    },
    cache: {
      type: 'radix',
      capacityMB: 2048,
      blockSizeTokens: 64,
      evictionPolicy: 'lru'
    },
    scheduler: {
      type: sched.type,
      sloTargetMs: sched.type === 'slo_aware' ? 2000 : undefined,
      slo: sched.type === 'slo_aware' ? { ttftMs: 2000, tpotMs: 150, e2eMs: 20000 } : undefined
    },
    statistical: {
      repetitions: 10,
      warmupIterations: 5,
      confidenceLevel: 0.95,
      significanceThreshold: 0.05
    },
    enableChunkedPrefill: true,
    chunkSize: 512
  }));
}

/**
 * Generate Speculative Decoding Ablation configurations.
 * Tests different acceptance rates.
 */
export function createSpeculativeAblationConfig(seed: number = 42): ExperimentConfig[] {
  const acceptanceRates = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

  return acceptanceRates.map((rate, idx) => ({
    id: `speculative_${rate}`,
    name: `Speculative Decoding (${Math.round(rate * 100)}% acceptance)`,
    description: `Speculative decoding with ${Math.round(rate * 100)}% acceptance rate`,
    createdAt: new Date().toISOString(),
    seed: seed + idx,
    workload: {
      requestCount: 100,
      tokenDistribution: 'realistic',
      avgPromptTokens: 1024,
      avgCompletionTokens: 256,
      qps: 10,
      duration: '60s',
      variance: 0.3
    },
    simulator: {
      architecture: 'pd_separated',
      prefillGpu: { gpuType: 'compute_heavy', numGpus: 2 },
      decodeGpu: { gpuType: 'memory_heavy', numGpus: 4 },
      kvTransferMs: 3
    },
    cache: {
      type: 'radix',
      capacityMB: 2048,
      blockSizeTokens: 64,
      evictionPolicy: 'lru'
    },
    scheduler: {
      type: 'speculative',
      sloTargetMs: 2000,
      slo: { ttftMs: 2000, tpotMs: 150, e2eMs: 20000 }
    },
    statistical: {
      repetitions: 10,
      warmupIterations: 5,
      confidenceLevel: 0.95,
      significanceThreshold: 0.05
    },
    enableChunkedPrefill: true,
    chunkSize: 512,
    speculativeAcceptanceRate: rate
  }));
}

/**
 * Generate Multi-tenant SLO Isolation configurations.
 * Tests isolation for gold/silver/bronze tiers.
 */
export function createTenantIsolationConfig(seed: number = 42): ExperimentConfig[] {
  return [
    // No isolation baseline
    {
      id: 'tenant_no_isolation',
      name: 'No Isolation (Baseline)',
      description: 'All tenants share resources without isolation',
      createdAt: new Date().toISOString(),
      seed: seed + 2,
      workload: {
        requestCount: 150,
        tokenDistribution: 'realistic',
        avgPromptTokens: 1024,
        avgCompletionTokens: 256,
        qps: 15,
        duration: '60s',
        variance: 0.4
      },
      simulator: {
        architecture: 'pd_separated',
        prefillGpu: { gpuType: 'compute_heavy', numGpus: 2 },
        decodeGpu: { gpuType: 'memory_heavy', numGpus: 4 },
        kvTransferMs: 3
      },
      cache: {
        type: 'radix',
        capacityMB: 2048,
        blockSizeTokens: 64,
        evictionPolicy: 'lru'
      },
      scheduler: { type: 'fcfs' },
      statistical: {
        repetitions: 10,
        warmupIterations: 5,
        confidenceLevel: 0.95,
        significanceThreshold: 0.05
      },
      enableTenantIsolation: false
    },
    // With isolation
    {
      id: 'tenant_with_isolation',
      name: 'Multi-tenant SLO Isolation',
      description: 'Gold/silver/bronze tier isolation with priority scheduling',
      createdAt: new Date().toISOString(),
      seed: seed + 2,
      workload: {
        requestCount: 150,
        tokenDistribution: 'realistic',
        avgPromptTokens: 1024,
        avgCompletionTokens: 256,
        qps: 15,
        duration: '60s',
        variance: 0.4
      },
      simulator: {
        architecture: 'pd_separated',
        prefillGpu: { gpuType: 'compute_heavy', numGpus: 2 },
        decodeGpu: { gpuType: 'memory_heavy', numGpus: 4 },
        kvTransferMs: 3
      },
      cache: {
        type: 'radix',
        capacityMB: 2048,
        blockSizeTokens: 64,
        evictionPolicy: 'flop_aware'
      },
      scheduler: {
        type: 'slo_aware',
        sloTargetMs: 2000,
        slo: { ttftMs: 2000, tpotMs: 150, e2eMs: 20000 }
      },
      statistical: {
        repetitions: 10,
        warmupIterations: 5,
        confidenceLevel: 0.95,
        significanceThreshold: 0.05
      },
      enableChunkedPrefill: true,
      chunkSize: 512,
      enableTenantIsolation: true,
      tenantTiers: [
        { name: 'gold', sloTargetMs: 1000, weight: 1.0 },
        { name: 'silver', sloTargetMs: 2000, weight: 0.7 },
        { name: 'bronze', sloTargetMs: 5000, weight: 0.4 }
      ]
    }
  ];
}

/**
 * Generate KV Reuse Analysis configurations.
 * Tests different prefix overlap patterns.
 */
export function createKVReuseAnalysisConfig(seed: number = 42): ExperimentConfig[] {
  const prefixOverlaps = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0];

  return prefixOverlaps.map((overlap, idx) => ({
    id: `kv_reuse_overlap_${Math.round(overlap * 100)}pct`,
    name: `KV Reuse - ${Math.round(overlap * 100)}% Overlap`,
    description: `Prefix overlap of ${Math.round(overlap * 100)}%`,
    createdAt: new Date().toISOString(),
    seed: seed + idx,
    workload: {
      requestCount: 100,
      tokenDistribution: overlap === 1.0 ? 'uniform' : 'realistic',
      avgPromptTokens: 1024,
      avgCompletionTokens: 256,
      qps: 10,
      duration: '60s',
      variance: overlap === 1.0 ? 0 : 0.3
    },
    simulator: {
      architecture: 'pd_separated',
      prefillGpu: { gpuType: 'compute_heavy', numGpus: 2 },
      decodeGpu: { gpuType: 'memory_heavy', numGpus: 4 },
      kvTransferMs: 3
    },
    cache: {
      type: overlap === 0 ? 'none' : 'radix',
      capacityMB: overlap === 0 ? 0 : 2048,
      blockSizeTokens: 64,
      evictionPolicy: 'lru'
    },
    scheduler: { type: 'slo_aware', sloTargetMs: 2000, slo: { ttftMs: 2000, tpotMs: 150, e2eMs: 20000 } },
    statistical: {
      repetitions: 10,
      warmupIterations: 5,
      confidenceLevel: 0.95,
      significanceThreshold: 0.05
    },
    enableChunkedPrefill: true,
    chunkSize: 512
  }));
}

/**
 * Get predefined experiment configurations by ID.
 */
export function getPredefinedExperiments(id: PredefinedExperimentId, seed: number = 42): ExperimentConfig[] {
  switch (id) {
    case 'e2e_latency_benchmark':
      return createE2ELatencyBenchmarkConfig(seed);
    case 'cache_scaling_study':
      return createCacheScalingStudyConfig(seed);
    case 'scheduler_comparison':
      return createSchedulerComparisonConfig(seed);
    case 'speculative_ablation':
      return createSpeculativeAblationConfig(seed);
    case 'tenant_isolation':
      return createTenantIsolationConfig(seed);
    case 'kv_reuse_analysis':
      return createKVReuseAnalysisConfig(seed);
    default:
      throw new Error(`Unknown predefined experiment: ${id}`);
  }
}

/**
 * List all predefined experiments with metadata.
 */
export function listPredefinedExperiments(): PredefinedExperimentMetadata[] {
  return Object.values(PREDEFINED_EXPERIMENTS);
}
