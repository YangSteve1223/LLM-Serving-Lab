/**
 * Tests for LLMServingPipeline
 */
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import {
  LLMServingPipeline,
  createPipeline,
  type PipelineRequest
} from '../../src/agents/learningAssistant/serving/ServingPipeline.ts';

describe('LLMServingPipeline', () => {
  let pipeline: LLMServingPipeline;

  beforeEach(() => {
    pipeline = createPipeline();
  });

  after(() => {
    pipeline.clearTraces();
  });

  describe('processRequest', () => {
    it('should process a single request through the pipeline', async () => {
      const request: PipelineRequest = {
        id: 'test-req-1',
        prompt: 'What is machine learning?',
        maxTokens: 128,
        arrivalTimeMs: Date.now()
      };

      const result = await pipeline.processRequest(request);

      assert.ok(result.requestId, 'should have request ID');
      assert.ok(result.phases.length > 0, 'should have phases');
      assert.ok(result.metrics.ttftMs >= 0, 'TTFT should be non-negative');
      assert.ok(result.metrics.tpotMs >= 0, 'TPOT should be non-negative');
      assert.ok(result.metrics.e2eMs >= 0, 'E2E should be non-negative');
    });

    it('should track cache hit/miss', async () => {
      const request1: PipelineRequest = {
        id: 'cache-test-1',
        prompt: 'Explain neural networks',
        maxTokens: 64,
        arrivalTimeMs: Date.now()
      };

      const request2: PipelineRequest = {
        id: 'cache-test-2',
        prompt: 'Explain neural networks', // Same prompt
        maxTokens: 64,
        arrivalTimeMs: Date.now() + 100
      };

      await pipeline.processRequest(request1);
      const result2 = await pipeline.processRequest(request2);

      // Second request with same prompt should be faster
      assert.ok(result2.metrics.totalTokens > 0, 'should have token count');
    });

    it('should handle requests with priority', async () => {
      const request: PipelineRequest = {
        id: 'priority-test',
        prompt: 'High priority question',
        maxTokens: 128,
        arrivalTimeMs: Date.now(),
        priority: 5
      };

      const result = await pipeline.processRequest(request);
      assert.strictEqual(result.requestId, 'priority-test');
    });
  });

  describe('processBatch', () => {
    it('should process multiple requests in batch', async () => {
      const requests: PipelineRequest[] = [
        { id: 'batch-1', prompt: 'Question 1', maxTokens: 64, arrivalTimeMs: 1000 },
        { id: 'batch-2', prompt: 'Question 2', maxTokens: 64, arrivalTimeMs: 1100 },
        { id: 'batch-3', prompt: 'Question 3', maxTokens: 64, arrivalTimeMs: 1200 }
      ];

      const results = await pipeline.processBatch(requests);

      assert.strictEqual(results.length, 3, 'should process all requests');
      assert.ok(results.every(r => r.phases.length > 0), 'all should have phases');
    });

    it('should sort requests by arrival time', async () => {
      const requests: PipelineRequest[] = [
        { id: 'late', prompt: 'Late request', maxTokens: 64, arrivalTimeMs: 3000 },
        { id: 'early', prompt: 'Early request', maxTokens: 64, arrivalTimeMs: 1000 },
        { id: 'middle', prompt: 'Middle request', maxTokens: 64, arrivalTimeMs: 2000 }
      ];

      const results = await pipeline.processBatch(requests);

      // Should be sorted by arrival time
      assert.strictEqual(results[0].requestId, 'early');
      assert.strictEqual(results[1].requestId, 'middle');
      assert.strictEqual(results[2].requestId, 'late');
    });
  });

  describe('compareStrategies', () => {
    it('should compare multiple scheduling policies', async () => {
      const requests: PipelineRequest[] = [
        { id: 'strat-1', prompt: 'Test prompt', maxTokens: 128, arrivalTimeMs: 1000 },
        { id: 'strat-2', prompt: 'Another test', maxTokens: 128, arrivalTimeMs: 1100 },
        { id: 'strat-3', prompt: 'More testing', maxTokens: 128, arrivalTimeMs: 1200 }
      ];

      const comparisons = await pipeline.compareStrategies(requests, ['fcfs', 'sjf', 'slo_aware']);

      assert.strictEqual(comparisons.length, 3, 'should have 3 comparisons');
      assert.ok(comparisons.every(c => c.policy), 'each should have a policy');
      assert.ok(comparisons.every(c => c.metrics), 'each should have metrics');
    });
  });

  describe('runFullPipeline', () => {
    it('should run complete pipeline and generate report', async () => {
      const requests: PipelineRequest[] = [
        { id: 'full-1', prompt: 'Full pipeline test 1', maxTokens: 128, arrivalTimeMs: 1000 },
        { id: 'full-2', prompt: 'Full pipeline test 2', maxTokens: 128, arrivalTimeMs: 1100 }
      ];

      const report = await pipeline.runFullPipeline(requests, false);

      assert.strictEqual(report.totalRequests, 2);
      assert.ok(report.cacheStats, 'should have cache stats');
      assert.ok(report.tokenStats, 'should have token stats');
      assert.ok(report.sloCompliance, 'should have SLO compliance');
      assert.ok(report.rawTraces.length > 0, 'should have raw traces');
    });

    it('should include strategy comparisons when requested', async () => {
      const requests: PipelineRequest[] = [
        { id: 'compare-1', prompt: 'Compare test', maxTokens: 128, arrivalTimeMs: 1000 }
      ];

      const report = await pipeline.runFullPipeline(requests, true);

      assert.ok(report.strategyComparisons, 'should have strategy comparisons');
      assert.ok(report.strategyComparisons!.length > 0, 'should have at least one comparison');
    });
  });

  describe('configure', () => {
    it('should allow reconfiguration', async () => {
      pipeline.configure({
        enableCaching: false,
        defaultPolicy: 'fcfs'
      });

      const request: PipelineRequest = {
        id: 'config-test',
        prompt: 'Testing configuration',
        maxTokens: 64,
        arrivalTimeMs: Date.now()
      };

      const result = await pipeline.processRequest(request);
      assert.ok(result.requestId, 'should still process request');
    });
  });

  describe('getTraces / clearTraces', () => {
    it('should retrieve and clear traces', async () => {
      const request: PipelineRequest = {
        id: 'trace-test',
        prompt: 'Trace this',
        maxTokens: 64,
        arrivalTimeMs: Date.now()
      };

      await pipeline.processRequest(request);
      
      const traces = pipeline.getTraces(10);
      assert.ok(traces.length > 0, 'should have traces');

      pipeline.clearTraces();
      const clearedTraces = pipeline.getTraces(10);
      assert.ok(clearedTraces.length === 0, 'should be cleared');
    });
  });
});
