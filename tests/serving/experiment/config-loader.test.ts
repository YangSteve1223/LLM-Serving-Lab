/**
 * ConfigLoader Tests
 * 
 * Tests for:
 * - YAML parsing
 * - Configuration loading
 * - Environment variable substitution
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  SimpleYAMLLoader,
  createConfigLoader,
  loadPredefinedExperiment,
  listAvailableExperiments
} from '../../../src/agents/learningAssistant/serving/experiment/ConfigLoader.ts';
import type { ExperimentConfig } from '../../../src/agents/learningAssistant/serving/experiment/ExperimentConfig.ts';

describe('SimpleYAMLLoader', () => {
  const loader = new SimpleYAMLLoader();

  describe('parse', () => {
    it('should parse simple key-value pairs', () => {
      const yaml = `
id: test_id
name: Test Name
seed: 42
`;
      const result = loader.parse(yaml);
      
      assert.strictEqual(result.id, 'test_id');
      assert.strictEqual(result.name, 'Test Name');
      assert.strictEqual(result.seed, 42);
    });

    it('should parse basic values', () => {
      const yaml = `
workload_requestCount: 100
workload_avgPromptTokens: 1024
`;
      const result = loader.parse(yaml);
      
      assert.ok(result.workload_requestCount);
      assert.strictEqual(result.workload_requestCount, 100);
      assert.strictEqual(result.workload_avgPromptTokens, 1024);
    });

    it('should parse arrays', () => {
      const yaml = `
tags:
  - tag1
  - tag2
  - tag3
`;
      const result = loader.parse(yaml);
      
      assert.ok(Array.isArray(result.tags));
      assert.strictEqual((result.tags as string[])[0], 'tag1');
      assert.strictEqual((result.tags as string[])[1], 'tag2');
      assert.strictEqual((result.tags as string[])[2], 'tag3');
    });

    it('should parse booleans', () => {
      const yaml = `
enabled: true
disabled: false
`;
      const result = loader.parse(yaml);
      
      assert.strictEqual(result.enabled, true);
      assert.strictEqual(result.disabled, false);
    });

    it('should parse null values', () => {
      const yaml = `
value: null
other: ~
`;
      const result = loader.parse(yaml);
      
      assert.strictEqual(result.value, null);
      assert.strictEqual(result.other, null);
    });

    it('should handle comments', () => {
      const yaml = `
# This is a comment
id: test
# Another comment
name: Test
`;
      const result = loader.parse(yaml);
      
      assert.strictEqual(result.id, 'test');
      assert.strictEqual(result.name, 'Test');
    });

    it('should parse quoted strings', () => {
      const yaml = `
withQuotes: "quoted string"
withSingle: 'single quoted'
`;
      const result = loader.parse(yaml);
      
      assert.strictEqual(result.withQuotes, 'quoted string');
      assert.strictEqual(result.withSingle, 'single quoted');
    });
  });

  describe('stringify', () => {
    it('should convert object to YAML', () => {
      const data = {
        id: 'test',
        name: 'Test',
        count: 42,
        enabled: true
      };
      
      const yaml = loader.stringify(data);
      
      assert.ok(yaml.includes('id: test'));
      assert.ok(yaml.includes('name: Test'));
      assert.ok(yaml.includes('count: 42'));
      assert.ok(yaml.includes('enabled: true'));
    });

    it('should stringify nested objects', () => {
      const data = {
        workload: {
          requestCount: 100,
          avgPromptTokens: 1024
        }
      };
      
      const yaml = loader.stringify(data);
      
      assert.ok(yaml.includes('workload:'));
      assert.ok(yaml.includes('requestCount: 100'));
      assert.ok(yaml.includes('avgPromptTokens: 1024'));
    });

    it('should stringify arrays', () => {
      const data = {
        tags: ['tag1', 'tag2', 'tag3']
      };
      
      const yaml = loader.stringify(data);
      
      assert.ok(yaml.includes('- tag1'));
      assert.ok(yaml.includes('- tag2'));
      assert.ok(yaml.includes('- tag3'));
    });
  });

  describe('round-trip', () => {
    it('should preserve simple values', () => {
      const original = {
        id: 'test',
        name: 'Test',
        count: 42,
        enabled: true,
        disabled: false
      };
      
      const yaml = loader.stringify(original);
      const parsed = loader.parse(yaml);
      
      assert.strictEqual(parsed.id, original.id);
      assert.strictEqual(parsed.name, original.name);
      assert.strictEqual(parsed.count, original.count);
      assert.strictEqual(parsed.enabled, original.enabled);
      assert.strictEqual(parsed.disabled, original.disabled);
    });
  });
});

describe('ExperimentConfigLoader', () => {
  describe('loadFromString', () => {
    it('should parse minimal configuration', () => {
      const yaml = `
id: minimal_test
name: Minimal Test
description: A minimal test configuration
`;
      const loader = createConfigLoader({ strictValidation: false });
      const config = loader.loadFromString(yaml);
      
      assert.strictEqual(config.id, 'minimal_test');
      assert.strictEqual(config.name, 'Minimal Test');
      assert.ok(config.createdAt);
    });

    it('should apply defaults for missing fields', () => {
      const yaml = `
id: defaults_test
name: Defaults Test
`;
      const loader = createConfigLoader({ strictValidation: false });
      const config = loader.loadFromString(yaml);
      
      // Should have defaults applied
      assert.strictEqual(config.workload.requestCount, 100);
      assert.strictEqual(config.simulator.architecture, 'pd_separated');
      assert.strictEqual(config.cache.type, 'radix');
      assert.strictEqual(config.statistical.repetitions, 10);
    });

    it('should throw on validation errors when strict', () => {
      const yaml = `
id: ""
name: Test
seed: -1
`;
      const loader = createConfigLoader({ strictValidation: true });
      
      assert.throws(() => {
        loader.loadFromString(yaml);
      }, /validation failed/i);
    });
  });

  describe('environment variable substitution', () => {
    it('should not substitute when disabled', () => {
      const yaml = `
id: test
name: Test
seed: \${TEST_SEED}
`;
      const loader = createConfigLoader({ 
        enableEnvSubstitution: false,
        strictValidation: false 
      });
      const config = loader.loadFromString(yaml);
      
      assert.strictEqual((config as any).seed, '\${TEST_SEED}');
    });
  });
});

describe('Predefined experiment loading', () => {
  describe('loadPredefinedExperiment', () => {
    it('should load E2E Latency Benchmark configs', () => {
      const configs = loadPredefinedExperiment('e2e_latency_benchmark');
      
      assert.ok(configs.length > 0);
      assert.ok(configs.every(c => c.id.includes('e2e')));
    });

    it('should load Cache Scaling Study configs', () => {
      const configs = loadPredefinedExperiment('cache_scaling_study');
      
      assert.ok(configs.length > 0);
      assert.ok(configs.every(c => c.id.includes('cache_scaling')));
    });

    it('should load Scheduler Comparison configs', () => {
      const configs = loadPredefinedExperiment('scheduler_comparison');
      
      assert.ok(configs.length > 0);
      assert.ok(configs.some(c => c.scheduler.type === 'fcfs'));
      assert.ok(configs.some(c => c.scheduler.type === 'sjf'));
      assert.ok(configs.some(c => c.scheduler.type === 'slo_aware'));
    });

    it('should use custom seed', () => {
      const configs1 = loadPredefinedExperiment('e2e_latency_benchmark', 42);
      const configs2 = loadPredefinedExperiment('e2e_latency_benchmark', 123);
      
      assert.ok(configs1[0].seed !== configs2[0].seed);
    });
  });

  describe('listAvailableExperiments', () => {
    it('should return list of available experiments', () => {
      const experiments = listAvailableExperiments();
      
      assert.ok(Array.isArray(experiments));
      assert.ok(experiments.length > 0);
      
      // Check structure
      const exp = experiments[0];
      assert.ok('id' in exp);
      assert.ok('name' in exp);
      assert.ok('description' in exp);
      assert.ok('category' in exp);
      assert.ok('expectedDuration' in exp);
      assert.ok('keyMetrics' in exp);
    });
  });
});
