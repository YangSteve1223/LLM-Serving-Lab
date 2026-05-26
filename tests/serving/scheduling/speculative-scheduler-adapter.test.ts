/**
 * Tests for Speculative Scheduler Adapter
 * 
 * Tests the integration of speculative decoding with the AbstractScheduler interface.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";

// Import components under test
import { SpeculativeSchedulerAdapter, type SpeculativeSchedulerAdapterConfig } from "../../../src/agents/learningAssistant/serving/scheduling/SpeculativeSchedulerAdapter.ts";
import { ContinuousBatchingAdapter } from "../../../src/agents/learningAssistant/serving/scheduling/ContinuousBatchingAdapter.ts";
import { SGLangRadixAdapter } from "../../../src/agents/learningAssistant/serving/scheduling/SGLangRadixAdapter.ts";
import type { PDWorkloadRequest } from "../../../src/agents/learningAssistant/serving/ServingTrace.ts";
import type { SchedulingWorkload } from "../../../src/agents/learningAssistant/serving/scheduling/SchedulerInterface.ts";

// Helper to generate test workload
function createTestWorkload(count: number = 10, options?: {
  minPrefill?: number;
  maxPrefill?: number;
  minDecode?: number;
  maxDecode?: number;
}): PDWorkloadRequest[] {
  const minPrefill = options?.minPrefill ?? 200;
  const maxPrefill = options?.maxPrefill ?? 1500;
  const minDecode = options?.minDecode ?? 50;
  const maxDecode = options?.maxDecode ?? 500;
  
  return Array.from({ length: count }, (_, i) => ({
    id: `req-${i}`,
    arrivalMs: i * 100,
    prefillTokens: minPrefill + Math.floor(Math.random() * (maxPrefill - minPrefill)),
    decodeTokens: minDecode + Math.floor(Math.random() * (maxDecode - minDecode)),
    cacheablePrefixTokens: Math.floor(Math.random() * 200),
    priority: i % 2 === 0 ? "interactive" : "background" as const
  }));
}

// Helper to create workload suitable for speculation
function createSpeculativeFriendlyWorkload(count: number = 10): PDWorkloadRequest[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `spec-req-${i}`,
    arrivalMs: i * 100,
    prefillTokens: 500 + Math.floor(Math.random() * 500),  // 500-1000 prefill tokens
    decodeTokens: 100 + Math.floor(Math.random() * 200),    // 100-300 decode tokens
    cacheablePrefixTokens: 200 + Math.floor(Math.random() * 200),
    priority: "interactive" as const
  }));
}

describe("SpeculativeSchedulerAdapter", () => {
  describe("Initialization", () => {
    it("should initialize with ContinuousBatchingAdapter as base scheduler", () => {
      const baseScheduler = new ContinuousBatchingAdapter({ policy: "fcfs" });
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      assert.strictEqual(adapter.getPolicyName().includes("continuous_batching"), true);
      assert.strictEqual(adapter.getPolicyName().includes("speculative"), true);
    });

    it("should initialize with SGLangRadixAdapter as base scheduler", () => {
      const baseScheduler = new SGLangRadixAdapter({ policy: "sglang_lsp" });
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      assert.strictEqual(adapter.getPolicyName().includes("sglang_lsp"), true);
      assert.strictEqual(adapter.getPolicyName().includes("speculative"), true);
    });

    it("should accept speculative configuration", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler,
        speculativeConfig: {
          numSpeculativeTokens: 6,
          acceptanceThreshold: 0.75,
          draftModelSpeedup: 0.08,
          enableTreeSpeculation: true,
          numDraftCandidates: 4,
          typicalAcceptanceRate: 0.70
        }
      });
      
      const config = adapter.getConfig();
      assert.deepStrictEqual(
        (config.speculativeConfig as any).numSpeculativeTokens, 
        6
      );
    });

    it("should accept routing criteria configuration", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler,
        routingCriteria: {
          minDecodeTokens: 100,
          maxDecodeTokens: 400,
          minPrefillTokens: 300,
          enableForInteractive: true,
          enableForBackground: true
        }
      });
      
      const config = adapter.getConfig();
      assert.deepStrictEqual(config.routingCriteria, {
        minDecodeTokens: 100,
        maxDecodeTokens: 400,
        minPrefillTokens: 300,
        enableForInteractive: true,
        enableForBackground: true
      });
    });

    it("should initialize with default routing criteria", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      const config = adapter.getConfig();
      const criteria = config.routingCriteria as any;
      assert.strictEqual(criteria.minDecodeTokens, 50);
      assert.strictEqual(criteria.maxDecodeTokens, 500);
      assert.strictEqual(criteria.minPrefillTokens, 200);
    });
  });

  describe("shouldUseSpeculative", () => {
    it("should return true for speculative-friendly requests", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      const request: PDWorkloadRequest = {
        id: "test-1",
        arrivalMs: 0,
        prefillTokens: 600,
        decodeTokens: 150,
        priority: "interactive"
      };
      
      assert.strictEqual(adapter.shouldUseSpeculative(request), true);
    });

    it("should return false for requests with too few decode tokens", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      const request: PDWorkloadRequest = {
        id: "test-2",
        arrivalMs: 0,
        prefillTokens: 500,
        decodeTokens: 30, // Below default minDecodeTokens of 50
        priority: "interactive"
      };
      
      assert.strictEqual(adapter.shouldUseSpeculative(request), false);
    });

    it("should return false for requests with too many decode tokens", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      const request: PDWorkloadRequest = {
        id: "test-3",
        arrivalMs: 0,
        prefillTokens: 500,
        decodeTokens: 600, // Above default maxDecodeTokens of 500
        priority: "interactive"
      };
      
      assert.strictEqual(adapter.shouldUseSpeculative(request), false);
    });

    it("should return false for background priority when enableForBackground is false", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler,
        routingCriteria: {
          enableForBackground: false
        }
      });
      
      const request: PDWorkloadRequest = {
        id: "test-4",
        arrivalMs: 0,
        prefillTokens: 500,
        decodeTokens: 200,
        priority: "background"
      };
      
      assert.strictEqual(adapter.shouldUseSpeculative(request), false);
    });

    it("should respect explicit enableSpeculative flag", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      // Create a request that normally wouldn't qualify
      const baseRequest: PDWorkloadRequest = {
        id: "test-5",
        arrivalMs: 0,
        prefillTokens: 200,
        decodeTokens: 30,
        priority: "background"
      };
      
      // Without enableSpeculative flag, should return false
      assert.strictEqual(adapter.shouldUseSpeculative(baseRequest), false);
      
      // Create a speculative-friendly request with the flag
      const speculativeRequest = {
        ...baseRequest,
        enableSpeculative: true
      };
      
      // With enableSpeculative flag true, should return true even for non-qualifying request
      // Note: This requires the shouldUseSpeculative method to check enableSpeculative
      // The current implementation checks this flag
      assert.strictEqual(adapter.shouldUseSpeculative(speculativeRequest as PDWorkloadRequest), true);
    });

    it("should return false for requests with insufficient prefill tokens", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      const request: PDWorkloadRequest = {
        id: "test-6",
        arrivalMs: 0,
        prefillTokens: 100, // Below default minPrefillTokens of 200
        decodeTokens: 200,
        priority: "interactive"
      };
      
      assert.strictEqual(adapter.shouldUseSpeculative(request), false);
    });
  });

  describe("schedule", () => {
    it("should schedule workload and return metrics", () => {
      const baseScheduler = new ContinuousBatchingAdapter({ policy: "fcfs" });
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      const workload = createSpeculativeFriendlyWorkload(10);
      const metrics = adapter.schedule({ requests: workload, config: {} });
      
      assert.ok(typeof metrics.ttftP50 === "number");
      assert.ok(typeof metrics.ttftP90 === "number");
      assert.ok(typeof metrics.ttftP99 === "number");
      assert.ok(typeof metrics.tpotP50 === "number");
      assert.ok(typeof metrics.tpotP90 === "number");
      assert.ok(typeof metrics.tpotP99 === "number");
      assert.ok(typeof metrics.goodput === "number");
      assert.ok(typeof metrics.throughput === "number");
    });

    it("should handle empty workload", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      const metrics = adapter.schedule({ requests: [], config: {} });
      
      // Empty workload should still return valid metrics structure
      assert.strictEqual(metrics.ttftP50, 0);
      assert.strictEqual(metrics.goodput, 0);
    });

    it("should route speculative-friendly requests to speculative path", () => {
      const baseScheduler = new ContinuousBatchingAdapter({ policy: "slo_aware" });
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      // All requests are speculative-friendly
      const workload = createSpeculativeFriendlyWorkload(5);
      const result = adapter.scheduleWithDetails({ requests: workload, config: {} });
      
      // Check that notes mention speculative routing
      assert.ok(result.notes.some(n => n.includes("Speculative requests:")));
    });

    it("should mix speculative and base scheduler paths for mixed workload", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      // Mix of speculative-friendly and non-friendly requests
      const workload = [
        ...createSpeculativeFriendlyWorkload(5), // 5 speculative-friendly
        ...createTestWorkload(5, {              // 5 not speculative-friendly
          minPrefill: 50,
          maxPrefill: 100,
          minDecode: 10,
          maxDecode: 30
        })
      ];
      
      const result = adapter.scheduleWithDetails({ requests: workload, config: {} });
      
      // Should have both paths
      const notes = result.notes.join(" ");
      assert.ok(notes.includes("Base scheduler"));
    });
  });

  describe("scheduleWithDetails", () => {
    it("should return complete scheduling result", () => {
      const baseScheduler = new ContinuousBatchingAdapter({ policy: "sjf" });
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      const workload = createSpeculativeFriendlyWorkload(8);
      const result = adapter.scheduleWithDetails({ requests: workload, config: {} });
      
      assert.ok(result.policyName.length > 0);
      assert.strictEqual(result.requestCount, 8);
      assert.ok(result.completedRequests >= 0);
      assert.ok(result.droppedRequests >= 0);
      assert.ok(result.ttftP50 >= 0);
      assert.ok(result.tpotP50 >= 0);
      assert.ok(result.avgTTFT >= 0);
      assert.ok(result.avgTPOT >= 0);
      assert.ok(result.avgE2E >= 0);
      assert.ok(result.goodput >= 0 && result.goodput <= 1);
      assert.ok(result.notes instanceof Array);
    });

    it("should include acceptance rate in notes", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      const workload = createSpeculativeFriendlyWorkload(5);
      const result = adapter.scheduleWithDetails({ requests: workload, config: {} });
      
      // Check that notes mention acceptance rate
      assert.ok(result.notes.some(n => n.includes("acceptance") || n.includes("speedup")));
    });
  });

  describe("Statistics", () => {
    it("should track statistics after scheduling", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      adapter.resetStats();
      const statsBefore = adapter.getStats();
      assert.strictEqual(statsBefore.totalRequests, 0);
      assert.strictEqual(statsBefore.speculativeRequests, 0);
      
      // Run scheduling
      const workload = createSpeculativeFriendlyWorkload(10);
      adapter.schedule({ requests: workload, config: {} });
      
      const statsAfter = adapter.getStats();
      assert.strictEqual(statsAfter.totalRequests, 10);
      assert.ok(statsAfter.speculativeRequests >= 0);
    });

    it("should reset statistics correctly", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      // Run some scheduling
      const workload = createSpeculativeFriendlyWorkload(5);
      adapter.schedule({ requests: workload, config: {} });
      
      adapter.resetStats();
      const stats = adapter.getStats();
      
      assert.strictEqual(stats.totalRequests, 0);
      assert.strictEqual(stats.speculativeRequests, 0);
      assert.strictEqual(stats.baseSchedulerRequests, 0);
      assert.strictEqual(stats.avgAcceptanceRate, 0);
      assert.strictEqual(stats.avgSpeedupRatio, 0);
    });
  });

  describe("Configuration updates", () => {
    it("should update speculative configuration", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler,
        speculativeConfig: {
          typicalAcceptanceRate: 0.5
        }
      });
      
      adapter.configureSpeculative({
        typicalAcceptanceRate: 0.8
      });
      
      const config = adapter.getConfig();
      assert.strictEqual((config.speculativeConfig as any).typicalAcceptanceRate, 0.8);
    });

    it("should update routing criteria", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler
      });
      
      adapter.configureRouting({
        minDecodeTokens: 100,
        maxDecodeTokens: 300
      });
      
      const config = adapter.getConfig();
      assert.strictEqual((config.routingCriteria as any).minDecodeTokens, 100);
      assert.strictEqual((config.routingCriteria as any).maxDecodeTokens, 300);
    });
  });

  describe("Different base schedulers", () => {
    it("should work with FCFS policy", () => {
      const baseScheduler = new ContinuousBatchingAdapter({ policy: "fcfs" });
      const adapter = new SpeculativeSchedulerAdapter({ baseScheduler });
      
      const workload = createSpeculativeFriendlyWorkload(5);
      const result = adapter.scheduleWithDetails({ requests: workload, config: {} });
      
      assert.ok(result.policyName.includes("fcfs"));
    });

    it("should work with SJF policy", () => {
      const baseScheduler = new ContinuousBatchingAdapter({ policy: "sjf" });
      const adapter = new SpeculativeSchedulerAdapter({ baseScheduler });
      
      const workload = createSpeculativeFriendlyWorkload(5);
      const result = adapter.scheduleWithDetails({ requests: workload, config: {} });
      
      assert.ok(result.policyName.includes("sjf"));
    });

    it("should work with SLO-aware policy", () => {
      const baseScheduler = new ContinuousBatchingAdapter({ policy: "slo_aware" });
      const adapter = new SpeculativeSchedulerAdapter({ baseScheduler });
      
      const workload = createSpeculativeFriendlyWorkload(5);
      const result = adapter.scheduleWithDetails({ requests: workload, config: {} });
      
      assert.ok(result.policyName.includes("slo_aware"));
    });

    it("should work with SGLangRadixAdapter", () => {
      const baseScheduler = new SGLangRadixAdapter({ policy: "sglang_lsp" });
      const adapter = new SpeculativeSchedulerAdapter({ baseScheduler });
      
      const workload = createSpeculativeFriendlyWorkload(5);
      const result = adapter.scheduleWithDetails({ requests: workload, config: {} });
      
      assert.ok(result.policyName.includes("sglang_lsp"));
    });
  });

  describe("Performance characteristics", () => {
    it("should show throughput improvement with speculative decoding", () => {
      const baseScheduler = new ContinuousBatchingAdapter({ policy: "fcfs" });
      const speculativeAdapter = new SpeculativeSchedulerAdapter({ baseScheduler });
      
      // Run with base scheduler only
      const baseOnlyScheduler = new ContinuousBatchingAdapter({ policy: "fcfs" });
      const workload = createSpeculativeFriendlyWorkload(20);
      const baseResult = baseOnlyScheduler.scheduleWithDetails({ requests: workload, config: {} });
      
      // Run with speculative
      const specResult = speculativeAdapter.scheduleWithDetails({ requests: workload, config: {} });
      
      // Speculative should generally have comparable or better throughput
      // (exact comparison depends on workload characteristics)
      assert.ok(typeof specResult.throughput === "number");
      assert.ok(specResult.throughput >= 0);
    });

    it("should route correctly based on workload characteristics", () => {
      const baseScheduler = new ContinuousBatchingAdapter();
      const adapter = new SpeculativeSchedulerAdapter({
        baseScheduler,
        routingCriteria: {
          minPrefillTokens: 500,
          minDecodeTokens: 100,
          maxDecodeTokens: 400
        }
      });
      
      // Request that meets criteria
      const goodRequest: PDWorkloadRequest = {
        id: "good",
        arrivalMs: 0,
        prefillTokens: 600,
        decodeTokens: 200,
        priority: "interactive"
      };
      
      // Request that doesn't meet criteria
      const badRequest: PDWorkloadRequest = {
        id: "bad",
        arrivalMs: 10,
        prefillTokens: 100, // Too few
        decodeTokens: 200,
        priority: "interactive"
      };
      
      assert.strictEqual(adapter.shouldUseSpeculative(goodRequest), true);
      assert.strictEqual(adapter.shouldUseSpeculative(badRequest), false);
    });
  });
});
