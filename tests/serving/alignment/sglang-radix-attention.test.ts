/**
 * Tests for SGLangRadixAttentionSimulator.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SGLangRadixAttentionSimulator } from '../../../src/agents/learningAssistant/serving/alignment/SGLangRadixAttentionSimulator.ts';
import type { PDWorkloadRequest } from '../../../src/agents/learningAssistant/serving/ServingTrace.ts';

describe('SGLangRadixAttentionSimulator', () => {
  let simulator: SGLangRadixAttentionSimulator;

  beforeEach(() => {
    simulator = new SGLangRadixAttentionSimulator({
      enableLSPFirst: true,
      enableCompressedFSM: true,
      maxBatchSize: 8,
      stepBudgetMs: 100,
      prefillChunkSize: 256,
      slo: { ttftMs: 2000, tpotMs: 150, e2eMs: 15000 },
      maxSteps: 500
    });
  });

  it('should run LSP-First scheduling', () => {
    const workload: PDWorkloadRequest[] = [
      { id: 'req1', arrivalMs: 0, prefillTokens: 512, decodeTokens: 64 },
      { id: 'req2', arrivalMs: 100, prefillTokens: 512, decodeTokens: 64 },
      { id: 'req3', arrivalMs: 200, prefillTokens: 256, decodeTokens: 32 }
    ];
    
    const result = simulator.runScheduling(workload, 'sglang_lsp');
    
    assert.ok(result.requestCount === 3, 'Should process all requests');
    assert.ok(result.latency.ttftP50 >= 0, 'Should have TTFT metrics');
    assert.ok(result.cacheMetrics.avgCacheHitRatio >= 0, 'Should have cache metrics');
    assert.ok(result.schedulingDecisions.length > 0, 'Should have scheduling decisions');
  });

  it('should compute average shared prefix depth', () => {
    const workload: PDWorkloadRequest[] = [
      { id: 'req1', arrivalMs: 0, prefillTokens: 1024, decodeTokens: 128 },
      { id: 'req2', arrivalMs: 50, prefillTokens: 1024, decodeTokens: 128 }
    ];
    
    const result = simulator.runScheduling(workload, 'sglang_lsp');
    
    assert.ok(result.cacheMetrics.avgSharedPrefixDepth >= 0, 'Should track shared prefix depth');
  });

  it('should simulate compressed FSM', () => {
    const tokens = Array.from({ length: 1000 }, (_, i) => i % 100);
    
    const result = simulator.simulateCompressedFSM(tokens);
    
    assert.ok(result.compressedLength > 0, 'Should have compressed length');
    assert.ok(result.compressionRatio > 1, 'Should compress redundant tokens');
    assert.ok(result.stateTransitions > 0, 'Should track state transitions');
  });

  it('should handle empty workload', () => {
    const result = simulator.runScheduling([], 'sglang_lsp');
    
    assert.strictEqual(result.requestCount, 0, 'Should handle empty workload');
    assert.strictEqual(result.goodput, 0, 'Goodput should be 0 for empty workload');
  });

  it('should compute TTFT reduction from cache', () => {
    const workload: PDWorkloadRequest[] = [
      { id: 'req1', arrivalMs: 0, prefillTokens: 512, decodeTokens: 64 },
      { id: 'req2', arrivalMs: 100, prefillTokens: 512, decodeTokens: 64 }
    ];
    
    const result = simulator.runScheduling(workload, 'sglang_lsp');
    
    assert.ok(result.cacheMetrics.ttftReductionMs >= 0, 'Should compute TTFT reduction');
    assert.ok(result.cacheMetrics.prefillTokensSaved >= 0, 'Should compute tokens saved');
  });
});
