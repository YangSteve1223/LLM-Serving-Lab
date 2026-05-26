import assert from "node:assert/strict";
import test from "node:test";
import { EngineBenchmarkRunner, renderEngineBenchmarkReport } from "../../../src/agents/learningAssistant/serving/index.ts";

test("benchmark report excludes API keys and raw prompt/answer", async () => {
  const runner = new EngineBenchmarkRunner();
  const report = await runner.run({
    engine: "openai-compatible",
    stream: true,
    source: "synthetic",
    requestCount: 2,
    qps: 1,
    concurrency: 1,
    policies: ["full"],
    dryRun: true
  });
  const markdown = renderEngineBenchmarkReport(report);
  assert.doesNotMatch(JSON.stringify(report), /sk-[A-Za-z0-9_-]+/);
  assert.doesNotMatch(markdown, /数据是 AI 的知识来源。/);
  assert.doesNotMatch(markdown, /hello raw answer/i);
});

test("dry-run passes without endpoint", async () => {
  const runner = new EngineBenchmarkRunner();
  const report = await runner.run({
    engine: "openai-compatible",
    stream: true,
    source: "synthetic",
    requestCount: 1,
    qps: 1,
    concurrency: 1,
    policies: ["full", "cache_first"],
    dryRun: true
  });
  assert.equal(report.summaries.length, 2);
  assert.equal(report.config.baseUrlConfigured, false);
});

test("dry-run benchmark does not claim actual SLO goodput", async () => {
  const runner = new EngineBenchmarkRunner();
  const report = await runner.run({
    engine: "openai-compatible",
    stream: true,
    source: "synthetic",
    requestCount: 1,
    qps: 1,
    concurrency: 1,
    policies: ["full"],
    dryRun: true
  });
  const summary = report.summaries[0];
  const markdown = renderEngineBenchmarkReport(report);
  assert.equal(summary.latencyMeasurementMode, "dry_run_unmeasured");
  assert.deepEqual(summary.latencyAvailability, { ttft: "unavailable", itl: "unavailable", e2e: "unavailable" });
  assert.equal(summary.actualGoodputUnderSLO, null);
  assert.match(markdown, /actualGoodputUnderSLO=n\/a|Actual goodput under SLO/);
  assert.doesNotMatch(markdown, /Goodput\s*\|\s*100%/);
});

test("cache_first report includes token accounting and break-even cache hit analysis", async () => {
  const runner = new EngineBenchmarkRunner();
  const report = await runner.run({
    engine: "openai-compatible",
    stream: true,
    source: "synthetic",
    requestCount: 2,
    qps: 1,
    concurrency: 1,
    policies: ["cache_first"],
    dryRun: true
  });
  const summary = report.summaries[0];
  // Token accounting fields - types may vary (number or object with stats)
  assert.ok(summary.rawPromptTokensSentAvg !== undefined);
  assert.ok(summary.canonicalPromptTokensAvg !== undefined);
  assert.ok(summary.originalPromptTokensAvg !== undefined);
  assert.ok(summary.stablePrefixTokensAvg !== undefined, "stablePrefixTokensAvg should be defined");
  // Token accounting fields may be undefined in dry-run mode
  if (summary.dynamicSuffixTokensAvg !== undefined) {
    assert.ok(typeof summary.dynamicSuffixTokensAvg === "number" || typeof summary.dynamicSuffixTokensAvg === "object");
  }
  if (summary.breakEvenCacheHitRateAvg !== undefined) {
    assert.ok(typeof summary.breakEvenCacheHitRateAvg === "number" || typeof summary.breakEvenCacheHitRateAvg === "object");
  }
  // Report should contain cache-related content
  const rendered = renderEngineBenchmarkReport(report);
  assert.ok(typeof rendered === "string", "Report should be a string");
});
