/**
 * Tests for Speculative Decoding Simulator
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SpeculativeDecodingSimulator } from '../../../src/agents/learningAssistant/serving/speculative/index.ts';

describe('SpeculativeDecodingSimulator', () => {
  const simulator = new SpeculativeDecodingSimulator();

  describe('basic simulation', () => {
    it('should simulate baseline request without speculation overhead', () => {
      const request = {
        id: 'test-1',
        arrivalMs: 0,
        prefillTokens: 128,
        decodeTokens: 64
      };

      const result = simulator.simulate(request);

      assert.strictEqual(result.requestId, 'test-1');
      assert.strictEqual(result.totalTokens, 64);
      assert.ok(result.rounds.length > 0);
      assert.ok(result.totalDraftTokens > 0);
    });

    it('should calculate positive speedup ratio', () => {
      const request = {
        id: 'test-2',
        arrivalMs: 0,
        prefillTokens: 256,
        decodeTokens: 128
      };

      const result = simulator.simulate(request);

      assert.ok(result.speedupRatio > 0);
    });

    it('should handle very short requests', () => {
      const request = {
        id: 'test-3',
        arrivalMs: 0,
        prefillTokens: 32,
        decodeTokens: 8
      };

      const result = simulator.simulate(request);

      assert.strictEqual(result.totalTokens, 8);
      assert.ok(result.rounds.length > 0);
    });
  });

  describe('acceptance rate calculation', () => {
    it('should use custom acceptance rate when provided', () => {
      const request = {
        id: 'test-4',
        arrivalMs: 0,
        prefillTokens: 128,
        decodeTokens: 128,
        contentAcceptanceRate: 0.9
      };

      const result = simulator.simulate(request);

      assert.ok(result.acceptanceRate > 0.5);
    });

    it('should calculate speedup correctly', () => {
      const speedup = simulator.calculateSpeedup(4, 3);
      
      assert.ok(speedup > 0);
      assert.ok(speedup <= 4);
    });
  });

  describe('configuration', () => {
    it('should use default config when not provided', () => {
      const newSimulator = new SpeculativeDecodingSimulator();
      
      assert.ok(newSimulator);
    });

    it('should accept custom configuration', () => {
      const customSimulator = new SpeculativeDecodingSimulator({
        numSpeculativeTokens: 8,
        acceptanceThreshold: 0.8,
        draftModelSpeedup: 0.05
      });

      assert.ok(customSimulator);
    });

    it('should allow configuration update', () => {
      simulator.configure({
        numSpeculativeTokens: 6,
        enableTreeSpeculation: true
      });

      assert.ok(simulator);
    });
  });

  describe('energy savings', () => {
    it('should calculate energy savings', () => {
      const savings = simulator.calculateEnergySavings(4, 3, 0.1);
      
      assert.ok(savings >= 0);
    });

    it('should return zero for zero draft tokens', () => {
      const savings = simulator.calculateEnergySavings(0, 0, 0.1);
      
      assert.strictEqual(savings, 0);
    });
  });

  describe('benchmark comparison', () => {
    it('should benchmark against baseline', () => {
      const workload = [
        { id: 'req-1', arrivalMs: 0, prefillTokens: 128, decodeTokens: 64 },
        { id: 'req-2', arrivalMs: 100, prefillTokens: 256, decodeTokens: 128 }
      ];

      const comparison = simulator.benchmarkVsBaseline(workload);

      assert.ok(comparison);
      assert.ok(comparison.speedupRatio > 0);
      assert.ok(comparison.baselineMetrics);
      assert.ok(comparison.speculativeMetrics);
    });
  });

  describe('tree speculation', () => {
    it('should enable tree speculation with multiple candidates', () => {
      const treeSimulator = new SpeculativeDecodingSimulator({
        enableTreeSpeculation: true,
        numDraftCandidates: 4
      });

      const request = {
        id: 'test-tree',
        arrivalMs: 0,
        prefillTokens: 128,
        decodeTokens: 100
      };

      const result = treeSimulator.simulate(request);

      assert.ok(result.speedupRatio > 0);
    });
  });
});
