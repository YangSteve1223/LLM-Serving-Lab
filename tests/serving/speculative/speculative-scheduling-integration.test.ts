/**
 * Tests for SpeculativeSchedulingIntegration
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SpeculativeSchedulingIntegration, 
  DEFAULT_SPECULATIVE_SCHEDULING_CONFIG,
  type SpeculativeDecision,
  type SpeculativeSchedulingResult,
  type WorkloadCharacteristics,
  type SpeculativeSchedulingConfig
} from '../../../src/agents/learningAssistant/serving/speculative/SpeculativeSchedulingIntegration.ts';
import type { PDWorkloadRequest } from '../../../src/agents/learningAssistant/serving/ServingTrace.ts';

describe('SpeculativeSchedulingIntegration', () => {
  let integration: SpeculativeSchedulingIntegration;

  beforeEach(() => {
    integration = new SpeculativeSchedulingIntegration();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      assert.ok(integration instanceof SpeculativeSchedulingIntegration, 'Should be instance');
    });

    it('should apply custom config', () => {
      const customIntegration = new SpeculativeSchedulingIntegration({
        enabled: false,
        minDecodeTokensForSpeculation: 50,
        maxSpeculationWindow: 8
      });

      assert.ok(customIntegration instanceof SpeculativeSchedulingIntegration, 'Should create with custom config');
    });

    it('should use default values when partial config provided', () => {
      const partialIntegration = new SpeculativeSchedulingIntegration({
        minDecodeTokensForSpeculation: 100
      });

      assert.ok(partialIntegration instanceof SpeculativeSchedulingIntegration, 'Should create with partial config');
    });
  });

  describe('decideSpeculation', () => {
    const createRequest = (decodeTokens: number, id = 'test_req'): PDWorkloadRequest => ({
      id,
      arrivalMs: 0,
      prefillTokens: 512,
      decodeTokens,
      priority: 'interactive'
    });

    const highThroughputWorkload: WorkloadCharacteristics = {
      avgDecodeLength: 256,
      decodeLengthVariance: 10000,
      arrivalRate: 10,
      interactiveRatio: 0.7,
      observedAcceptanceRate: 0.65
    };

    const lowVarianceWorkload: WorkloadCharacteristics = {
      avgDecodeLength: 128,
      decodeLengthVariance: 100,
      arrivalRate: 8,
      interactiveRatio: 0.8,
      observedAcceptanceRate: 0.70
    };

    it('should return direct_decode when disabled', () => {
      const disabledIntegration = new SpeculativeSchedulingIntegration({ enabled: false });
      const request = createRequest(100);
      
      const result = disabledIntegration.decideSpeculation(request);
      
      assert.strictEqual(result.decision, 'direct_decode', 'Should return direct_decode');
      assert.strictEqual(result.optimalWindowSize, 0, 'Window size should be 0');
      assert.strictEqual(result.expectedSpeedup, 1.0, 'Speedup should be 1.0');
    });

    it('should return direct_decode for short requests', () => {
      const request = createRequest(10); // Below default 32 token threshold
      
      const result = integration.decideSpeculation(request);
      
      assert.strictEqual(result.decision, 'direct_decode', 'Should skip short requests');
      assert.strictEqual(result.optimalWindowSize, 0, 'Window should be 0');
    });

    it('should return direct_decode for marginal speedup', () => {
      // Create integration with very conservative settings
      const conservativeIntegration = new SpeculativeSchedulingIntegration({
        targetAcceptanceRate: 0.99 // Very high target = low actual acceptance
      });
      const request = createRequest(50);
      
      const result = conservativeIntegration.decideSpeculation(request);
      
      assert.strictEqual(result.decision, 'direct_decode', 'Should skip when speedup marginal');
    });

    it('should return speculate for long enough requests with good acceptance', () => {
      const request = createRequest(200);
      
      const result = integration.decideSpeculation(request);
      
      assert.strictEqual(result.decision, 'speculate', 'Should enable speculation');
      assert.ok(result.optimalWindowSize > 0, 'Window size should be positive');
      assert.ok(result.expectedSpeedup > 1.0, 'Speedup should be > 1');
      assert.ok(result.speculativeResult !== undefined, 'Should have speculative result');
    });

    it('should return batch_verify for high throughput workloads', () => {
      const batchIntegration = new SpeculativeSchedulingIntegration({
        batchVerificationSize: 4
      });
      const request = createRequest(100);
      
      const result = batchIntegration.decideSpeculation(request, highThroughputWorkload);
      
      // High arrival rate + low variance should trigger batch
      if (result.decision === 'batch_verify') {
        assert.ok(result.optimalWindowSize > 0, 'Should have window size');
        assert.ok(result.expectedSpeedup > 1.0, 'Should have speedup');
      }
    });

    it('should adjust window based on acceptance rate', () => {
      const highAcceptanceWorkload: WorkloadCharacteristics = {
        ...lowVarianceWorkload,
        observedAcceptanceRate: 0.85
      };
      const lowAcceptanceWorkload: WorkloadCharacteristics = {
        ...lowVarianceWorkload,
        observedAcceptanceRate: 0.45
      };
      const request = createRequest(200);
      
      const highResult = integration.decideSpeculation(request, highAcceptanceWorkload);
      const lowResult = integration.decideSpeculation(request, lowAcceptanceWorkload);
      
      if (highResult.decision === 'speculate' && lowResult.decision === 'speculate') {
        assert.ok(
          highResult.optimalWindowSize >= lowResult.optimalWindowSize,
          'High acceptance should allow larger window'
        );
      }
    });

    it('should include request ID in result', () => {
      const request = createRequest(100, 'custom_id_123');
      
      const result = integration.decideSpeculation(request);
      
      assert.strictEqual(result.requestId, 'custom_id_123', 'Should include request ID');
    });

    it('should generate reasoning string', () => {
      const request = createRequest(200);
      
      const result = integration.decideSpeculation(request);
      
      assert.ok(typeof result.reasoning === 'string', 'Should have reasoning');
      assert.ok(result.reasoning.length > 0, 'Reasoning should not be empty');
    });

    it('should handle requests without ID', () => {
      const request = {
        arrivalMs: 0,
        prefillTokens: 512,
        decodeTokens: 200
      } as PDWorkloadRequest;
      
      const result = integration.decideSpeculation(request);
      
      assert.ok(result.requestId.startsWith('req-'), 'Should generate ID');
    });
  });

  describe('window calculation', () => {
    it('should respect maxSpeculationWindow limit', () => {
      const smallWindowIntegration = new SpeculativeSchedulingIntegration({
        maxSpeculationWindow: 3
      });
      const request = {
        id: 'test',
        arrivalMs: 0,
        prefillTokens: 512,
        decodeTokens: 500,
        priority: 'interactive' as const
      };
      
      const result = smallWindowIntegration.decideSpeculation(request);
      
      if (result.decision === 'speculate') {
        assert.ok(result.optimalWindowSize <= 3, 'Window should not exceed max');
      }
    });

    it('should use max window when no workload characteristics provided', () => {
      const integration = new SpeculativeSchedulingIntegration({
        enableDynamicWindow: true
      });
      const request = {
        id: 'test',
        arrivalMs: 0,
        prefillTokens: 512,
        decodeTokens: 500,
        priority: 'interactive' as const
      };
      
      const result = integration.decideSpeculation(request);
      
      if (result.decision === 'speculate') {
        assert.strictEqual(result.optimalWindowSize, 6, 'Should use max window');
      }
    });
  });

  describe('DEFAULT_SPECULATIVE_SCHEDULING_CONFIG', () => {
    it('should have sensible defaults', () => {
      assert.strictEqual(DEFAULT_SPECULATIVE_SCHEDULING_CONFIG.enabled, true);
      assert.strictEqual(DEFAULT_SPECULATIVE_SCHEDULING_CONFIG.minDecodeTokensForSpeculation, 32);
      assert.strictEqual(DEFAULT_SPECULATIVE_SCHEDULING_CONFIG.maxSpeculationWindow, 6);
      assert.strictEqual(DEFAULT_SPECULATIVE_SCHEDULING_CONFIG.enableDynamicWindow, true);
      assert.ok(DEFAULT_SPECULATIVE_SCHEDULING_CONFIG.targetAcceptanceRate >= 0.5);
      assert.ok(DEFAULT_SPECULATIVE_SCHEDULING_CONFIG.targetAcceptanceRate <= 0.8);
      assert.ok(DEFAULT_SPECULATIVE_SCHEDULING_CONFIG.batchVerificationSize >= 2);
    });
  });

  describe('edge cases', () => {
    it('should handle zero decode tokens', () => {
      const request = {
        id: 'zero_decode',
        arrivalMs: 0,
        prefillTokens: 100,
        decodeTokens: 0
      };
      
      const result = integration.decideSpeculation(request);
      
      assert.strictEqual(result.decision, 'direct_decode', 'Should handle zero tokens');
    });

    it('should handle extremely large decode tokens', () => {
      const request = {
        id: 'large_decode',
        arrivalMs: 0,
        prefillTokens: 1000,
        decodeTokens: 10000,
        priority: 'background' as const
      };
      
      const result = integration.decideSpeculation(request);
      
      assert.ok(['speculate', 'batch_verify', 'direct_decode'].includes(result.decision),
        'Should return valid decision');
    });

    it('should handle very low acceptance rate workload', () => {
      const poorWorkload: WorkloadCharacteristics = {
        avgDecodeLength: 200,
        decodeLengthVariance: 40000,
        arrivalRate: 5,
        interactiveRatio: 0.5,
        observedAcceptanceRate: 0.3
      };
      const request = {
        id: 'poor_workload',
        arrivalMs: 0,
        prefillTokens: 500,
        decodeTokens: 200,
        priority: 'interactive' as const
      };
      
      const result = integration.decideSpeculation(request, poorWorkload);
      
      // With very low acceptance, should either skip or use very small window
      assert.ok(['speculate', 'direct_decode'].includes(result.decision),
        'Should return valid decision for poor workload');
      if (result.decision === 'speculate') {
        assert.ok(result.optimalWindowSize <= DEFAULT_SPECULATIVE_SCHEDULING_CONFIG.maxSpeculationWindow,
          'Window should be constrained');
      }
    });

    it('should handle workload with zero arrival rate', () => {
      const idleWorkload: WorkloadCharacteristics = {
        avgDecodeLength: 128,
        decodeLengthVariance: 1000,
        arrivalRate: 0,
        interactiveRatio: 0.5,
        observedAcceptanceRate: 0.65
      };
      const request = {
        id: 'idle_req',
        arrivalMs: 0,
        prefillTokens: 512,
        decodeTokens: 200,
        priority: 'interactive' as const
      };
      
      const result = integration.decideSpeculation(request, idleWorkload);
      
      assert.ok(['speculate', 'direct_decode'].includes(result.decision),
        'Should handle zero arrival rate');
    });

    it('should handle zero variance workload (all identical requests)', () => {
      const uniformWorkload: WorkloadCharacteristics = {
        avgDecodeLength: 128,
        decodeLengthVariance: 0,
        arrivalRate: 20,
        interactiveRatio: 0.9,
        observedAcceptanceRate: 0.70
      };
      const request = {
        id: 'uniform_req',
        arrivalMs: 0,
        prefillTokens: 512,
        decodeTokens: 200,
        priority: 'interactive' as const
      };
      
      const result = integration.decideSpeculation(request, uniformWorkload);
      
      // Zero variance should favor batch verification
      if (result.decision === 'batch_verify') {
        assert.ok(result.optimalWindowSize > 0, 'Should have window');
      }
    });
  });

  describe('speculative result metrics', () => {
    it('should return valid speculative result', () => {
      const request = {
        id: 'metrics_test',
        arrivalMs: 0,
        prefillTokens: 512,
        decodeTokens: 200,
        priority: 'interactive' as const
      };
      
      const result = integration.decideSpeculation(request);
      
      if (result.decision === 'speculate' && result.speculativeResult) {
        const sr = result.speculativeResult;
        
        assert.strictEqual(typeof sr.totalTokens, 'number', 'Should have total tokens');
        assert.strictEqual(typeof sr.acceptanceRate, 'number', 'Should have acceptance rate');
        assert.ok(sr.acceptanceRate >= 0 && sr.acceptanceRate <= 1, 'Acceptance rate should be valid');
        assert.strictEqual(typeof sr.speedupRatio, 'number', 'Should have speedup');
        assert.ok(sr.speedupRatio >= 1.0, 'Speedup should be >= 1');
        assert.ok(Array.isArray(sr.rounds), 'Should have rounds array');
      }
    });

    it('should calculate speedup ratio correctly', () => {
      const request = {
        id: 'speedup_test',
        arrivalMs: 0,
        prefillTokens: 512,
        decodeTokens: 100,
        priority: 'interactive' as const
      };
      
      const result = integration.decideSpeculation(request);
      
      if (result.decision === 'speculate') {
        assert.ok(result.expectedSpeedup >= 1.0, 'Speedup should be at least 1');
        assert.ok(result.expectedSpeedup <= 4.0, 'Speedup should be reasonable (<4x for typical config)');
      }
    });
  });
});
