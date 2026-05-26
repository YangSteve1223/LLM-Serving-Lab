/**
 * Experiment Configuration Loader
 * 
 * Loads and parses experiment configurations from YAML files.
 * Supports validation, merging with defaults, and environment variable substitution.
 * 
 * References:
 * - YAML 1.2 specification for configuration file format
 * - Common LLM serving benchmark configurations (MLPerf, LLMPerf)
 */
import type { ExperimentConfig } from "./ExperimentConfig.ts";
import { createDefaultExperimentConfig, validateExperimentConfig } from "./ExperimentConfig.ts";
import type { PredefinedExperimentId } from "./PredefinedExperiments.ts";
import { getPredefinedExperiments, listPredefinedExperiments } from "./PredefinedExperiments.ts";

/**
 * YAML configuration file format (commented for documentation).
 * 
 * # experiment-config.yaml
 * id: my_experiment
 * name: My Custom Experiment
 * description: Custom experiment description
 * seed: 42
 * 
 * workload:
 *   requestCount: 100
 *   tokenDistribution: realistic
 *   avgPromptTokens: 1024
 *   avgCompletionTokens: 256
 *   qps: 10
 *   duration: "60s"
 *   variance: 0.3
 * 
 * simulator:
 *   architecture: pd_separated
 *   prefillGpu:
 *     gpuType: compute_heavy
 *     numGpus: 2
 *   decodeGpu:
 *     gpuType: memory_heavy
 *     numGpus: 4
 *   kvTransferMs: 5
 * 
 * cache:
 *   type: radix
 *   capacityMB: 2048
 *   blockSizeTokens: 64
 *   evictionPolicy: lru
 *   enableCompression: true
 * 
 * scheduler:
 *   type: slo_aware
 *   maxBatchSize: 16
 *   stepBudgetMs: 100
 *   sloTargetMs: 2000
 *   slo:
 *     ttftMs: 2000
 *     tpotMs: 150
 *     e2eMs: 20000
 * 
 * statistical:
 *   repetitions: 10
 *   warmupIterations: 5
 *   confidenceLevel: 0.95
 *   significanceThreshold: 0.05
 * 
 * enableChunkedPrefill: true
 * chunkSize: 512
 * enableLSPFirst: true
 */

/**
 * YAML loader interface for different environments.
 */
export interface YAMLLoader {
  parse(content: string): Record<string, unknown>;
  stringify(data: unknown): string;
}

/**
 * Simple YAML parser for basic configurations.
 * Supports: objects, arrays, strings, numbers, booleans, null, comments.
 */
export class SimpleYAMLLoader implements YAMLLoader {
  /**
   * Parse YAML content to object.
   */
  parse(content: string): Record<string, unknown> {
    const lines = content.split('\n');
    const result: Record<string, unknown> = {};
    let currentKey = '';
    let currentIndent = 0;
    let inArray = false;
    let arrayItems: unknown[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      
      // Skip empty lines and comments
      if (!line.trim() || line.trim().startsWith('#')) continue;
      
      const indent = line.search(/\S/);
      const trimmed = line.trim();
      
      // Handle array items
      if (trimmed.startsWith('-')) {
        if (!inArray) {
          inArray = true;
          arrayItems = [];
        }
        const value = trimmed.slice(1).trim();
        arrayItems.push(this.parseValue(value));
        continue;
      } else if (inArray) {
        // End of array
        if (currentKey) {
          result[currentKey] = arrayItems;
        }
        inArray = false;
        arrayItems = [];
      }
      
      // Parse key-value pairs
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        
        currentKey = key;
        currentIndent = indent;
        
        if (value) {
          result[key] = this.parseValue(value);
        } else {
          // Check if next line is nested
          const nextLine = lines[i + 1];
          if (nextLine && nextLine.search(/\S/) > indent) {
            // Will be handled in next iteration
          } else {
            result[key] = null;
          }
        }
      } else if (trimmed.startsWith('-')) {
        // Array item without context
        const value = trimmed.slice(1).trim();
        if (!Array.isArray(result['__array'])) {
          result['__array'] = [];
        }
        (result['__array'] as unknown[]).push(this.parseValue(value));
      }
    }
    
    // Handle remaining array
    if (inArray && currentKey) {
      result[currentKey] = arrayItems;
    }
    
    return result;
  }
  
  /**
   * Parse a YAML value.
   */
  private parseValue(value: string): unknown {
    // Null
    if (value === 'null' || value === '~') return null;
    
    // Boolean
    if (value === 'true') return true;
    if (value === 'false') return false;
    
    // Number
    const num = Number(value);
    if (!isNaN(num) && value !== '') return num;
    
    // Quoted string
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    
    // Plain string
    return value;
  }
  
  /**
   * Convert object to YAML string.
   */
  stringify(data: unknown, indent: number = 0): string {
    const spaces = '  '.repeat(indent);
    const lines: string[] = [];
    
    if (data === null || data === undefined) {
      return 'null';
    }
    
    if (typeof data === 'boolean' || typeof data === 'number') {
      return String(data);
    }
    
    if (typeof data === 'string') {
      if (data.includes(':') || data.includes('#') || data.includes('\n') || data.startsWith(' ')) {
        return `"${data}"`;
      }
      return data;
    }
    
    if (Array.isArray(data)) {
      for (const item of data) {
        if (typeof item === 'object' && item !== null) {
          lines.push(`${spaces}-`);
          lines.push(this.stringify(item, indent + 1));
        } else {
          lines.push(`${spaces}- ${this.stringify(item)}`);
        }
      }
    } else if (typeof data === 'object') {
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'object' && value !== null) {
          lines.push(`${spaces}${key}:`);
          lines.push(this.stringify(value, indent + 1));
        } else {
          lines.push(`${spaces}${key}: ${this.stringify(value)}`);
        }
      }
    }
    
    return lines.join('\n');
  }
}

/**
 * Configuration loader options.
 */
export interface ConfigLoaderOptions {
  /** Base directory for relative paths */
  baseDir?: string;
  /** Enable environment variable substitution */
  enableEnvSubstitution?: boolean;
  /** Default values to merge */
  defaults?: Partial<ExperimentConfig>;
  /** Validation strictness */
  strictValidation?: boolean;
}

/**
 * Experiment configuration loader.
 */
export class ExperimentConfigLoader {
  private yaml: SimpleYAMLLoader;
  private baseDir: string;
  private enableEnvSubstitution: boolean;
  private defaults: Partial<ExperimentConfig>;
  private strictValidation: boolean;

  constructor(options: ConfigLoaderOptions = {}) {
    this.yaml = new SimpleYAMLLoader();
    this.baseDir = options.baseDir ?? './configs/experiments';
    this.enableEnvSubstitution = options.enableEnvSubstitution ?? true;
    this.defaults = options.defaults ?? {};
    this.strictValidation = options.strictValidation ?? true;
  }

  /**
   * Load configuration from YAML content string.
   */
  loadFromString(content: string, id?: string): ExperimentConfig {
    let parsed = this.yaml.parse(content);
    
    // Environment variable substitution
    if (this.enableEnvSubstitution) {
      parsed = this.substituteEnvVars(parsed);
    }
    
    // Convert to ExperimentConfig
    const config = this.convertToConfig(parsed, id);
    
    // Merge with defaults
    const merged = this.mergeWithDefaults(config);
    
    // Validate
    if (this.strictValidation) {
      const errors = validateExperimentConfig(merged);
      if (errors.length > 0) {
        throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
      }
    }
    
    return merged;
  }

  /**
   * Load configuration from file.
   */
  async loadFromFile(filePath: string): Promise<ExperimentConfig> {
    const content = await Deno.readTextFile(filePath);
    const id = filePath.split('/').pop()?.replace('.yaml', '') ?? 'unknown';
    return this.loadFromString(content, id);
  }

  /**
   * Save configuration to YAML file.
   */
  async saveToFile(config: ExperimentConfig, filePath: string): Promise<void> {
    const content = this.yaml.stringify(config);
    await Deno.writeTextFile(filePath, content);
  }

  /**
   * Convert YAML parsed object to ExperimentConfig.
   */
  private convertToConfig(parsed: Record<string, unknown>, id?: string): ExperimentConfig {
    const config: ExperimentConfig = {
      id: (parsed.id as string) ?? id ?? 'unknown',
      name: (parsed.name as string) ?? 'Unnamed Experiment',
      description: (parsed.description as string) ?? '',
      createdAt: (parsed.createdAt as string) ?? new Date().toISOString(),
      author: parsed.author as string | undefined,
      tags: parsed.tags as string[] | undefined,
      seed: (parsed.seed as number) ?? 42,
      workload: this.parseWorkload(parsed.workload as Record<string, unknown>),
      simulator: this.parseSimulator(parsed.simulator as Record<string, unknown>),
      cache: this.parseCache(parsed.cache as Record<string, unknown>),
      scheduler: this.parseScheduler(parsed.scheduler as Record<string, unknown>),
      statistical: this.parseStatistical(parsed.statistical as Record<string, unknown>),
      enableChunkedPrefill: parsed.enableChunkedPrefill as boolean | undefined,
      chunkSize: parsed.chunkSize as number | undefined,
      enableLSPFirst: parsed.enableLSPFirst as boolean | undefined,
      speculativeAcceptanceRate: parsed.speculativeAcceptanceRate as number | undefined,
      enableTenantIsolation: parsed.enableTenantIsolation as boolean | undefined,
      tenantTiers: this.parseTenantTiers(parsed.tenantTiers as unknown)
    };
    
    return config;
  }

  /**
   * Parse workload configuration.
   */
  private parseWorkload(w: Record<string, unknown> | undefined): ExperimentConfig['workload'] {
    if (!w) {
      return {
        requestCount: 100,
        tokenDistribution: 'realistic',
        avgPromptTokens: 1024,
        avgCompletionTokens: 256,
        qps: 10,
        duration: '60s'
      };
    }
    
    return {
      requestCount: (w.requestCount as number) ?? 100,
      tokenDistribution: (w.tokenDistribution as 'uniform' | 'poisson' | 'realistic') ?? 'realistic',
      avgPromptTokens: (w.avgPromptTokens as number) ?? 1024,
      avgCompletionTokens: (w.avgCompletionTokens as number) ?? 256,
      qps: (w.qps as number) ?? 10,
      duration: (w.duration as string) ?? '60s',
      variance: w.variance as number | undefined
    };
  }

  /**
   * Parse simulator configuration.
   */
  private parseSimulator(s: Record<string, unknown> | undefined): ExperimentConfig['simulator'] {
    if (!s) {
      return {
        architecture: 'pd_separated',
        prefillGpu: { gpuType: 'compute_heavy', numGpus: 2 },
        decodeGpu: { gpuType: 'memory_heavy', numGpus: 4 }
      };
    }
    
    return {
      architecture: (s.architecture as 'monolithic' | 'pd_separated' | 'hybrid') ?? 'pd_separated',
      prefillGpu: {
        gpuType: ((s.prefillGpu as Record<string, unknown>)?.gpuType as string) ?? 'compute_heavy',
        numGpus: ((s.prefillGpu as Record<string, unknown>)?.numGpus as number) ?? 2,
        memoryGB: ((s.prefillGpu as Record<string, unknown>)?.memoryGB as number) ?? undefined,
        flopsTFLOPS: ((s.prefillGpu as Record<string, unknown>)?.flopsTFLOPS as number) ?? undefined
      },
      decodeGpu: {
        gpuType: ((s.decodeGpu as Record<string, unknown>)?.gpuType as string) ?? 'memory_heavy',
        numGpus: ((s.decodeGpu as Record<string, unknown>)?.numGpus as number) ?? 4,
        memoryGB: ((s.decodeGpu as Record<string, unknown>)?.memoryGB as number) ?? undefined,
        flopsTFLOPS: ((s.decodeGpu as Record<string, unknown>)?.flopsTFLOPS as number) ?? undefined
      },
      numPrefillWorkers: s.numPrefillWorkers as number | undefined,
      numDecodeWorkers: s.numDecodeWorkers as number | undefined,
      kvTransferMs: s.kvTransferMs as number | undefined
    };
  }

  /**
   * Parse cache configuration.
   */
  private parseCache(c: Record<string, unknown> | undefined): ExperimentConfig['cache'] {
    if (!c) {
      return { type: 'radix', capacityMB: 1024 };
    }
    
    return {
      type: (c.type as 'none' | 'hash' | 'radix' | 'hierarchical') ?? 'radix',
      capacityMB: (c.capacityMB as number) ?? 1024,
      blockSizeTokens: c.blockSizeTokens as number | undefined,
      evictionPolicy: c.evictionPolicy as 'lru' | 'lfu' | 'flop_aware' | undefined,
      enableCompression: c.enableCompression as boolean | undefined
    };
  }

  /**
   * Parse scheduler configuration.
   */
  private parseScheduler(s: Record<string, unknown> | undefined): ExperimentConfig['scheduler'] {
    if (!s) {
      return { type: 'fcfs' };
    }
    
    return {
      type: (s.type as 'fcfs' | 'sjf' | 'slo_aware' | 'speculative') ?? 'fcfs',
      maxBatchSize: s.maxBatchSize as number | undefined,
      stepBudgetMs: s.stepBudgetMs as number | undefined,
      sloTargetMs: s.sloTargetMs as number | undefined,
      slo: s.slo as ExperimentConfig['scheduler']['slo']
    };
  }

  /**
   * Parse statistical configuration.
   */
  private parseStatistical(s: Record<string, unknown> | undefined): ExperimentConfig['statistical'] {
    if (!s) {
      return {
        repetitions: 10,
        warmupIterations: 5,
        confidenceLevel: 0.95,
        significanceThreshold: 0.05
      };
    }
    
    return {
      repetitions: (s.repetitions as number) ?? 10,
      warmupIterations: (s.warmupIterations as number) ?? 5,
      confidenceLevel: (s.confidenceLevel as number) ?? 0.95,
      significanceThreshold: s.significanceThreshold as number | undefined
    };
  }

  /**
   * Parse tenant tiers configuration.
   */
  private parseTenantTiers(t: unknown): ExperimentConfig['tenantTiers'] {
    if (!t || !Array.isArray(t)) return undefined;
    
    return t.map((tier) => {
      const tObj = tier as Record<string, unknown>;
      return {
        name: tObj.name as string,
        sloTargetMs: tObj.sloTargetMs as number,
        weight: tObj.weight as number
      };
    });
  }

  /**
   * Substitute environment variables in parsed content.
   */
  private substituteEnvVars(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        // Replace ${VAR} patterns
        result[key] = value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
          return Deno.env.get(varName) ?? '';
        });
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.substituteEnvVars(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }

  /**
   * Merge configuration with defaults.
   */
  private mergeWithDefaults(config: ExperimentConfig): ExperimentConfig {
    return {
      ...createDefaultExperimentConfig(config.id, config.name),
      ...config
    };
  }

  /**
   * Generate YAML content from configuration.
   */
  toYAML(config: ExperimentConfig): string {
    return this.yaml.stringify(config);
  }
}

/**
 * Create a default config loader instance.
 */
export function createConfigLoader(options?: ConfigLoaderOptions): ExperimentConfigLoader {
  return new ExperimentConfigLoader(options);
}

/**
 * Quick load predefined experiment configurations.
 */
export function loadPredefinedExperiment(
  experimentId: PredefinedExperimentId,
  seed: number = 42
): ExperimentConfig[] {
  return getPredefinedExperiments(experimentId, seed);
}

/**
 * List available predefined experiments.
 */
export function listAvailableExperiments(): ReturnType<typeof listPredefinedExperiments> {
  return listPredefinedExperiments();
}
