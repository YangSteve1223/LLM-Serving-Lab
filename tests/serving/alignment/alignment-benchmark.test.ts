/**
 * Tests for AlignmentBenchmark.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { AlignmentBenchmark } from '../../../src/agents/learningAssistant/serving/alignment/AlignmentBenchmark.ts';

describe('AlignmentBenchmark', () => {
  let benchmark: AlignmentBenchmark;

  beforeEach(() => {
    benchmark = new AlignmentBenchmark({
      numRequests: 20,
      avgPrefillTokens: 256,
      avgDecodeTokens: 64,
      numRuns: 2,
      enableDetailedMetrics: false
    });
  });

  it('should run benchmark and compare strategies', async () => {
    const result = await benchmark.run();
    
    assert.ok(result.runId, 'Should have run ID');
    assert.ok(result.timestamp, 'Should have timestamp');
    assert.ok(result.strategies.radix, 'Should have radix results');
    assert.ok(result.strategies.hashBased, 'Should have hash-based results');
    assert.ok(result.strategies.sglangLSP, 'Should have SGLang LSP results');
  });

  it('should determine winners correctly', async () => {
    const result = await benchmark.run();
    
    assert.ok(result.winner.hitRate, 'Should have hit rate winner');
    assert.ok(result.winner.latency, 'Should have latency winner');
    assert.ok(result.winner.memory, 'Should have memory winner');
    assert.ok(result.winner.overall, 'Should have overall winner');
  });

  it('should generate comparison table', async () => {
    const result = await benchmark.run();
    
    assert.ok(result.comparisonTable.length > 0, 'Should have comparison table');
    
    const firstRow = result.comparisonTable[0];
    assert.ok(firstRow.metric, 'Should have metric name');
    assert.ok(firstRow.radix !== undefined, 'Should have radix value');
    assert.ok(firstRow.hashBased !== undefined, 'Should have hash-based value');
    assert.ok(firstRow.sglangLSP !== undefined, 'Should have SGLang LSP value');
    assert.ok(firstRow.best, 'Should have best strategy');
  });

  it('should generate recommendations', async () => {
    const result = await benchmark.run();
    
    assert.ok(result.recommendations.length > 0, 'Should have recommendations');
    assert.ok(result.recommendations.every(r => typeof r === 'string'), 'All recommendations should be strings');
  });

  it('should generate markdown report', async () => {
    const result = await benchmark.run();
    const report = benchmark.generateReport(result);
    
    assert.ok(report.includes('Cache Strategy Alignment Benchmark'), 'Should include title');
    assert.ok(report.includes('Radix Tree'), 'Should mention Radix Tree');
    assert.ok(report.includes('Hash-Based'), 'Should mention Hash-Based');
    assert.ok(report.includes('SGLang LSP'), 'Should mention SGLang LSP');
  });
});
