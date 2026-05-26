/**
 * Tests for Serving Pipeline V2
 * 
 * Tests the unified serving pipeline with configurable cache, scheduler, and speculative decoding.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";

// Import components under test
import { ServingPipelineV2, createPipelineV2, type PipelineV2Config } from "../../../src/agents/learningAssistant/serving/pipeline/ServingPipelineV2.ts";
import type { PDWorkloadRequest } from "../../../src/agents/learningAssistant/serving/ServingTrace.ts";

// Helper to generate test workload
function createTestWorkload(count: number = 10): PDWorkloadRequest[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `req-${i}`,
    arrivalMs: i * 100,
    prefillTokens: 200 + Math.floor(Math.random() * 800),
    decodeTokens: 50 + Math.floor(Math.random() * 200),
    cacheablePrefixTokens: 100 + Math.floor(Math.random() * 100),
    priority: i % 2 === 0 ? "interactive" : "background" as const
  }));
}

describe("ServingPipelineV2", () => {
  describe("Initialization", () => {
    it("should initialize with default configuration", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "radix",
        schedulerType: "continuous_batching"
      });
      
      const config = pipeline.getConfig();
      assert.strictEqual(config.cacheType, "radix");
      assert.strictEqual(config.schedulerType, "continuous_batching");
      assert.strictEqual(config.enableSpeculative, false);
    });

    it("should initialize with speculative decoding enabled", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "hierarchical",
        schedulerType: "continuous_batching",
        enableSpeculative: true
      });
      
      const config = pipeline.getConfig();
      assert.strictEqual(config.enableSpeculative, true);
    });

    it("should initialize with SLO configuration", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "radix",
        schedulerType: "continuous_batching",
        slo: {
          ttftMs: 500,
          tpotMs: 50,
          e2eMs: 5000
        }
      });
      
      const config = pipeline.getConfig();
      assert.deepStrictEqual(config.slo, {
        ttftMs: 500,
        tpotMs: 50,
        e2eMs: 5000
      });
    });

    it("should apply default values to configuration", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "radix",
        schedulerType: "continuous_batching"
      });
      
      const config = pipeline.getConfig();
      assert.strictEqual(config.maxRequests, 1000);
      assert.strictEqual(config.cacheSizeLimit, 1000000);
      assert.ok(config.slo !== undefined);
    });
  });

  describe("Scheduler Integration", () => {
    it("should use continuous batching scheduler", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "none",
        schedulerType: "continuous_batching",
        schedulerConfig: {
          policy: "fcfs"
        }
      });
      
      const schedulerConfig = pipeline.getSchedulerConfig();
      assert.ok(schedulerConfig !== null);
    });

    it("should use SGLang Radix scheduler", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "none",
        schedulerType: "sglang_radix",
        schedulerConfig: {
          policy: "sglang_lsp"
        }
      });
      
      const schedulerConfig = pipeline.getSchedulerConfig();
      assert.ok(schedulerConfig !== null);
    });

    it("should use speculative scheduler when enabled", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "none",
        schedulerType: "continuous_batching",
        enableSpeculative: true
      });
      
      const schedulerConfig = pipeline.getSchedulerConfig();
      assert.ok(schedulerConfig !== null);
      assert.ok(typeof schedulerConfig === "object");
    });
  });

  describe("Cache Configuration", () => {
    it("should initialize with no cache", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "none",
        schedulerType: "continuous_batching"
      });
      
      // No cache means getCacheStats returns null
      const stats = pipeline.getCacheStats();
      assert.strictEqual(stats, null);
    });

    it("should clear cache when configured", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "none",
        schedulerType: "continuous_batching"
      });
      
      // Should not throw
      pipeline.clearCache();
    });
  });

  describe("executeScheduling", () => {
    it("should schedule workload and return metrics", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "none",
        schedulerType: "continuous_batching"
      });
      
      const workload = createTestWorkload(10);
      const schedulingResult = pipeline.executeScheduling(workload, []);
      
      // STRENGTHENED: Verify metrics types and specific value ranges
      assert.strictEqual(typeof schedulingResult.metrics.ttftP50, "number", "TTFT P50 should be number");
      assert.ok(schedulingResult.metrics.ttftP50 >= 0, "TTFT P50 should be non-negative");
      assert.ok(schedulingResult.metrics.ttftP50 < 100000, "TTFT P50 should be reasonable (<100s)");
      
      assert.strictEqual(typeof schedulingResult.metrics.goodput, "number", "Goodput should be number");
      assert.ok(schedulingResult.metrics.goodput >= 0, "Goodput should be non-negative");
      assert.ok(schedulingResult.metrics.goodput <= 1, "Goodput should be <= 1");
      
      assert.strictEqual(typeof schedulingResult.metrics.throughput, "number", "Throughput should be number");
      assert.ok(schedulingResult.metrics.throughput >= 0, "Throughput should be non-negative");
      
      assert.strictEqual(schedulingResult.schedulerType, "continuous_batching");
    });

    it("should include metadata in result", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "none",
        schedulerType: "continuous_batching"
      });
      
      const workload = createTestWorkload(5);
      const schedulingResult = pipeline.executeScheduling(workload, []);
      
      // STRENGTHENED: Verify specific metadata values
      assert.strictEqual(schedulingResult.metadata.requestsProcessed, 5);
      
      assert.strictEqual(typeof schedulingResult.metadata.cacheHits, "number", "Cache hits should be number");
      assert.ok(schedulingResult.metadata.cacheHits >= 0, "Cache hits should be non-negative");
      
      assert.strictEqual(typeof schedulingResult.metadata.cacheMisses, "number", "Cache misses should be number");
      assert.ok(schedulingResult.metadata.cacheMisses >= 0, "Cache misses should be non-negative");
      
      // STRENGTHENED: Verify cache hits + misses = processed requests
      assert.strictEqual(
        schedulingResult.metadata.cacheHits + schedulingResult.metadata.cacheMisses,
        5,
        "Cache hits + misses should equal processed requests"
      );
    });

    it("should include speculative stats when enabled", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "none",
        schedulerType: "continuous_batching",
        enableSpeculative: true
      });
      
      const workload = createTestWorkload(5);
      const schedulingResult = pipeline.executeScheduling(workload, []);
      
      assert.ok(typeof schedulingResult.metadata.speculativeRequests === "number");
    });
  });

  describe("executeSimulation", () => {
    it("should run policy comparison simulation", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "none",
        schedulerType: "continuous_batching"
      });
      
      const workload = createTestWorkload(10);
      const simulationResult = pipeline.executeSimulation(workload, []);
      
      assert.ok(typeof simulationResult.policyName === "string");
      assert.ok(typeof simulationResult.requestCount === "number");
      assert.ok(typeof simulationResult.goodput === "number");
      assert.ok(typeof simulationResult.latency === "object");
    });

    it("should include utilization metrics", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "none",
        schedulerType: "continuous_batching"
      });
      
      const workload = createTestWorkload(5);
      const simulationResult = pipeline.executeSimulation(workload, []);
      
      assert.ok(typeof simulationResult.utilization === "object");
    });

    it("should include queueing metrics", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "none",
        schedulerType: "continuous_batching"
      });
      
      const workload = createTestWorkload(5);
      const simulationResult = pipeline.executeSimulation(workload, []);
      
      assert.ok(typeof simulationResult.queueing === "object");
    });
  });

  describe("run (Complete Pipeline)", () => {
    it("should execute complete pipeline flow", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "none",
        schedulerType: "continuous_batching"
      });
      
      const workload = createTestWorkload(10);
      const result = pipeline.run(workload);
      
      assert.ok(result.cacheLookup instanceof Array);
      assert.strictEqual(result.cacheLookup.length, 10);
      assert.ok(typeof result.scheduling === "object");
      assert.ok(typeof result.simulation === "object");
      assert.ok(typeof result.timestamp === "string");
      assert.ok(typeof result.config === "object");
    });

    it("should return complete result structure", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "none",
        schedulerType: "continuous_batching",
        enableSpeculative: true,
        slo: {
          ttftMs: 500,
          tpotMs: 50,
          e2eMs: 5000
        }
      });
      
      const workload = createTestWorkload(5);
      const result = pipeline.run(workload);
      
      // Verify complete structure
      assert.strictEqual(result.config.cacheType, "none");
      assert.strictEqual(result.config.enableSpeculative, true);
      
      // Scheduling result
      assert.strictEqual(result.scheduling.schedulerType, "continuous_batching");
      assert.strictEqual(result.scheduling.metadata.requestsProcessed, 5);
      
      // Simulation result
      assert.strictEqual(result.simulation.requestCount, 5);
      assert.ok(result.simulation.latency.ttftP50 >= 0);
    });

    it("should handle empty workload", () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "none",
        schedulerType: "continuous_batching"
      });
      
      const result = pipeline.run([]);
      
      assert.strictEqual(result.cacheLookup.length, 0);
      assert.strictEqual(result.scheduling.metadata.requestsProcessed, 0);
    });
  });

  describe("calibrateFromAPI", () => {
    it("should run calibration in mock mode when no API key", async () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "none",
        schedulerType: "continuous_batching",
        enableSpeculative: true
      });
      
      const result = await pipeline.calibrateFromAPI();
      
      assert.ok(typeof result.converged === "boolean");
      assert.ok(typeof result.totalIterations === "number");
      assert.ok(result.iterations instanceof Array);
    });

    it("should return calibration result with iteration details", async () => {
      const pipeline = new ServingPipelineV2({
        cacheType: "none",
        schedulerType: "continuous_batching",
        enableSpeculative: true
      });
      
      const result = await pipeline.calibrateFromAPI();
      
      for (const iteration of result.iterations) {
        assert.ok(iteration.iteration >= 1);
        assert.ok(iteration.apiMeasurements instanceof Array);
        assert.ok(iteration.comparisonReports instanceof Array);
        assert.ok(typeof iteration.mape === "object");
      }
    });
  });
});

describe("createPipelineV2 Presets", () => {
  describe("development preset", () => {
    it("should create development pipeline", () => {
      const pipeline = createPipelineV2("development");
      const config = pipeline.getConfig();
      
      assert.strictEqual(config.cacheType, "radix");
      assert.strictEqual(config.schedulerType, "continuous_batching");
      assert.strictEqual(config.enableSpeculative, false);
      assert.strictEqual(config.maxRequests, 100);
    });
  });

  describe("production preset", () => {
    it("should create production pipeline", () => {
      const pipeline = createPipelineV2("production");
      const config = pipeline.getConfig();
      
      assert.strictEqual(config.cacheType, "hierarchical");
      assert.strictEqual(config.schedulerType, "continuous_batching");
      assert.strictEqual(config.enableSpeculative, true);
      assert.strictEqual(config.maxRequests, 5000);
    });
  });

  describe("research preset", () => {
    it("should create research pipeline", () => {
      const pipeline = createPipelineV2("research");
      const config = pipeline.getConfig();
      
      assert.strictEqual(config.cacheType, "radix");
      assert.strictEqual(config.schedulerType, "sglang_radix");
      assert.strictEqual(config.enableSpeculative, true);
    });
  });

  describe("unknown preset defaults to development", () => {
    it("should default to development config", () => {
      const pipeline = createPipelineV2("unknown" as any);
      const config = pipeline.getConfig();
      
      // Should fall back to development defaults
      assert.strictEqual(config.cacheType, "radix");
      assert.strictEqual(config.schedulerType, "continuous_batching");
    });
  });
});
