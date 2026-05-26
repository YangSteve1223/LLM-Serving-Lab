/**
 * Tests for AlignmentBenchmark with strengthened assertions
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
    
    // STRENGTHENED: Check specific fields and types
    assert.strictEqual(typeof result.runId, 'string', 'Should have string run ID');
    assert.ok(result.runId.startsWith('bench_'), 'Run ID should start with bench_');
    
    assert.strictEqual(typeof result.timestamp, 'string', 'Should have string timestamp');
    assert.ok(result.timestamp.includes('T'), 'Timestamp should be ISO format');
    assert.ok(new Date(result.timestamp).getTime() > 0, 'Timestamp should be valid date');
    
    // Check strategy results structure with specific field validation
    assert.strictEqual(typeof result.strategies.radix.strategyName, 'string', 
      'Radix should have strategy name');
    assert.strictEqual(result.strategies.radix.strategyName, 'Radix Tree',
      'Radix strategy name should be "Radix Tree"');
    
    assert.strictEqual(typeof result.strategies.hashBased.strategyName, 'string',
      'Hash-based should have strategy name');
    assert.strictEqual(result.strategies.hashBased.strategyName, 'Hash-Based',
      'Hash-based strategy name should be "Hash-Based"');
    
    assert.strictEqual(typeof result.strategies.sglangLSP.strategyName, 'string',
      'SGLang LSP should have strategy name');
    assert.strictEqual(result.strategies.sglangLSP.strategyName, 'SGLang LSP',
      'SGLang strategy name should be "SGLang LSP"');
  });

  it('should have valid metrics for each strategy', async () => {
    const result = await benchmark.run();
    
    for (const [name, metrics] of Object.entries(result.strategies)) {
      // STRENGTHENED: Verify specific numeric ranges
      assert.strictEqual(typeof metrics.hitRate, 'number', `${name} hitRate should be number`);
      assert.ok(metrics.hitRate >= 0, `${name} hitRate should be >= 0`);
      assert.ok(metrics.hitRate <= 1, `${name} hitRate should be <= 1`);
      
      assert.strictEqual(typeof metrics.tokenHitRate, 'number', `${name} tokenHitRate should be number`);
      assert.ok(metrics.tokenHitRate >= 0, `${name} tokenHitRate should be >= 0`);
      assert.ok(metrics.tokenHitRate <= 1, `${name} tokenHitRate should be <= 1`);
      
      assert.strictEqual(typeof metrics.avgLatencyMs, 'number', `${name} avgLatencyMs should be number`);
      assert.ok(metrics.avgLatencyMs >= 0, `${name} avgLatencyMs should be >= 0`);
      assert.ok(metrics.avgLatencyMs < 100000, `${name} avgLatencyMs should be reasonable (<100s)`);
      
      assert.strictEqual(typeof metrics.memoryUsageMB, 'number', `${name} memoryUsageMB should be number`);
      assert.ok(metrics.memoryUsageMB >= 0, `${name} memoryUsageMB should be >= 0`);
      assert.ok(metrics.memoryUsageMB < 100000, `${name} memoryUsageMB should be reasonable`);
      
      assert.strictEqual(typeof metrics.prefillTokensSaved, 'number', `${name} prefillTokensSaved should be number`);
      assert.ok(metrics.prefillTokensSaved >= 0, `${name} prefillTokensSaved should be >= 0`);
      
      assert.strictEqual(typeof metrics.ttftReductionMs, 'number', `${name} ttftReductionMs should be number`);
      assert.ok(metrics.ttftReductionMs >= 0, `${name} ttftReductionMs should be >= 0`);
      
      // TTFT reduction should correlate with tokens saved
      assert.ok(
        Math.abs(metrics.ttftReductionMs - metrics.prefillTokensSaved * 0.18) < 10,
        `${name} TTFT reduction should roughly equal tokensSaved * 0.18`
      );
    }
  });

  it('should determine winners correctly', async () => {
    const result = await benchmark.run();
    
    // STRENGTHENED: Verify winner fields are specific valid strategy names
    const validWinners = ['Radix Tree', 'Hash-Based', 'SGLang LSP', 'tie'];
    
    assert.strictEqual(typeof result.winner.hitRate, 'string', 'hitRate winner should be string');
    assert.ok(validWinners.includes(result.winner.hitRate), 
      `hitRate winner should be one of: ${validWinners.join(', ')}`);
    
    assert.strictEqual(typeof result.winner.latency, 'string', 'latency winner should be string');
    assert.ok(validWinners.includes(result.winner.latency),
      `latency winner should be one of: ${validWinners.join(', ')}`);
    
    assert.strictEqual(typeof result.winner.memory, 'string', 'memory winner should be string');
    assert.ok(validWinners.includes(result.winner.memory),
      `memory winner should be one of: ${validWinners.join(', ')}`);
    
    assert.strictEqual(typeof result.winner.overall, 'string', 'overall winner should be string');
    assert.ok(validWinners.includes(result.winner.overall),
      `overall winner should be one of: ${validWinners.join(', ')}`);
  });

  it('should generate comparison table', async () => {
    const result = await benchmark.run();
    
    assert.ok(result.comparisonTable.length > 0, 'Should have comparison table');
    
    for (const row of result.comparisonTable) {
      assert.strictEqual(typeof row.metric, 'string', 'Metric name should be string');
      assert.ok(row.metric.length > 0, 'Metric name should not be empty');
      
      // Verify all three strategy values exist
      assert.ok(
        row.radix !== undefined && row.radix !== null,
        'Should have radix value'
      );
      assert.ok(
        row.hashBased !== undefined && row.hashBased !== null,
        'Should have hash-based value'
      );
      assert.ok(
        row.sglangLSP !== undefined && row.sglangLSP !== null,
        'Should have SGLang LSP value'
      );
      
      // Verify 'best' field
      assert.strictEqual(typeof row.best, 'string', 'Best strategy should be string');
      assert.ok(validWinners.includes(row.best) || row.best === 'any',
        `Best should be valid strategy name, got: ${row.best}`);
    }
  });

  it('should generate recommendations', async () => {
    const result = await benchmark.run();
    
    assert.ok(result.recommendations.length > 0, 'Should have recommendations');
    assert.ok(result.recommendations.every(r => typeof r === 'string'), 
      'All recommendations should be strings');
    
    // STRENGTHENED: Check recommendation content
    for (const rec of result.recommendations) {
      assert.ok(rec.length > 10, 'Recommendation should be substantive');
      // Should not be empty recommendations
      assert.ok(!rec.includes('TODO'), 'Should not contain TODO placeholder');
    }
  });

  it('should generate markdown report', async () => {
    const result = await benchmark.run();
    const report = benchmark.generateReport(result);
    
    assert.ok(report.includes('Cache Strategy Alignment Benchmark'), 
      'Should include title');
    assert.ok(report.includes('## Configuration'), 'Should include config section');
    assert.ok(report.includes('## Results'), 'Should include results section');
    assert.ok(report.includes('## Recommendations'), 'Should include recommendations section');
    
    // STRENGTHENED: Verify specific content
    assert.ok(report.includes('Radix Tree'), 'Should mention Radix Tree');
    assert.ok(report.includes('Hash-Based'), 'Should mention Hash-Based');
    assert.ok(report.includes('SGLang LSP'), 'Should mention SGLang LSP');
    
    // Should include metrics table
    assert.ok(report.includes('| Metric |'), 'Should have metric table');
  });

  it('should have consistent runId and timestamp format', async () => {
    const result = await benchmark.run();
    
    // Run ID format: bench_<timestamp>
    assert.ok(/^bench_\d+$/.test(result.runId), 
      'Run ID should match pattern: bench_<digits>');
    
    // Timestamp should be parseable
    const timestamp = new Date(result.timestamp);
    assert.ok(!isNaN(timestamp.getTime()), 'Timestamp should be valid date');
    
    // Timestamp should be recent (within a year)
    const now = Date.now();
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
    assert.ok(timestamp.getTime() > oneYearAgo, 'Timestamp should be recent');
  });

  it('should reflect workload configuration in results', async () => {
    const customBenchmark = new AlignmentBenchmark({
      numRequests: 50,
      avgPrefillTokens: 512,
      avgDecodeTokens: 128,
      numRuns: 3,
      enableDetailedMetrics: true
    });
    
    const result = await customBenchmark.run();
    
    // Config should be reflected in result
    assert.strictEqual(result.config.numRequests, 50, 'Should have correct numRequests');
    assert.strictEqual(result.config.avgPrefillTokens, 512, 'Should have correct avgPrefillTokens');
    assert.strictEqual(result.config.avgDecodeTokens, 128, 'Should have correct avgDecodeTokens');
    assert.strictEqual(result.config.numRuns, 3, 'Should have correct numRuns');
    assert.strictEqual(result.config.enableDetailedMetrics, true, 'Should have detailed metrics enabled');
  });
});
