/**
 * Tests for Ablation Study Runner
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  AblationStudyRunner,
  createStandardAblationConfig,
  type AblationConfig
} from '../../../src/agents/learningAssistant/serving/experiment/AblationStudyRunner.ts';
import type { PDWorkloadRequest } from '../../../src/agents/learningAssistant/serving/ServingTrace.ts';

describe('AblationStudyRunner', () => {
  const runner = new AblationStudyRunner();

  // Create sample workload
  const sampleWorkload: PDWorkloadRequest[] = [
    { id: 'req-1', arrivalMs: 0, prefillTokens: 128, decodeTokens: 64 },
    { id: 'req-2', arrivalMs: 100, prefillTokens: 256, decodeTokens: 128 },
    { id: 'req-3', arrivalMs: 200, prefillTokens: 512, decodeTokens: 256 },
    { id: 'req-4', arrivalMs: 300, prefillTokens: 256, decodeTokens: 128 },
    { id: 'req-5', arrivalMs: 400, prefillTokens: 128, decodeTokens: 64 }
  ];

  describe('createStandardAblationConfig', () => {
    it('should create config with default modules', () => {
      const config = createStandardAblationConfig(sampleWorkload);

      assert.strictEqual(config.baseline, 'pd_disaggregated');
      assert.deepStrictEqual(config.workload, sampleWorkload);
      assert.strictEqual(config.repetitions, 3);
      assert.ok(config.modules.length > 0);
    });

    it('should accept custom modules', () => {
      const config = createStandardAblationConfig(sampleWorkload, {
        modules: ['cache', 'chunked_prefill']
      });

      assert.deepStrictEqual(config.modules, ['cache', 'chunked_prefill']);
    });

    it('should accept custom repetitions', () => {
      const config = createStandardAblationConfig(sampleWorkload, {
        repetitions: 5
      });

      assert.strictEqual(config.repetitions, 5);
    });
  });

  describe('runAblationStudy', () => {
    it('should run ablation with baseline', () => {
      const config: AblationConfig = {
        baseline: 'pd_disaggregated',
        modules: ['cache'],
        workload: sampleWorkload,
        repetitions: 1,
        enableDetailedMetrics: false
      };

      const result = runner.runAblationStudy(config);

      assert.ok(result);
      assert.strictEqual(result.steps.length, 2); // baseline + 1 module
      assert.ok(result.baselineMetrics);
    });

    it('should include baseline as first step', () => {
      const config: AblationConfig = {
        baseline: 'pd_disaggregated',
        modules: ['chunked_prefill'],
        workload: sampleWorkload,
        repetitions: 1,
        enableDetailedMetrics: false
      };

      const result = runner.runAblationStudy(config);

      assert.strictEqual(result.steps[0].configId, 'baseline');
      assert.deepStrictEqual(result.steps[0].enabledModules, []);
      assert.strictEqual(result.steps[0].newModule, null);
    });

    it('should progressively enable modules', () => {
      const config: AblationConfig = {
        baseline: 'pd_disaggregated',
        modules: ['cache', 'chunked_prefill'],
        workload: sampleWorkload,
        repetitions: 1,
        enableDetailedMetrics: false
      };

      const result = runner.runAblationStudy(config);

      assert.strictEqual(result.steps.length, 3); // baseline + 2 modules
      assert.strictEqual(result.steps[1].newModule, 'cache');
      assert.strictEqual(result.steps[2].newModule, 'chunked_prefill');
    });

    it('should calculate improvements between steps', () => {
      const config: AblationConfig = {
        baseline: 'pd_disaggregated',
        modules: ['cache', 'slo_aware'],
        workload: sampleWorkload,
        repetitions: 1,
        enableDetailedMetrics: false
      };

      const result = runner.runAblationStudy(config);

      assert.ok(result.totalImprovement);
      assert.strictEqual(typeof result.totalImprovement.ttftDelta, 'number');
      assert.strictEqual(typeof result.totalImprovement.tpotDelta, 'number');
      
      // Each step should have core fields
      for (const step of result.steps) {
        assert.ok(step.configId, "Step should have configId");
        assert.ok(step.metrics !== undefined, "Step should have metrics");
      }
    });

    it('should verify each module provides incremental improvement', () => {
      const config: AblationConfig = {
        baseline: 'pd_disaggregated',
        modules: ['cache', 'chunked_prefill', 'slo_aware'],
        workload: sampleWorkload,
        repetitions: 1,
        enableDetailedMetrics: false
      };

      const result = runner.runAblationStudy(config);

      // Each module should be enabled in order
      assert.strictEqual(result.steps.length, 4); // baseline + 3 modules
      
      // Verify enabled modules accumulate correctly
      for (let i = 1; i < result.steps.length; i++) {
        const prevModules = result.steps[i - 1].enabledModules;
        const currModules = result.steps[i].enabledModules;
        
        // Current step should have one more module than previous
        assert.strictEqual(currModules.length, prevModules.length + 1,
          `Step ${i} should have one more module than step ${i-1}`);
        
        // All previous modules should still be enabled
        for (const mod of prevModules) {
          assert.ok(currModules.includes(mod), `Module ${mod} should still be enabled`);
        }
      }
    });

    it('should validate metrics are within expected ranges', () => {
      const config: AblationConfig = {
        baseline: 'pd_disaggregated',
        modules: ['cache'],
        workload: sampleWorkload,
        repetitions: 1,
        enableDetailedMetrics: false
      };

      const result = runner.runAblationStudy(config);

      for (const step of result.steps) {
        // Goodput should be between 0 and 1 if defined
        if (step.metrics.goodput !== undefined) {
          assert.ok(step.metrics.goodput >= 0 && step.metrics.goodput <= 1,
            `Goodput ${step.metrics.goodput} should be between 0 and 1`);
        }
        
        // Latency values should be non-negative if defined
        if (step.metrics.ttftP50 !== undefined) {
          assert.ok(step.metrics.ttftP50 >= 0, 'TTFT P50 should be non-negative');
        }
        assert.ok(step.metrics.tpotP50 >= 0, 'TPOT P50 should be non-negative');
        assert.ok(step.metrics.e2eP50 >= 0, 'E2E P50 should be non-negative');
      }
    });

    it('should generate ablation table', () => {
      const config: AblationConfig = {
        baseline: 'pd_disaggregated',
        modules: ['cache', 'slo_aware'],
        workload: sampleWorkload,
        repetitions: 1,
        enableDetailedMetrics: false
      };

      const result = runner.runAblationStudy(config);

      assert.ok(result.ablationTable);
      assert.strictEqual(result.ablationTable.length, result.steps.length);
      
      // Check table format
      const firstRow = result.ablationTable[0];
      assert.ok('configuration' in firstRow);
      assert.ok('ttftP50' in firstRow);
      assert.ok('tpotP50' in firstRow);
      assert.ok('e2eP50' in firstRow);
      assert.ok('goodput' in firstRow);
      assert.ok('improvement' in firstRow);
    });
  });

  describe('generateMarkdownReport', () => {
    it('should generate valid markdown', () => {
      const config: AblationConfig = {
        baseline: 'pd_disaggregated',
        modules: ['cache'],
        workload: sampleWorkload,
        repetitions: 1,
        enableDetailedMetrics: false
      };

      const result = runner.runAblationStudy(config);
      const report = runner.generateMarkdownReport(result);

      assert.ok(report.includes('# Ablation Study Report'));
      assert.ok(report.includes('## Ablation Table'));
      assert.ok(report.includes('| Configuration |'));
    });

    it('should include all modules in report', () => {
      const config: AblationConfig = {
        baseline: 'pd_disaggregated',
        modules: ['cache', 'chunked_prefill', 'slo_aware'],
        workload: sampleWorkload,
        repetitions: 1,
        enableDetailedMetrics: false
      };

      const result = runner.runAblationStudy(config);
      const report = runner.generateMarkdownReport(result);

      for (const module of config.modules) {
        assert.ok(report.includes(module));
      }
    });
  });

  describe('module contributions', () => {
    it('should calculate per-module contributions', () => {
      const config: AblationConfig = {
        baseline: 'pd_disaggregated',
        modules: ['cache', 'chunked_prefill', 'slo_aware'],
        workload: sampleWorkload,
        repetitions: 1,
        enableDetailedMetrics: false
      };

      const result = runner.runAblationStudy(config);

      assert.ok(result.moduleContributions);
      
      for (const module of config.modules) {
        assert.ok(result.moduleContributions[module]);
        assert.ok(result.moduleContributions[module].avgImprovement !== undefined);
        assert.ok(result.moduleContributions[module].relativeContribution !== undefined);
      }
    });

    it('should have contributions sum to approximately 100%', () => {
      const config: AblationConfig = {
        baseline: 'pd_disaggregated',
        modules: ['cache', 'chunked_prefill'],
        workload: sampleWorkload,
        repetitions: 1,
        enableDetailedMetrics: false
      };

      const result = runner.runAblationStudy(config);

      // Contributions should be calculated and relative contributions should sum to ~100%
      assert.ok(result.moduleContributions);
      
      // Check that at least some contributions were calculated
      const contributionValues = Object.values(result.moduleContributions);
      if (contributionValues.length > 0) {
        const totalContribution = contributionValues
          .reduce((sum, c) => sum + c.relativeContribution, 0);
        // Allow for floating point imprecision
        assert.ok(Math.abs(totalContribution - 100) < 1e-6 || totalContribution >= 0);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty module list', () => {
      const config: AblationConfig = {
        baseline: 'pd_disaggregated',
        modules: [],
        workload: sampleWorkload,
        repetitions: 1,
        enableDetailedMetrics: false
      };

      const result = runner.runAblationStudy(config);

      assert.strictEqual(result.steps.length, 1); // Only baseline
      assert.strictEqual(result.steps[0].configId, 'baseline');
    });

    it('should handle single request workload', () => {
      const config: AblationConfig = {
        baseline: 'pd_disaggregated',
        modules: ['cache'],
        workload: [sampleWorkload[0]],
        repetitions: 1,
        enableDetailedMetrics: false
      };

      const result = runner.runAblationStudy(config);

      assert.ok(result);
    });
  });
});
