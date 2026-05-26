/**
 * Tests for PDDisaggregationVerifier.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { PDDisaggregationVerifier } from '../../src/agents/learningAssistant/serving/PDDisaggregationVerifier.ts';

describe('PDDisaggregationVerifier', () => {
  let verifier: PDDisaggregationVerifier;
  const testApiKey = 'sk-test-key-for-verification';

  beforeEach(() => {
    verifier = new PDDisaggregationVerifier(testApiKey);
  });

  it('should create verifier with masked API key', async () => {
    const result = await verifier.verifyPrefillHeavyScenario();
    
    assert.ok(result.scenario, 'Should have scenario');
    assert.strictEqual(result.scenario.name, 'prefill_heavy', 'Should be prefill_heavy scenario');
    assert.ok(result.monolithic, 'Should have monolithic timing');
    assert.ok(result.pdDisaggregated, 'Should have PD timing');
  });

  it('should calculate improvement percentages', async () => {
    const result = await verifier.verifyDecodeHeavyScenario();
    
    assert.ok(result.improvement, 'Should have improvement metrics');
    assert.ok(result.improvement.ttftImprovementPercent >= 0, 'Should have TTFT improvement percent');
    assert.ok(result.improvement.tpotImprovementPercent >= 0, 'Should have TPOT improvement percent');
    assert.ok(result.improvement.e2eImprovementPercent >= 0, 'Should have E2E improvement percent');
  });

  it('should handle multi-turn scenarios', async () => {
    const results = await verifier.verifyMultiTurnScenario(3);
    
    assert.strictEqual(results.length, 3, 'Should have 3 turn results');
    
    // Turn 1 should have no significant cache effect (hitRatio = 0)
    assert.strictEqual(results[0].cacheEffect?.hitRatio, 0, 'Turn 1 should have 0 cache hit ratio');
    
    // Turn 2+ should have cache effect
    assert.ok(results[1].cacheEffect, 'Turn 2 should have cache effect');
    assert.ok(results[2].cacheEffect, 'Turn 3 should have cache effect');
    assert.ok(results[1].cacheEffect!.hitRatio > 0, 'Turn 2 should have positive cache hit');
  });

  it('should verify batch scheduling', async () => {
    const results = await verifier.verifyBatchScheduling([1, 4, 8]);
    
    assert.strictEqual(results.length, 3, 'Should have 3 batch results');
    
    for (const result of results) {
      assert.ok(result.batchSize > 0, 'Should have batch size');
      assert.ok(result.monolithicTTFT > 0, 'Should have monolithic TTFT');
      assert.ok(result.pdTTFT > 0, 'Should have PD TTFT');
      assert.ok(result.interference.monolithic >= 0, 'Should have interference metrics');
    }
  });

  it('should run full verification', async () => {
    const report = await verifier.runFullVerification();
    
    assert.ok(report.generatedAt, 'Should have timestamp');
    assert.strictEqual(report.apiKeyMasked, 'sk-t...tion', 'Should mask API key');
    assert.ok(report.scenarios.length > 0, 'Should have scenarios');
    assert.ok(report.batchResults.length > 0, 'Should have batch results');
    assert.ok(report.summary, 'Should have summary');
    assert.ok(report.summary.scenariosTested > 0, 'Should count scenarios');
  });

  it('should generate markdown report', async () => {
    const report = await verifier.runFullVerification();
    const markdown = verifier.generateReport(report);
    
    assert.ok(markdown.includes('PD Disaggregation End-to-End Verification'), 'Should include title');
    assert.ok(markdown.includes('TTFT Improvement'), 'Should mention TTFT');
    assert.ok(markdown.includes('TPOT Improvement'), 'Should mention TPOT');
    assert.ok(markdown.includes('Batch Scheduling'), 'Should mention batch results');
  });
});
