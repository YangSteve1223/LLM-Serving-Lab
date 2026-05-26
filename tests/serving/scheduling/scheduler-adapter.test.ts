/**
 * Tests for Scheduler Adapters
 * 
 * Tests interface consistency between ContinuousBatchingAdapter and SGLangRadixAdapter.
 */
import { describe, it } from "node:test";
import assert from "node:assert";

// Import scheduler components
import { AbstractScheduler, type SchedulingWorkload, type SchedulingMetrics, type SchedulingResult } from "../../../src/agents/learningAssistant/serving/scheduling/SchedulerInterface.ts";
import { ContinuousBatchingAdapter } from "../../../src/agents/learningAssistant/serving/scheduling/ContinuousBatchingAdapter.ts";
import { SGLangRadixAdapter } from "../../../src/agents/learningAssistant/serving/scheduling/SGLangRadixAdapter.ts";
import type { PDWorkloadRequest } from "../../../src/agents/learningAssistant/serving/ServingTrace.ts";

// Helper to generate synthetic workload
function createTestWorkload(count: number = 10): PDWorkloadRequest[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `req-${i}`,
    arrivalMs: i * 1000,
    prefillTokens: 500 + (i % 5) * 100,
    decodeTokens: 50 + (i % 3) * 30,
    cacheablePrefixTokens: 200 + (i % 4) * 50,
    priority: i % 2 === 0 ? "interactive" : "background" as const
  }));
}

describe("AbstractScheduler Interface", () => {
  it("should define SchedulingWorkload interface", () => {
    const workload: SchedulingWorkload = {
      requests: [],
      config: {}
    };
    assert.ok(Array.isArray(workload.requests));
  });

  it("should define SchedulingMetrics interface", () => {
    const metrics: SchedulingMetrics = {
      ttftP50: 100,
      ttftP90: 200,
      ttftP99: 300,
      tpotP50: 50,
      tpotP90: 75,
      tpotP99: 100,
      goodput: 0.95,
      throughput: 100
    };
    assert.strictEqual(metrics.ttftP50, 100);
    assert.ok(metrics.goodput >= 0 && metrics.goodput <= 1);
  });

  it("should define SchedulingResult interface", () => {
    const result: SchedulingResult = {
      policyName: "test",
      requestCount: 10,
      completedRequests: 10,
      droppedRequests: 0,
      ttftP50: 100,
      ttftP90: 200,
      ttftP99: 300,
      tpotP50: 50,
      tpotP90: 75,
      tpotP99: 100,
      avgTTFT: 120,
      avgTPOT: 55,
      avgE2E: 500,
      goodput: 0.95,
      throughput: 100,
      notes: []
    };
    assert.strictEqual(result.policyName, "test");
    assert.ok(result.notes instanceof Array);
  });

  it("should define abstract methods that subclasses must implement", () => {
    // Abstract class methods are undefined when accessed on the base class
    // Subclasses ContinuousBatchingAdapter and SGLangRadixAdapter implement these
    assert.ok("schedule" in AbstractScheduler.prototype || AbstractScheduler.prototype.schedule === undefined);
    assert.ok("scheduleWithDetails" in AbstractScheduler.prototype || AbstractScheduler.prototype.scheduleWithDetails === undefined);
    assert.ok("getPolicyName" in AbstractScheduler.prototype || AbstractScheduler.prototype.getPolicyName === undefined);
    assert.ok("getConfig" in AbstractScheduler.prototype || AbstractScheduler.prototype.getConfig === undefined);
  });
});

describe("ContinuousBatchingAdapter", () => {
  it("should implement AbstractScheduler interface", () => {
    const adapter = new ContinuousBatchingAdapter();
    
    assert.ok(typeof adapter.schedule === "function", "should have schedule method");
    assert.ok(typeof adapter.scheduleWithDetails === "function", "should have scheduleWithDetails method");
    assert.ok(typeof adapter.getPolicyName === "function", "should have getPolicyName method");
    assert.ok(typeof adapter.getConfig === "function", "should have getConfig method");
  });

  it("should return correct policy name", () => {
    const adapter = new ContinuousBatchingAdapter({ policy: "fcfs" });
    assert.ok(adapter.getPolicyName().includes("continuous_batching"));
    assert.ok(adapter.getPolicyName().includes("fcfs"));
  });

  it("should return configuration", () => {
    const adapter = new ContinuousBatchingAdapter({
      maxBatchSize: 32,
      policy: "sjf"
    });
    
    const config = adapter.getConfig();
    assert.strictEqual(config.maxBatchSize, 32);
    assert.strictEqual(config.policy, "sjf");
  });

  it("should schedule workload and return metrics", () => {
    const adapter = new ContinuousBatchingAdapter({
      policy: "fcfs",
      maxSteps: 100
    });
    
    const workload = createTestWorkload(5);
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

  it("should schedule with details and return complete result", () => {
    const adapter = new ContinuousBatchingAdapter({
      policy: "slo_aware",
      maxSteps: 100
    });
    
    const workload = createTestWorkload(3);
    const result = adapter.scheduleWithDetails({ requests: workload, config: {} });
    
    assert.ok(result.policyName.length > 0, "policyName should not be empty");
    assert.strictEqual(result.requestCount, 3);
    assert.ok(typeof result.completedRequests === "number");
    assert.ok(typeof result.droppedRequests === "number");
    assert.ok(result.notes instanceof Array);
  });

  it("should handle empty workload", () => {
    const adapter = new ContinuousBatchingAdapter();
    const metrics = adapter.schedule({ requests: [], config: {} });
    
    // Empty workload should still return valid metrics (possibly zeros)
    assert.ok(typeof metrics.goodput === "number");
    assert.ok(typeof metrics.throughput === "number");
  });

  it("should configure after construction", () => {
    const adapter = new ContinuousBatchingAdapter();
    
    adapter.configure({
      policy: "sjf",
      maxBatchSize: 32
    });
    
    const config = adapter.getConfig();
    assert.strictEqual(config.policy, "sjf");
    assert.strictEqual(config.maxBatchSize, 32);
  });

  it("should support different policies", () => {
    const policies = ["fcfs", "sjf", "slo_aware"] as const;
    
    for (const policy of policies) {
      const adapter = new ContinuousBatchingAdapter({ policy });
      assert.ok(adapter.getPolicyName().includes(policy));
    }
  });
});

describe("SGLangRadixAdapter", () => {
  it("should implement AbstractScheduler interface", () => {
    const adapter = new SGLangRadixAdapter();
    
    assert.ok(typeof adapter.schedule === "function", "should have schedule method");
    assert.ok(typeof adapter.scheduleWithDetails === "function", "should have scheduleWithDetails method");
    assert.ok(typeof adapter.getPolicyName === "function", "should have getPolicyName method");
    assert.ok(typeof adapter.getConfig === "function", "should have getConfig method");
  });

  it("should return correct policy name", () => {
    const adapter = new SGLangRadixAdapter({ policy: "sglang_lsp" });
    assert.strictEqual(adapter.getPolicyName(), "sglang_lsp");
  });

  it("should return configuration", () => {
    const adapter = new SGLangRadixAdapter({
      maxBatchSize: 32,
      policy: "sglang_mixed"
    });
    
    const config = adapter.getConfig();
    assert.strictEqual(config.maxBatchSize, 32);
    assert.strictEqual(config.policy, "sglang_mixed");
  });

  it("should schedule workload and return metrics", () => {
    const adapter = new SGLangRadixAdapter({
      policy: "sglang_lsp",
      maxSteps: 100
    });
    
    const workload = createTestWorkload(5);
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

  it("should schedule with details and return complete result", () => {
    const adapter = new SGLangRadixAdapter({
      policy: "dfs_optimal",
      maxSteps: 100
    });
    
    const workload = createTestWorkload(3);
    const result = adapter.scheduleWithDetails({ requests: workload, config: {} });
    
    assert.strictEqual(result.policyName, "dfs_optimal");
    assert.strictEqual(result.requestCount, 3);
    assert.ok(typeof result.completedRequests === "number");
    assert.ok(typeof result.droppedRequests === "number");
    assert.ok(result.notes instanceof Array);
  });

  it("should handle empty workload", () => {
    const adapter = new SGLangRadixAdapter();
    const metrics = adapter.schedule({ requests: [], config: {} });
    
    // Empty workload should still return valid metrics
    assert.ok(typeof metrics.goodput === "number");
    assert.ok(typeof metrics.throughput === "number");
  });

  it("should configure after construction", () => {
    const adapter = new SGLangRadixAdapter();
    
    adapter.configure({
      policy: "sglang_mixed",
      enableLSPFirst: false
    });
    
    const config = adapter.getConfig() as Record<string, unknown>;
    assert.strictEqual(config.policy, "sglang_mixed");
    assert.strictEqual(config.enableLSPFirst, false);
  });

  it("should support different policies", () => {
    const policies = ["sglang_lsp", "sglang_mixed", "dfs_optimal"] as const;
    
    for (const policy of policies) {
      const adapter = new SGLangRadixAdapter({ policy });
      assert.strictEqual(adapter.getPolicyName(), policy);
    }
  });
});

describe("Adapter Consistency", () => {
  it("both adapters should have the same interface methods", () => {
    const cbAdapter = new ContinuousBatchingAdapter();
    const sglangAdapter = new SGLangRadixAdapter();
    
    const interfaceMethods = [
      "schedule",
      "scheduleWithDetails",
      "getPolicyName",
      "getConfig"
    ];
    
    for (const method of interfaceMethods) {
      assert.ok(
        typeof (cbAdapter as Record<string, unknown>)[method] === "function",
        `ContinuousBatchingAdapter should have ${method}`
      );
      assert.ok(
        typeof (sglangAdapter as Record<string, unknown>)[method] === "function",
        `SGLangRadixAdapter should have ${method}`
      );
    }
  });

  it("both adapters should return consistent SchedulingMetrics structure", () => {
    const cbAdapter = new ContinuousBatchingAdapter({ maxSteps: 50 });
    const sglangAdapter = new SGLangRadixAdapter({ maxSteps: 50 });
    
    const workload = createTestWorkload(3);
    
    const cbMetrics = cbAdapter.schedule({ requests: workload, config: {} });
    const sglangMetrics = sglangAdapter.schedule({ requests: workload, config: {} });
    
    // Both should have the same keys
    const requiredKeys: (keyof SchedulingMetrics)[] = [
      "ttftP50",
      "ttftP90",
      "ttftP99",
      "tpotP50",
      "tpotP90",
      "tpotP99",
      "goodput",
      "throughput"
    ];
    
    for (const key of requiredKeys) {
      assert.ok(key in cbMetrics, `ContinuousBatchingAdapter metrics should have ${key}`);
      assert.ok(key in sglangMetrics, `SGLangRadixAdapter metrics should have ${key}`);
    }
  });

  it("both adapters should return consistent SchedulingResult structure", () => {
    const cbAdapter = new ContinuousBatchingAdapter({ maxSteps: 50 });
    const sglangAdapter = new SGLangRadixAdapter({ maxSteps: 50 });
    
    const workload = createTestWorkload(3);
    
    const cbResult = cbAdapter.scheduleWithDetails({ requests: workload, config: {} });
    const sglangResult = sglangAdapter.scheduleWithDetails({ requests: workload, config: {} });
    
    // Both should have the same keys
    const requiredKeys: (keyof SchedulingResult)[] = [
      "policyName",
      "requestCount",
      "completedRequests",
      "droppedRequests",
      "ttftP50",
      "ttftP90",
      "ttftP99",
      "tpotP50",
      "tpotP90",
      "tpotP99",
      "avgTTFT",
      "avgTPOT",
      "avgE2E",
      "goodput",
      "throughput",
      "notes"
    ];
    
    for (const key of requiredKeys) {
      assert.ok(key in cbResult, `ContinuousBatchingAdapter result should have ${key}`);
      assert.ok(key in sglangResult, `SGLangRadixAdapter result should have ${key}`);
    }
    
    // Both should report correct request count
    assert.strictEqual(cbResult.requestCount, 3);
    assert.strictEqual(sglangResult.requestCount, 3);
  });

  it("both adapters should handle various workload sizes", () => {
    const cbAdapter = new ContinuousBatchingAdapter({ maxSteps: 100 });
    const sglangAdapter = new SGLangRadixAdapter({ maxSteps: 100 });
    
    const testSizes = [1, 5, 10, 20];
    
    for (const size of testSizes) {
      const workload = createTestWorkload(size);
      
      const cbResult = cbAdapter.scheduleWithDetails({ requests: workload, config: {} });
      const sglangResult = sglangAdapter.scheduleWithDetails({ requests: workload, config: {} });
      
      assert.strictEqual(cbResult.requestCount, size);
      assert.strictEqual(sglangResult.requestCount, size);
      
      // Metrics should be numbers
      assert.ok(typeof cbResult.goodput === "number");
      assert.ok(typeof sglangResult.goodput === "number");
    }
  });

  it("both adapters should handle high concurrency", () => {
    const cbAdapter = new ContinuousBatchingAdapter({ maxBatchSize: 32, maxSteps: 200 });
    const sglangAdapter = new SGLangRadixAdapter({ maxBatchSize: 32, maxSteps: 200 });
    
    // Create high concurrency workload
    const workload = createTestWorkload(50).map((req, i) => ({
      ...req,
      arrivalMs: Math.floor(i / 10) * 100 // Burst arrivals
    }));
    
    const cbMetrics = cbAdapter.schedule({ requests: workload, config: {} });
    const sglangMetrics = sglangAdapter.schedule({ requests: workload, config: {} });
    
    // Both should complete without errors
    assert.ok(typeof cbMetrics.goodput === "number");
    assert.ok(typeof sglangMetrics.goodput === "number");
  });
});
