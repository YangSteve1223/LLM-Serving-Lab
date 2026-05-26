/**
 * Tests for EngineBenchmarkRunner
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EngineBenchmarkRunner, renderEngineBenchmarkReport } from '../../src/agents/learningAssistant/serving/engines/EngineBenchmarkRunner.ts';
import type { EngineBenchmarkConfig, EngineBenchmarkRequest } from '../../src/agents/learningAssistant/serving/engines/EngineBenchmarkTypes.ts';

describe('EngineBenchmarkRunner', () => {
  let runner: EngineBenchmarkRunner;

  beforeEach(() => {
    runner = new EngineBenchmarkRunner();
  });

  describe('constructor', () => {
    it('should create instance without errors', () => {
      assert.ok(runner instanceof EngineBenchmarkRunner, 'Should be instance of EngineBenchmarkRunner');
    });
  });

  describe('buildSyntheticRequests', () => {
    it('should build requests for single policy', () => {
      const requests = runner.buildSyntheticRequests(5, ['full']);
      
      assert.strictEqual(requests.length, 5, 'Should create 5 requests');
      assert.ok(requests.every(r => r.policy === 'full'), 'All should have full policy');
    });

    it('should build requests for multiple policies', () => {
      const requests = runner.buildSyntheticRequests(3, ['full', 'cache_first', 'evidence_top_k']);
      
      assert.strictEqual(requests.length, 9, 'Should create 3 requests per policy');
      
      const byPolicy = {
        full: requests.filter(r => r.policy === 'full'),
        cache_first: requests.filter(r => r.policy === 'cache_first'),
        evidence_top_k: requests.filter(r => r.policy === 'evidence_top_k')
      };
      
      assert.strictEqual(byPolicy.full.length, 3);
      assert.strictEqual(byPolicy.cache_first.length, 3);
      assert.strictEqual(byPolicy.evidence_top_k.length, 3);
    });

    it('should generate unique IDs for requests', () => {
      const requests = runner.buildSyntheticRequests(10, ['full']);
      const ids = requests.map(r => r.id);
      
      const uniqueIds = new Set(ids);
      assert.strictEqual(uniqueIds.size, ids.length, 'All IDs should be unique');
    });

    it('should include valid prompt in requests', () => {
      const requests = runner.buildSyntheticRequests(5, ['full']);
      
      for (const req of requests) {
        assert.ok(typeof req.prompt === 'string', 'Prompt should be a string');
        assert.ok(req.prompt.length > 0, 'Prompt should not be empty');
        assert.ok(req.prompt.includes('Context policy'), 'Prompt should include policy');
        assert.ok(req.prompt.includes('Current page'), 'Prompt should include page info');
      }
    });

    it('should set expectedOutputTokens', () => {
      const requests = runner.buildSyntheticRequests(3, ['full']);
      
      for (const req of requests) {
        assert.strictEqual(typeof req.expectedOutputTokens, 'number', 'Should have output tokens');
        assert.ok(req.expectedOutputTokens! > 0, 'Output tokens should be positive');
      }
    });

    it('should include token accounting in requests', () => {
      const requests = runner.buildSyntheticRequests(3, ['full']);
      
      for (const req of requests) {
        assert.ok(req.tokenAccounting, 'Should have token accounting');
        assert.ok(typeof req.tokenAccounting.stablePrefixTokens === 'number', 
          'Should have stable prefix tokens');
        assert.ok(typeof req.promptTokensEstimate === 'number', 'Should have prompt tokens estimate');
      }
    });

    it('should include token savings estimates for cache_first', () => {
      const requests = runner.buildSyntheticRequests(3, ['cache_first']);
      
      for (const req of requests) {
        assert.ok(req.tokenAccounting.estimatedTokenSavingsAtCacheHitRates, 
          'Cache-first should have token savings estimates');
        const savings = req.tokenAccounting.estimatedTokenSavingsAtCacheHitRates!;
        assert.ok(typeof savings.hitRate25 === 'number', 'Should have 25% hit rate estimate');
        assert.ok(typeof savings.hitRate50 === 'number', 'Should have 50% hit rate estimate');
        assert.ok(typeof savings.hitRate75 === 'number', 'Should have 75% hit rate estimate');
        assert.ok(typeof savings.hitRate90 === 'number', 'Should have 90% hit rate estimate');
      }
    });

    it('should have valid stable prefix tokens estimate', () => {
      const requests = runner.buildSyntheticRequests(5, ['full', 'cache_first']);
      
      for (const req of requests) {
        assert.ok(req.stablePrefixTokensEstimate >= 0, 'Stable prefix should be non-negative');
        assert.ok(req.stablePrefixTokensEstimate <= req.promptTokensEstimate,
          'Stable prefix should not exceed total');
      }
    });

    it('should handle current_page_only policy', () => {
      const requests = runner.buildSyntheticRequests(3, ['current_page_only']);
      
      for (const req of requests) {
        assert.strictEqual(req.policy, 'current_page_only');
        // current_page_only should have fewer tokens
        assert.ok(req.promptTokensEstimate > 0);
      }
    });

    it('should generate 0 requests gracefully', () => {
      const requests = runner.buildSyntheticRequests(0, ['full']);
      
      assert.strictEqual(requests.length, 0, 'Should return empty array');
    });

    it('should generate for empty policies array', () => {
      const requests = runner.buildSyntheticRequests(5, []);
      
      assert.strictEqual(requests.length, 0, 'Should return empty array');
    });
  });

  describe('requestsFromTraces', () => {
    it('should convert traces to requests', () => {
      const traces = [
        {
          requestId: 'trace_1',
          tokenEstimate: {
            estimatedPrefillTokens: 500,
            estimatedDecodeTokens: 100,
            cacheablePrefixTokens: 200,
            selectedEvidenceTokens: 50
          }
        },
        {
          requestId: 'trace_2',
          tokenEstimate: {
            estimatedPrefillTokens: 300,
            estimatedDecodeTokens: 80,
            cacheablePrefixTokens: 150,
            selectedEvidenceTokens: 30
          }
        }
      ] as any[];

      const requests = runner.requestsFromTraces(traces, ['full', 'cache_first']);
      
      assert.strictEqual(requests.length, 4, 'Should create 2 requests per policy');
      
      const fullRequests = requests.filter(r => r.policy === 'full');
      assert.strictEqual(fullRequests.length, 2);
      
      // Check first trace converted correctly
      assert.ok(fullRequests[0].id.includes('trace_1'));
    });

    it('should include cache-aware prompt info when available', () => {
      const traces = [
        {
          requestId: 'trace_1',
          tokenEstimate: {
            estimatedPrefillTokens: 400,
            estimatedDecodeTokens: 80,
            cacheablePrefixTokens: 200
          },
          cacheAwarePrompt: {
            stablePrefixTokens: 150,
            dynamicSuffixTokens: 50,
            cachePrediction: {
              cacheablePrefixTokensEstimate: 180
            }
          }
        }
      ] as any[];

      const requests = runner.requestsFromTraces(traces, ['cache_first']);
      
      assert.strictEqual(requests.length, 1);
      assert.ok(requests[0].tokenAccounting.stablePrefixTokens !== undefined);
    });
  });

  describe('dryRunReport', () => {
    it('should generate report for dry run', () => {
      const config: EngineBenchmarkConfig = {
        engine: 'vllm',
        stream: false,
        source: 'synthetic',
        requestCount: 10,
        qps: 1,
        concurrency: 1,
        policies: ['full', 'cache_first'],
        dryRun: true
      };

      const requests = runner.buildSyntheticRequests(5, config.policies);
      const report = runner.dryRunReport(config, requests);

      assert.strictEqual(report.config.dryRun, true, 'Report should indicate dry run');
      assert.strictEqual(report.workload.requestCount, 10, 'Should have correct request count');
      assert.strictEqual(report.summaries.length, 2, 'Should have summary per policy');
    });

    it('should include latency availability in dry run report', () => {
      const config: EngineBenchmarkConfig = {
        engine: 'sglang',
        stream: false,
        source: 'synthetic',
        requestCount: 5,
        qps: 1,
        concurrency: 1,
        policies: ['full'],
        dryRun: true
      };

      const requests = runner.buildSyntheticRequests(5, config.policies);
      const report = runner.dryRunReport(config, requests);

      const summary = report.summaries[0];
      assert.strictEqual(summary.latencyMeasurementMode, 'dry_run_unmeasured');
      assert.strictEqual(summary.latencyAvailability.ttft, 'unavailable');
      assert.strictEqual(summary.latencyAvailability.itl, 'unavailable');
      assert.strictEqual(summary.latencyAvailability.e2e, 'unavailable');
    });

    it('should calculate workload success rate', () => {
      const config: EngineBenchmarkConfig = {
        engine: 'vllm',
        stream: false,
        source: 'synthetic',
        requestCount: 3,
        qps: 1,
        concurrency: 1,
        policies: ['full'],
        dryRun: true
      };

      const requests = runner.buildSyntheticRequests(3, config.policies);
      const report = runner.dryRunReport(config, requests);

      for (const summary of report.summaries) {
        assert.ok(summary.workloadSuccessRate >= 0 && summary.workloadSuccessRate <= 1,
          'Success rate should be valid');
        assert.strictEqual(summary.successRate, 1, 'All dry run requests should succeed');
      }
    });

    it('should include token accounting metrics', () => {
      const config: EngineBenchmarkConfig = {
        engine: 'vllm',
        stream: false,
        source: 'synthetic',
        requestCount: 5,
        qps: 1,
        concurrency: 1,
        policies: ['cache_first'],
        dryRun: true
      };

      const requests = runner.buildSyntheticRequests(5, config.policies);
      const report = runner.dryRunReport(config, requests);

      const summary = report.summaries[0];
      assert.ok(typeof summary.promptTokensAvg === 'number', 'Should have avg prompt tokens');
      assert.ok(typeof summary.promptTokensP90 === 'number', 'Should have P90 prompt tokens');
      assert.ok(summary.promptTokensAvg! <= summary.promptTokensP90!,
        'Average should be <= P90');
    });

    it('should include interpretation and notes', () => {
      const config: EngineBenchmarkConfig = {
        engine: 'vllm',
        stream: false,
        source: 'synthetic',
        requestCount: 3,
        qps: 1,
        concurrency: 1,
        policies: ['full'],
        dryRun: true
      };

      const requests = runner.buildSyntheticRequests(3, config.policies);
      const report = runner.dryRunReport(config, requests);

      assert.ok(Array.isArray(report.interpretation), 'Should have interpretation');
      assert.ok(Array.isArray(report.notes), 'Should have notes');
      assert.ok(report.notes.some(n => n.includes('Dry-run')), 
        'Should mention dry-run in notes');
    });
  });

  describe('renderEngineBenchmarkReport', () => {
    it('should render markdown report', () => {
      const config: EngineBenchmarkConfig = {
        engine: 'vllm',
        stream: true,
        source: 'synthetic',
        requestCount: 5,
        qps: 1,
        concurrency: 1,
        policies: ['full', 'cache_first'],
        dryRun: true
      };

      const requests = runner.buildSyntheticRequests(5, config.policies);
      const report = runner.dryRunReport(config, requests);
      const markdown = renderEngineBenchmarkReport(report);

      assert.ok(markdown.includes('# SOTA Engine Bridge Benchmark'), 'Should include title');
      assert.ok(markdown.includes('Engine Config'), 'Should include config section');
      assert.ok(markdown.includes('Workload Summary'), 'Should include workload summary');
      assert.ok(markdown.includes('Policy Results'), 'Should include results section');
    });

    it('should include policy comparison table', () => {
      const config: EngineBenchmarkConfig = {
        engine: 'sglang',
        stream: true,
        source: 'synthetic',
        requestCount: 5,
        qps: 1,
        concurrency: 1,
        policies: ['full', 'evidence_top_k'],
        dryRun: true
      };

      const requests = runner.buildSyntheticRequests(5, config.policies);
      const report = runner.dryRunReport(config, requests);
      const markdown = renderEngineBenchmarkReport(report);

      assert.ok(markdown.includes('| Policy |'), 'Should have policy column');
      assert.ok(markdown.includes('| full |'), 'Should list full policy');
      assert.ok(markdown.includes('| evidence_top_k |'), 'Should list evidence policy');
    });

    it('should indicate when dry run', () => {
      const config: EngineBenchmarkConfig = {
        engine: 'vllm',
        stream: false,
        source: 'synthetic',
        requestCount: 5,
        qps: 1,
        concurrency: 1,
        policies: ['full'],
        dryRun: true
      };

      const requests = runner.buildSyntheticRequests(5, config.policies);
      const report = runner.dryRunReport(config, requests);
      const markdown = renderEngineBenchmarkReport(report);

      assert.ok(markdown.includes('Dry run: yes'), 'Should indicate dry run');
      assert.ok(markdown.includes('Warning:'), 'Should include warning about dry run limitations');
    });

    it('should include latency availability section', () => {
      const config: EngineBenchmarkConfig = {
        engine: 'vllm',
        stream: false,
        source: 'synthetic',
        requestCount: 3,
        qps: 1,
        concurrency: 1,
        policies: ['full'],
        dryRun: true
      };

      const requests = runner.buildSyntheticRequests(3, config.policies);
      const report = runner.dryRunReport(config, requests);
      const markdown = renderEngineBenchmarkReport(report);

      assert.ok(markdown.includes('## Latency Availability'), 'Should have latency section');
      assert.ok(markdown.includes('ttft=unavailable'), 'Should show TTFT unavailable');
    });
  });

  describe('edge cases', () => {
    it('should handle very large request count', () => {
      const requests = runner.buildSyntheticRequests(1000, ['full']);
      
      assert.strictEqual(requests.length, 1000, 'Should handle large count');
      assert.ok(requests.every(r => r.prompt.length > 0), 'All should have prompts');
    });

    it('should handle all policy types', () => {
      const allPolicies = ['full', 'cache_first', 'evidence_top_k', 'current_page_only'] as const;
      const requests = runner.buildSyntheticRequests(2, allPolicies);
      
      assert.strictEqual(requests.length, 8, 'Should create for all policies');
      assert.strictEqual(
        new Set(requests.map(r => r.policy)).size, 
        allPolicies.length,
        'Should include all policy types'
      );
    });

    it('should produce consistent results for same seed', () => {
      // Note: Since synthetic context is based on index, results should be deterministic
      const requests1 = runner.buildSyntheticRequests(5, ['full']);
      const requests2 = runner.buildSyntheticRequests(5, ['full']);
      
      // IDs should match for same indices
      for (let i = 0; i < 5; i++) {
        assert.strictEqual(requests1[i].id, requests2[i].id);
      }
    });
  });
});
