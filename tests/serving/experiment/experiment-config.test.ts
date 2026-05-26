/**
 * Experiment Configuration Tests
 * 
 * Tests for:
 * - ExperimentConfig schema validation
 * - Predefined experiments generation
 * - ConfigLoader YAML parsing
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  createDefaultExperimentConfig,
  validateExperimentConfig,
  type ExperimentConfig
} from '../../../src/agents/learningAssistant/serving/experiment/ExperimentConfig.ts';
import {
  PREDEFINED_EXPERIMENTS,
  createE2ELatencyBenchmarkConfig,
  createCacheScalingStudyConfig,
  createSchedulerComparisonConfig,
  createSpeculativeAblationConfig,
  createTenantIsolationConfig,
  createKVReuseAnalysisConfig,
  getPredefinedExperiments,
  listPredefinedExperiments
} from '../../../src/agents/learningAssistant/serving/experiment/PredefinedExperiments.ts';

describe('ExperimentConfig', () => {
  describe('createDefaultExperimentConfig', () => {
    it('should create a valid default configuration', () => {
      const config = createDefaultExperimentConfig('test_exp', 'Test Experiment');
      
      assert.strictEqual(config.id, 'test_exp');
      assert.strictEqual(config.name, 'Test Experiment');
      assert.strictEqual(config.seed, 42);
      assert.strictEqual(config.workload.requestCount, 100);
      assert.strictEqual(config.simulator.architecture, 'pd_separated');
      assert.strictEqual(config.cache.type, 'radix');
      assert.strictEqual(config.scheduler.type, 'slo_aware');
      assert.strictEqual(config.statistical.repetitions, 10);
    });

    it('should set createdAt to current time', () => {
      const before = new Date().toISOString();
      const config = createDefaultExperimentConfig('test', 'Test');
      const after = new Date().toISOString();
      
      assert.ok(config.createdAt >= before && config.createdAt <= after);
    });
  });

  describe('validateExperimentConfig', () => {
    it('should return empty array for valid config', () => {
      const config = createDefaultExperimentConfig('test', 'Test');
      const errors = validateExperimentConfig(config);
      
      assert.strictEqual(errors.length, 0);
    });

    it('should detect missing id', () => {
      const config = createDefaultExperimentConfig('test', 'Test');
      config.id = '';
      const errors = validateExperimentConfig(config);
      
      assert.ok(errors.some(e => e.includes('ID')));
    });

    it('should detect invalid seed', () => {
      const config = createDefaultExperimentConfig('test', 'Test');
      config.seed = -1;
      const errors = validateExperimentConfig(config);
      
      assert.ok(errors.some(e => e.includes('Seed')));
    });

    it('should detect invalid request count', () => {
      const config = createDefaultExperimentConfig('test', 'Test');
      config.workload.requestCount = 0;
      const errors = validateExperimentConfig(config);
      
      assert.ok(errors.some(e => e.includes('Request count')));
    });

    it('should detect invalid cache capacity', () => {
      const config = createDefaultExperimentConfig('test', 'Test');
      config.cache.capacityMB = -100;
      const errors = validateExperimentConfig(config);
      
      assert.ok(errors.some(e => e.includes('Cache capacity')));
    });

    it('should detect invalid confidence level', () => {
      const config = createDefaultExperimentConfig('test', 'Test');
      config.statistical.confidenceLevel = 1.5;
      const errors = validateExperimentConfig(config);
      
      assert.ok(errors.some(e => e.includes('Confidence level')));
    });
  });
});

describe('PredefinedExperiments', () => {
  describe('PREDEFINED_EXPERIMENTS', () => {
    it('should have all expected experiment types', () => {
      const expectedIds = [
        'e2e_latency_benchmark',
        'cache_scaling_study',
        'scheduler_comparison',
        'speculative_ablation',
        'tenant_isolation',
        'kv_reuse_analysis'
      ];
      
      for (const id of expectedIds) {
        assert.ok(PREDEFINED_EXPERIMENTS[id], `Missing experiment: ${id}`);
        assert.strictEqual(PREDEFINED_EXPERIMENTS[id].id, id);
      }
    });

    it('should have proper metadata for each experiment', () => {
      for (const [id, meta] of Object.entries(PREDEFINED_EXPERIMENTS)) {
        assert.ok(meta.name, `Missing name for ${id}`);
        assert.ok(meta.description, `Missing description for ${id}`);
        assert.ok(meta.category, `Missing category for ${id}`);
        assert.ok(meta.expectedDuration, `Missing expectedDuration for ${id}`);
        assert.ok(meta.keyMetrics.length > 0, `Missing keyMetrics for ${id}`);
      }
    });
  });

  describe('createE2ELatencyBenchmarkConfig', () => {
    it('should create 4 configurations (monolithic, pd, pd+cache, hybrid)', () => {
      const configs = createE2ELatencyBenchmarkConfig();
      
      assert.strictEqual(configs.length, 4);
      assert.strictEqual(configs[0].simulator.architecture, 'monolithic');
      assert.strictEqual(configs[1].simulator.architecture, 'pd_separated');
      assert.strictEqual(configs[2].simulator.architecture, 'pd_separated');
      assert.strictEqual(configs[2].cache.type, 'radix');
      assert.strictEqual(configs[3].simulator.architecture, 'hybrid');
    });

    it('should use different seeds for each config', () => {
      const configs = createE2ELatencyBenchmarkConfig(100);
      const seeds = configs.map(c => c.seed);
      
      assert.strictEqual(new Set(seeds).size, seeds.length);
    });
  });

  describe('createCacheScalingStudyConfig', () => {
    it('should create 5 configurations with different capacities', () => {
      const configs = createCacheScalingStudyConfig();
      
      assert.strictEqual(configs.length, 5);
      const capacities = [256, 512, 1024, 2048, 4096];
      
      for (let i = 0; i < configs.length; i++) {
        assert.strictEqual(configs[i].cache.capacityMB, capacities[i]);
      }
    });

    it('should use none cache for first config', () => {
      const configs = createCacheScalingStudyConfig();
      
      assert.strictEqual(configs[0].cache.type, 'none');
    });
  });

  describe('createSchedulerComparisonConfig', () => {
    it('should create 3 configurations for FCFS, SJF, SLO-aware', () => {
      const configs = createSchedulerComparisonConfig();
      
      assert.strictEqual(configs.length, 3);
      assert.strictEqual(configs[0].scheduler.type, 'fcfs');
      assert.strictEqual(configs[1].scheduler.type, 'sjf');
      assert.strictEqual(configs[2].scheduler.type, 'slo_aware');
    });

    it('should set SLO targets for slo_aware scheduler', () => {
      const configs = createSchedulerComparisonConfig();
      const sloAwareConfig = configs.find(c => c.scheduler.type === 'slo_aware');
      
      assert.ok(sloAwareConfig?.scheduler.slo);
      assert.ok(sloAwareConfig?.scheduler.sloTargetMs);
    });
  });

  describe('createSpeculativeAblationConfig', () => {
    it('should create 6 configurations with different acceptance rates', () => {
      const configs = createSpeculativeAblationConfig();
      
      assert.strictEqual(configs.length, 6);
      const rates = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
      
      for (let i = 0; i < configs.length; i++) {
        assert.strictEqual(configs[i].speculativeAcceptanceRate, rates[i]);
        assert.strictEqual(configs[i].scheduler.type, 'speculative');
      }
    });
  });

  describe('createTenantIsolationConfig', () => {
    it('should create 2 configurations (no isolation and with isolation)', () => {
      const configs = createTenantIsolationConfig();
      
      assert.strictEqual(configs.length, 2);
      assert.strictEqual(configs[0].enableTenantIsolation, false);
      assert.strictEqual(configs[1].enableTenantIsolation, true);
    });

    it('should define tenant tiers in isolation config', () => {
      const configs = createTenantIsolationConfig();
      const isolationConfig = configs[1];
      
      assert.ok(isolationConfig.tenantTiers);
      assert.strictEqual(isolationConfig.tenantTiers?.length, 3);
      assert.strictEqual(isolationConfig.tenantTiers?.[0].name, 'gold');
      assert.strictEqual(isolationConfig.tenantTiers?.[1].name, 'silver');
      assert.strictEqual(isolationConfig.tenantTiers?.[2].name, 'bronze');
    });
  });

  describe('createKVReuseAnalysisConfig', () => {
    it('should create 6 configurations with different overlap rates', () => {
      const configs = createKVReuseAnalysisConfig();
      
      assert.strictEqual(configs.length, 6);
      const overlaps = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
      
      for (let i = 0; i < configs.length; i++) {
        // Config IDs contain overlap percentage
        assert.ok(configs[i].id.includes(`${Math.round(overlaps[i] * 100)}pct`));
      }
    });

    it('should use none cache for 0% overlap', () => {
      const configs = createKVReuseAnalysisConfig();
      
      assert.strictEqual(configs[0].cache.type, 'none');
    });
  });

  describe('getPredefinedExperiments', () => {
    it('should return correct configs for each experiment type', () => {
      const expTypes = [
        'e2e_latency_benchmark',
        'cache_scaling_study',
        'scheduler_comparison',
        'speculative_ablation',
        'tenant_isolation',
        'kv_reuse_analysis'
      ] as const;
      
      const expectedCounts = [4, 5, 3, 6, 2, 6];
      
      for (let i = 0; i < expTypes.length; i++) {
        const configs = getPredefinedExperiments(expTypes[i]);
        assert.strictEqual(configs.length, expectedCounts[i], 
          `Wrong count for ${expTypes[i]}: expected ${expectedCounts[i]}, got ${configs.length}`);
      }
    });

    it('should throw error for unknown experiment type', () => {
      assert.throws(() => {
        getPredefinedExperiments('unknown_experiment' as any);
      }, /Unknown predefined experiment/);
    });
  });

  describe('listPredefinedExperiments', () => {
    it('should return array of all experiment metadata', () => {
      const list = listPredefinedExperiments();
      
      assert.strictEqual(list.length, Object.keys(PREDEFINED_EXPERIMENTS).length);
      assert.ok(Array.isArray(list));
    });
  });
});
