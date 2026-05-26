/**
 * Tests for CacheExperimentRunner
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  CacheExperimentRunner,
  createDefaultExperiment,
  createComprehensiveExperiment
} from "../../src/agents/learningAssistant/serving/cache/CacheExperimentRunner.ts";

describe("CacheExperimentRunner", () => {
  let runner: CacheExperimentRunner;

  beforeEach(() => {
    runner = new CacheExperimentRunner({
      name: "Test Experiment",
      type: "cache_on_off",
      trials: 2,
      requestsPerTrial: 100,
      warmupRequests: 10,
      traceDurationMinutes: 5
    });
  });

  it("should run a single experiment with caching disabled", () => {
    const metrics = runner.runExperiment("LRU", false, false);

    assert.ok(metrics.requestHitRate >= 0, "Request hit rate should be valid");
    assert.ok(metrics.tokenHitRate >= 0, "Token hit rate should be valid");
    assert.ok(metrics.avgTTFTMs > 0, "Average TTFT should be positive");
    assert.ok(metrics.stdDev >= 0, "Std dev should be non-negative");
    assert.ok(metrics.confidenceInterval95, "Should have CI");
    assert.ok(Array.isArray(metrics.rawTTFT), "Should have raw TTFT data");
  });

  it("should run a single experiment with caching enabled", () => {
    const metrics = runner.runExperiment("LRU", true, true);

    assert.ok(metrics.requestHitRate >= 0, "Request hit rate should be valid");
    assert.ok(metrics.ttftReductionMs >= 0, "TTFT reduction should be non-negative");
    assert.ok(metrics.throughputGain >= 1, "Throughput gain should be >= 1");
    assert.ok(metrics.tokensSaved >= 0, "Tokens saved should be non-negative");
  });

  it("should compare different eviction strategies", () => {
    const lruMetrics = runner.runExperiment("LRU", true, true);
    const lfuMetrics = runner.runExperiment("LFU", true, true);

    assert.ok(lruMetrics.requestHitRate >= 0, "LRU should produce valid metrics");
    assert.ok(lfuMetrics.requestHitRate >= 0, "LFU should produce valid metrics");

    // Results may differ based on access patterns
    assert.ok(
      lruMetrics.avgTTFTMs !== lfuMetrics.avgTTFTMs ||
      lruMetrics.requestHitRate !== lfuMetrics.requestHitRate,
      "Different strategies should potentially produce different results"
    );
  });

  it("should run comparative experiment", () => {
    const result = runner.runComparativeExperiment();

    assert.strictEqual(result.experimentName, "Test Experiment", "Should have correct name");
    assert.ok(result.timestamp, "Should have timestamp");
    assert.ok(result.baselineMetrics, "Should have baseline metrics");
    assert.ok(result.comparisonMetrics, "Should have comparison metrics");
    assert.ok(result.workloadAnalysis, "Should have workload analysis");
    assert.ok(result.duration.totalMs > 0, "Duration should be tracked");
    assert.ok(result.notes.length > 0, "Should have notes");
  });

  it("should include statistical significance in results", () => {
    const result = runner.runComparativeExperiment();

    // Check that effect sizes are computed
    for (const [strategy, metrics] of Object.entries(result.comparisonMetrics)) {
      assert.ok(typeof metrics.effectSize === "number", `Strategy ${strategy} should have effect size`);
    }
  });

  it("should store results in results map", () => {
    runner.runComparativeExperiment();
    
    const results = runner.getResults();
    assert.ok(results.has("Test Experiment"), "Should have stored the result");
  });
});

describe("CacheExperimentRunner Configuration", () => {
  it("should use default configuration when none provided", () => {
    const runner = new CacheExperimentRunner();
    const metrics = runner.runExperiment("LRU", false);

    assert.ok(metrics.avgTTFTMs > 0, "Should produce results with defaults");
  });

  it("should create default experiment", () => {
    const runner = createDefaultExperiment();
    const result = runner.runComparativeExperiment();

    assert.ok(result.experimentName.includes("Default"), "Should have default name");
  });

  it("should create comprehensive experiment", () => {
    const runner = createComprehensiveExperiment();
    const result = runner.runComparativeExperiment();

    assert.ok(result.experimentName.includes("Comprehensive"), "Should have comprehensive name");
    // Comprehensive should test multiple strategies
    assert.ok(Object.keys(result.comparisonMetrics).length >= 3, "Should have multiple strategies");
  });

  it("should respect custom cache configuration", () => {
    const runner = new CacheExperimentRunner({
      cacheConfig: {
        maxMemoryMB: 2048,
        evictionStrategies: ["LRU", "FLOP_AWARE"],
        enableCoursePooling: true
      }
    });

    const result = runner.runComparativeExperiment();
    assert.ok(result.config.cacheConfig.maxMemoryMB === 2048, "Should use custom memory");
  });
});

describe("Experiment Metrics Validation", () => {
  it("should calculate percentiles correctly", () => {
    const runner = new CacheExperimentRunner({
      trials: 1,
      requestsPerTrial: 1000
    });

    const metrics = runner.runExperiment("LRU", false);

    // P99 should be >= P90
    assert.ok(metrics.p99TTFT >= metrics.p90TTFT, "P99 should be >= P90");
    // P90 should be >= P50
    assert.ok(metrics.p90TTFT >= metrics.p50TTFT, "P90 should be >= P50");
  });

  it("should compute confidence intervals", () => {
    const runner = new CacheExperimentRunner({
      trials: 5,
      requestsPerTrial: 500
    });

    const metrics = runner.runExperiment("LRU", false);

    assert.ok(metrics.confidenceInterval95.lower <= metrics.confidenceInterval95.upper, "CI lower should be <= upper");
    assert.ok(metrics.confidenceInterval95.lower <= metrics.avgTTFTMs, "CI lower should be <= mean");
    assert.ok(metrics.confidenceInterval95.upper >= metrics.avgTTFTMs, "CI upper should be >= mean");
  });

  it("should track token savings", () => {
    const runner = new CacheExperimentRunner({
      trials: 1,
      requestsPerTrial: 200
    });

    const cachedMetrics = runner.runExperiment("LRU", true, true);
    const uncachedMetrics = runner.runExperiment("LRU", false, false);

    assert.ok(cachedMetrics.tokensSaved >= 0, "Tokens saved should be non-negative");
    assert.strictEqual(uncachedMetrics.tokensSaved, 0, "Uncached should have 0 saved");
  });
});

describe("Report Generation", () => {
  let runner: CacheExperimentRunner;
  let result: ReturnType<typeof runComparativeExperimentSync>;

  beforeEach(() => {
    runner = new CacheExperimentRunner({
      name: "Report Test",
      type: "cache_on_off",
      trials: 1,
      requestsPerTrial: 50,
      traceDurationMinutes: 2
    });
    result = runner.runComparativeExperiment();
  });

  it("should generate report", () => {
    const report = runner.generateReport(result);

    assert.ok(report.summary, "Should have summary");
    assert.ok(report.tables, "Should have tables");
    assert.ok(report.tables.comparisonTable, "Should have comparison table");
    assert.ok(report.tables.metricsTable, "Should have metrics table");
    assert.ok(report.tables.statisticalSignificanceTable, "Should have statistical table");
    assert.ok(report.charts, "Should have charts");
    assert.ok(report.recommendations.length > 0, "Should have recommendations");
  });

  it("should include workload profile in report", () => {
    const report = runner.generateReport(result);

    assert.ok(report.summary.includes("Prefix Reuse Rate"), "Should mention prefix reuse");
    assert.ok(report.summary.includes("LCR"), "Should mention LCR");
    assert.ok(report.summary.includes("TII"), "Should mention TII");
  });

  it("should format recommendations correctly", () => {
    const report = runner.generateReport(result);

    for (const rec of report.recommendations) {
      assert.ok(rec.length > 0, "Recommendation should not be empty");
      assert.ok(
        rec.includes("**") || rec.includes("Recommended") || rec.includes("High") || rec.includes("Low"),
        "Recommendation should have proper formatting"
      );
    }
  });
});

// Helper function to run comparative experiment synchronously for tests
function runComparativeExperimentSync(runner: CacheExperimentRunner) {
  return runner.runComparativeExperiment();
}

describe("Experiment Workflow", () => {
  it("should complete full experiment workflow", () => {
    const runner = createDefaultExperiment();

    // Run experiment
    const result = runner.runComparativeExperiment();
    assert.ok(result, "Should complete experiment");

    // Generate report
    const report = runner.generateReport(result);
    assert.ok(report.summary, "Should generate report");

    // Verify recommendations
    assert.ok(report.recommendations.length > 0, "Should have recommendations");

    // Check all tables are populated
    assert.ok(report.tables.comparisonTable.includes("|"), "Comparison table should have formatting");
    assert.ok(report.tables.metricsTable.includes("P50"), "Metrics table should have percentiles");
  });

  it("should handle multiple experiment runs", () => {
    const runner = new CacheExperimentRunner();

    const result1 = runner.runComparativeExperiment();
    runner.config.name = "Second Experiment";
    const result2 = runner.runComparativeExperiment();

    const results = runner.getResults();
    assert.ok(results.size >= 2, "Should store multiple results");
  });
});
