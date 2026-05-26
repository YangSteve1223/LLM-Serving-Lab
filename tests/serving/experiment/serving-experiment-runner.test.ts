/**
 * Tests for ServingExperimentRunner.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { 
  ServingExperimentRunner,
  LCR_CONFIG,
  PRC_CONFIG,
  TII_CONFIG,
  BASELINE_STRATEGIES
} from '../../../src/agents/learningAssistant/serving/experiment/ServingExperimentRunner.ts';

describe('ServingExperimentRunner', () => {
  let runner: ServingExperimentRunner;

  beforeEach(() => {
    runner = new ServingExperimentRunner();
  });

  it('should have correct matrix configurations', () => {
    assert.strictEqual(LCR_CONFIG.short.tokens, 256);
    assert.strictEqual(LCR_CONFIG.medium.tokens, 1024);
    assert.strictEqual(LCR_CONFIG.long.tokens, 4096);
    
    assert.strictEqual(PRC_CONFIG.short.tokens, 64);
    assert.strictEqual(PRC_CONFIG.medium.tokens, 256);
    assert.strictEqual(PRC_CONFIG.long.tokens, 1024);
    
    assert.strictEqual(TII_CONFIG.low.rps, 5);
    assert.strictEqual(TII_CONFIG.medium.rps, 20);
    assert.strictEqual(TII_CONFIG.high.rps, 50);
  });

  it('should have all baseline strategies defined', () => {
    assert.strictEqual(BASELINE_STRATEGIES.length, 4, 'Should have 4 strategies');
    
    const names = BASELINE_STRATEGIES.map(s => s.name);
    assert.ok(names.includes('colocation_baseline'));
    assert.ok(names.includes('pd_no_cache'));
    assert.ok(names.includes('pd_cache'));
    assert.ok(names.includes('pd_full'));
  });

  it('should run LCR subset experiment', async () => {
    const results = await runner.runLCRSubset('medium');
    
    // 3 PRC x 3 TII = 9 experiments
    assert.strictEqual(results.length, 9, 'Should have 9 results for LCR subset');
    
    for (const result of results) {
      assert.ok(result.matrix.lcr === 'medium', 'Should have medium LCR');
      assert.ok(result.matrix.prc, 'Should have PRC');
      assert.ok(result.matrix.tii, 'Should have TII');
      assert.ok(result.strategies, 'Should have strategy results');
      assert.ok(result.winner, 'Should have winner');
    }
  });

  it('should compare all baseline strategies', async () => {
    const results = await runner.runLCRSubset('short');
    
    for (const result of results) {
      assert.ok(result.strategies['colocation_baseline'], 'Should have colocation results');
      assert.ok(result.strategies['pd_no_cache'], 'Should have PD no cache results');
      assert.ok(result.strategies['pd_cache'], 'Should have PD cache results');
      assert.ok(result.strategies['pd_full'], 'Should have PD full results');
      
      // Each should have latency metrics
      const strategies = result.strategies;
      for (const name of Object.keys(strategies)) {
        assert.ok(strategies[name].ttftP50 >= 0, `${name} should have TTFT P50`);
        assert.ok(strategies[name].goodput >= 0, `${name} should have goodput`);
      }
    }
  });

  it('should generate comparison table', async () => {
    const results = await runner.runLCRSubset('long');
    
    // Verify comparison table structure
    const comparisonTable = results.map(r => ({
      matrixKey: `${r.matrix.lcr}_${r.matrix.prc}_${r.matrix.tii}`,
      colocation: `${r.strategies['colocation_baseline']?.ttftP50.toFixed(1)}ms`,
      pdFull: `${r.strategies['pd_full']?.ttftP50.toFixed(1)}ms`
    }));
    
    assert.ok(comparisonTable.length === 9, 'Should have 9 table rows');
  });

  it('should generate markdown report for LCR subset', async () => {
    const results = await runner.runLCRSubset('short');
    
    // Create a minimal report structure
    const report = {
      experimentId: 'test_exp',
      generatedAt: new Date().toISOString(),
      config: {
        numRequests: 30,
        repetitions: 2,
        confidenceLevel: 0.95
      },
      results,
      summary: {
        totalExperiments: results.length,
        overallWinner: 'pd_full',
        recommendations: ['Use PD separation for best performance']
      },
      comparisonTable: results.map(r => ({
        matrixKey: `${r.matrix.lcr}_${r.matrix.prc}_${r.matrix.tii}`,
        colocation: `${r.strategies['colocation_baseline']?.ttftP50.toFixed(1)}ms`,
        pdNoCache: `${r.strategies['pd_no_cache']?.ttftP50.toFixed(1)}ms`,
        pdCache: `${r.strategies['pd_cache']?.ttftP50.toFixed(1)}ms`,
        pdFull: `${r.strategies['pd_full']?.ttftP50.toFixed(1)}ms`,
        bestStrategy: r.winner.replace(/_/g, ' ')
      }))
    };
    
    const markdown = runner.generateReport(report);
    
    assert.ok(markdown.includes('Serving Experiment Report'));
    assert.ok(markdown.includes('LCR'));
    assert.ok(markdown.includes('Colocation'));
    assert.ok(markdown.includes('PD Full'));
  });
});
