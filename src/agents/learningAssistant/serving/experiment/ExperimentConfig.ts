/**
 * Experiment Configuration Schema
 * 
 * Unified configuration schema for all serving experiments.
 * Ensures consistency across different experiment types and enables
 * reproducible, configurable experiment runs.
 * 
 * References:
 * - OSDI 2024: Sarathi-Serve, DistServe for PD separation baselines
 * - SOSP 2023: PagedAttention for KV cache management
 * - MLSys 2024: RadixAttention for prefix caching optimization
 */
import type { ServingSLO } from "../ServingTrace.ts";

/**
 * Architecture types for serving.
 */
export type ArchitectureType = 'monolithic' | 'pd_separated' | 'hybrid';

/**
 * Cache types for KV cache management.
 */
export type CacheType = 'none' | 'hash' | 'radix' | 'hierarchical';

/**
 * Cache eviction policies.
 */
export type EvictionPolicy = 'lru' | 'lfu' | 'flop_aware';

/**
 * Scheduler policy types.
 */
export type SchedulerType = 'fcfs' | 'sjf' | 'slo_aware' | 'speculative';

/**
 * Token distribution for workload generation.
 */
export type TokenDistribution = 'uniform' | 'poisson' | 'realistic';

/**
 * GPU configuration for simulators.
 */
export interface SimulatorGPUConfig {
  gpuType: string;
  numGpus: number;
  memoryGB?: number;
  flopsTFLOPS?: number;
}

/**
 * Workload configuration.
 */
export interface WorkloadConfig {
  /** Total number of requests to generate */
  requestCount: number;
  /** Token distribution type */
  tokenDistribution: TokenDistribution;
  /** Average prompt tokens per request */
  avgPromptTokens: number;
  /** Average completion tokens per request */
  avgCompletionTokens: number;
  /** Queries per second */
  qps: number;
  /** Experiment duration (e.g., "60s", "5m") */
  duration: string;
  /** Token variance multiplier (0-1) */
  variance?: number;
}

/**
 * Simulator architecture configuration.
 */
export interface SimulatorArchitectureConfig {
  /** Architecture type */
  architecture: ArchitectureType;
  /** Prefill stage GPU configuration */
  prefillGpu: SimulatorGPUConfig;
  /** Decode stage GPU configuration */
  decodeGpu: SimulatorGPUConfig;
  /** Number of prefill workers */
  numPrefillWorkers?: number;
  /** Number of decode workers */
  numDecodeWorkers?: number;
  /** KV transfer base latency in ms */
  kvTransferMs?: number;
}

/**
 * Cache configuration for KV cache.
 */
export interface CacheConfig {
  /** Cache type */
  type: CacheType;
  /** Maximum cache capacity in MB */
  capacityMB: number;
  /** Block size in tokens */
  blockSizeTokens?: number;
  /** Eviction policy */
  evictionPolicy?: EvictionPolicy;
  /** Enable prefix compression */
  enableCompression?: boolean;
}

/**
 * Scheduler configuration.
 */
export interface SchedulerConfig {
  /** Scheduler policy type */
  type: SchedulerType;
  /** Maximum batch size */
  maxBatchSize?: number;
  /** Step budget in ms */
  stepBudgetMs?: number;
  /** SLO target in ms (required for slo_aware) */
  sloTargetMs?: number;
  /** SLO configuration */
  slo?: ServingSLO;
}

/**
 * Statistical configuration for experiment repetition.
 */
export interface StatisticalConfig {
  /** Number of repetitions per configuration */
  repetitions: number;
  /** Warmup iterations before measurement */
  warmupIterations: number;
  /** Confidence level for statistical tests (0-1) */
  confidenceLevel: number;
  /** Significance threshold for p-value */
  significanceThreshold?: number;
}

/**
 * Comprehensive experiment configuration.
 */
export interface ExperimentConfig {
  // ==================== Meta Information ====================
  /** Unique experiment identifier */
  id: string;
  /** Human-readable experiment name */
  name: string;
  /** Detailed description */
  description: string;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
  /** Author or team */
  author?: string;
  /** Tags for categorization */
  tags?: string[];

  // ==================== Reproducibility ====================
  /** Random seed for deterministic results */
  seed: number;

  // ==================== Workload ====================
  /** Workload generation configuration */
  workload: WorkloadConfig;

  // ==================== System Configuration ====================
  /** Simulator architecture configuration */
  simulator: SimulatorArchitectureConfig;
  /** Cache configuration */
  cache: CacheConfig;
  /** Scheduler configuration */
  scheduler: SchedulerConfig;

  // ==================== Statistical ====================
  /** Statistical configuration */
  statistical: StatisticalConfig;

  // ==================== Advanced Options ====================
  /** Enable chunked prefill */
  enableChunkedPrefill?: boolean;
  /** Chunk size for chunked prefill */
  chunkSize?: number;
  /** Enable LSP-first scheduling */
  enableLSPFirst?: boolean;
  /** Speculative decoding acceptance rate (0-1) */
  speculativeAcceptanceRate?: number;
  /** Multi-tenant tier isolation */
  enableTenantIsolation?: boolean;
  /** Tenant tiers configuration */
  tenantTiers?: {
    name: string;
    sloTargetMs: number;
    weight: number;
  }[];
}

/**
 * Default experiment configuration factory.
 */
export function createDefaultExperimentConfig(id: string, name: string): ExperimentConfig {
  return {
    id,
    name,
    description: 'Default experiment configuration',
    createdAt: new Date().toISOString(),
    seed: 42,
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
      numPrefillWorkers: 4,
      numDecodeWorkers: 8,
      kvTransferMs: 5
    },
    cache: {
      type: 'radix',
      capacityMB: 1024,
      blockSizeTokens: 64,
      evictionPolicy: 'lru',
      enableCompression: true
    },
    scheduler: {
      type: 'slo_aware',
      maxBatchSize: 16,
      stepBudgetMs: 100,
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
    enableLSPFirst: true
  };
}

/**
 * Experiment configuration validation.
 */
export function validateExperimentConfig(config: ExperimentConfig): string[] {
  const errors: string[] = [];

  if (!config.id) errors.push('Experiment ID is required');
  if (!config.name) errors.push('Experiment name is required');
  if (config.seed < 0) errors.push('Seed must be non-negative');

  if (config.workload.requestCount <= 0) {
    errors.push('Request count must be positive');
  }
  if (config.workload.avgPromptTokens <= 0) {
    errors.push('Average prompt tokens must be positive');
  }
  if (config.workload.qps <= 0) {
    errors.push('QPS must be positive');
  }

  if (config.cache.capacityMB <= 0) {
    errors.push('Cache capacity must be positive');
  }

  if (config.statistical.repetitions <= 0) {
    errors.push('Repetitions must be positive');
  }
  if (config.statistical.confidenceLevel <= 0 || config.statistical.confidenceLevel >= 1) {
    errors.push('Confidence level must be between 0 and 1');
  }

  return errors;
}
