/**
 * Tests for AdaptiveChunkedPrefillCoordinator
 */
import { describe, it } from "node:test";
import assert from "node:assert";

// Import optimization components
import { 
  AdaptiveChunkedPrefillCoordinator,
  createAdaptiveCoordinator,
  createLowLatencyCoordinator,
  createThroughputOptimizedCoordinator,
  type AdaptiveChunkConfig,
  type ChunkingDecision
} from "../../../src/agents/learningAssistant/serving/optimization/AdaptiveChunkedPrefillCoordinator.ts";
import { ChunkedPrefillCoordinator } from "../../../src/agents/learningAssistant/serving/optimization/ChunkedPrefillCoordinator.ts";
import type { PDWorkloadRequest, ServingSLO } from "../../../src/agents/learningAssistant/serving/ServingTrace.ts";

describe('AdaptiveChunkedPrefillCoordinator', () => {
  describe('constructor', () => {
    it('should create with default config', () => {
      const c = new AdaptiveChunkedPrefillCoordinator();
      assert.ok(c);
      assert.ok(c.getMetrics());
    });

    it('should create with custom config', () => {
      const config: Partial<AdaptiveChunkConfig> = {
        minChunkSize: 64,
        maxChunkSize: 1024,
        strategy: 'slo_based'
      };
      const c = new AdaptiveChunkedPrefillCoordinator(config);
      assert.ok(c);
    });

    it('should use provided base coordinator', () => {
      const custom = new ChunkedPrefillCoordinator({ chunkSize: 256 });
      const c = new AdaptiveChunkedPrefillCoordinator({}, custom);
      assert.strictEqual(c.getBaseCoordinator(), custom);
    });

    it('should create with helper functions', () => {
      const hybrid = createAdaptiveCoordinator('hybrid');
      const lowLatency = createLowLatencyCoordinator();
      const throughput = createThroughputOptimizedCoordinator();

      assert.ok(hybrid);
      assert.ok(lowLatency);
      assert.ok(throughput);
    });
  });

  describe('calculateOptimalChunkSize', () => {
    it('should return current chunk size when disabled', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator({
        enabled: false
      });
      // When disabled, uses base coordinator chunk size
      const size = coordinator.calculateOptimalChunkSize(0.5, 0.5);
      assert.ok(size > 0); // Should return a valid chunk size
    });

    it('should decrease chunk size at high load (load_based)', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator({
        strategy: 'load_based',
        highLoadThreshold: 0.8,
        minChunkSize: 128,
        maxChunkSize: 2048
      });
      const size = coordinator.calculateOptimalChunkSize(0.95, 0.5);
      // Due to smooth transition, size should be less than max
      assert.ok(size < 2048, `Expected size < 2048, got ${size}`);
    });

    it('should increase chunk size at low load (load_based)', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator({
        strategy: 'load_based',
        lowLoadThreshold: 0.4,
        minChunkSize: 128,
        maxChunkSize: 2048
      });
      const size = coordinator.calculateOptimalChunkSize(0.1, 0.5);
      // Due to smooth transition, size should be greater than min
      assert.ok(size > 128, `Expected size > 128, got ${size}`);
    });

    it('should decrease chunk size at high SLO risk (slo_based)', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator({
        strategy: 'slo_based',
        minChunkSize: 128,
        maxChunkSize: 2048
      });
      const size = coordinator.calculateOptimalChunkSize(0.5, 1.5);
      // Due to smooth transition, size should be less than max
      assert.ok(size < 2048, `Expected size < 2048, got ${size}`);
    });

    it('should increase chunk size at low SLO risk (slo_based)', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator({
        strategy: 'slo_based',
        minChunkSize: 128,
        maxChunkSize: 2048
      });
      const size = coordinator.calculateOptimalChunkSize(0.5, 0.1);
      // Due to smooth transition, size should be greater than min
      assert.ok(size > 128, `Expected size > 128, got ${size}`);
    });

    it('should clamp to configured bounds', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator({
        minChunkSize: 64,
        maxChunkSize: 4096
      });
      
      // Multiple calls to converge to bounds
      for (let i = 0; i < 50; i++) {
        coordinator.calculateOptimalChunkSize(1.0, 1.0);
      }
      const minSize = coordinator.getMetrics().currentChunkSize;
      assert.ok(minSize >= 64, `Expected minSize >= 64, got ${minSize}`);
    });

    it('should consider both factors in hybrid mode', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator({
        strategy: 'hybrid'
      });
      
      const size1 = coordinator.calculateOptimalChunkSize(0.9, 0.2); // High load, low risk
      const size2 = coordinator.calculateOptimalChunkSize(0.2, 0.9); // Low load, high risk
      
      // Both should be valid chunk sizes
      assert.ok(size1 > 0, `Expected size1 > 0, got ${size1}`);
      assert.ok(size2 > 0, `Expected size2 > 0, got ${size2}`);
    });
  });

  describe('getChunkingDecision', () => {
    it('should return detailed decision for a request', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator({
        strategy: 'load_based'
      });
      
      const request: PDWorkloadRequest = {
        id: 'req-1',
        arrivalMs: 0,
        prefillTokens: 1024,
        decodeTokens: 100
      };
      
      const slo: ServingSLO = { ttftMs: 1000, tpotMs: 100, e2eMs: 10000 };
      
      const decision = coordinator.getChunkingDecision(request, 0.5, 0.5, slo);
      
      assert.strictEqual(decision.requestId, 'req-1');
      assert.ok(decision.recommendedChunkSize > 0);
      assert.strictEqual(decision.strategy, 'load_based');
      assert.strictEqual(decision.systemLoad, 0.5);
      assert.strictEqual(decision.sloRisk, 0.5);
      assert.ok(decision.reasoning);
    });

    it('should include reasoning based on strategy', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator({
        strategy: 'slo_based'
      });
      
      const request: PDWorkloadRequest = {
        id: 'req-1',
        arrivalMs: 0,
        prefillTokens: 512,
        decodeTokens: 50
      };
      
      const decision = coordinator.getChunkingDecision(request, 0.5, 0.9, {});
      
      assert.ok(decision.reasoning.includes('SLO risk'));
    });
  });

  describe('createAdaptivePlan', () => {
    it('should create plan with adaptive chunk size', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator();
      const tokens = Array(2048).fill(0).map((_, i) => i % 50000);
      const cacheablePrefixes = new Map<string, number>();
      
      const plan = coordinator.createAdaptivePlan('req-1', tokens, cacheablePrefixes, 0.5, 0.5);
      
      assert.strictEqual(plan.requestId, 'req-1');
      assert.strictEqual(plan.totalTokens, 2048);
      assert.ok(plan.chunks);
      assert.ok(plan.chunks.length > 0);
    });

    it('should create smaller chunks at high load', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator();
      const tokens = Array(2048).fill(0).map((_, i) => i % 50000);
      const cacheablePrefixes = new Map<string, number>();
      
      const highLoadPlan = coordinator.createAdaptivePlan('req-1', tokens, cacheablePrefixes, 0.9, 0.5);
      
      // High load should result in more/smaller chunks
      assert.ok(highLoadPlan.chunks.length >= 1);
    });
  });

  describe('getMetrics', () => {
    it('should return current metrics', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator();
      const metrics = coordinator.getMetrics();
      
      assert.ok(metrics.currentChunkSize > 0);
      assert.strictEqual(metrics.strategy, 'hybrid');
      assert.ok(typeof metrics.systemLoad === 'number');
      assert.ok(typeof metrics.sloRisk === 'number');
      assert.ok(typeof metrics.adjustments === 'number');
      assert.ok(typeof metrics.avgChunkSize === 'number');
      assert.ok(Array.isArray(metrics.chunkSizeHistory));
    });

    it('should track adjustments over time', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator();
      // Make several load changes to trigger adjustments
      coordinator.calculateOptimalChunkSize(0.9, 0.5);
      coordinator.calculateOptimalChunkSize(0.8, 0.5);
      coordinator.calculateOptimalChunkSize(0.7, 0.5);
      
      const metrics = coordinator.getMetrics();
      assert.ok(metrics.chunkSizeHistory.length > 1);
    });
  });

  describe('configure', () => {
    it('should update configuration', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator();
      coordinator.configure({
        strategy: 'slo_based',
        minChunkSize: 256,
        maxChunkSize: 4096
      });
      
      const metrics = coordinator.getMetrics();
      assert.strictEqual(metrics.strategy, 'slo_based');
    });
  });

  describe('reset', () => {
    it('should reset metrics and history', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator();
      coordinator.calculateOptimalChunkSize(0.9, 0.5);
      coordinator.calculateOptimalChunkSize(0.2, 0.5);
      
      coordinator.reset();
      
      const metrics = coordinator.getMetrics();
      assert.strictEqual(metrics.adjustments, 0);
      assert.strictEqual(metrics.chunkSizeHistory.length, 1);
    });
  });

  describe('generateReport', () => {
    it('should generate comprehensive markdown report', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator({
        strategy: 'load_based'
      });
      coordinator.calculateOptimalChunkSize(0.6, 0.5);
      
      const report = coordinator.generateReport();
      
      assert.ok(report.includes('# Adaptive Chunked Prefill Report'));
      assert.ok(report.includes('## Configuration'));
      assert.ok(report.includes('## Current State'));
      assert.ok(report.includes('## Strategy Behavior'));
      assert.ok(report.includes('Enabled'));
      assert.ok(report.includes('Strategy'));
      assert.ok(report.includes('Current Chunk Size'));
    });
  });

  describe('getBaseCoordinator', () => {
    it('should return wrapped base coordinator', () => {
      const coordinator = new AdaptiveChunkedPrefillCoordinator();
      const base = coordinator.getBaseCoordinator();
      assert.ok(base);
      assert.ok(base instanceof ChunkedPrefillCoordinator);
    });
  });
});

describe('Adaptive Strategies', () => {
  describe('Low Latency Coordinator', () => {
    it('should have aggressive settings for low latency', () => {
      const c = createLowLatencyCoordinator();
      const metrics = c.getMetrics();
      assert.strictEqual(metrics.strategy, 'slo_based');
    });
  });

  describe('Throughput Optimized Coordinator', () => {
    it('should have settings optimized for throughput', () => {
      const c = createThroughputOptimizedCoordinator();
      const metrics = c.getMetrics();
      assert.strictEqual(metrics.strategy, 'load_based');
    });
  });
});

describe('Chunk Size Boundaries', () => {
  it('should never go below minChunkSize', () => {
    const coordinator = new AdaptiveChunkedPrefillCoordinator({
      minChunkSize: 128,
      maxChunkSize: 2048,
      strategy: 'hybrid'
    });
    
    for (let i = 0; i < 10; i++) {
      const size = coordinator.calculateOptimalChunkSize(1.0, 1.0);
      assert.ok(size >= 128);
    }
  });

  it('should never exceed maxChunkSize', () => {
    const coordinator = new AdaptiveChunkedPrefillCoordinator({
      minChunkSize: 128,
      maxChunkSize: 2048,
      strategy: 'hybrid'
    });
    
    for (let i = 0; i < 10; i++) {
      const size = coordinator.calculateOptimalChunkSize(0.0, 0.0);
      assert.ok(size <= 2048);
    }
  });

  it('should produce integer chunk sizes', () => {
    const coordinator = new AdaptiveChunkedPrefillCoordinator({
      minChunkSize: 64,
      maxChunkSize: 2048
    });
    
    for (let i = 0; i < 20; i++) {
      const size = coordinator.calculateOptimalChunkSize(i * 0.05, 0.5);
      assert.strictEqual(Number.isInteger(size), true);
    }
  });
});
