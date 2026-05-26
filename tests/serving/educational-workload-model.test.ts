/**
 * Tests for EducationalWorkloadModel
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  EducationalWorkloadModel,
  createTypicalWorkload,
  createHeavyWorkload,
  createLightWorkload
} from "../../src/agents/learningAssistant/serving/workload/EducationalWorkloadModel.ts";

describe("EducationalWorkloadModel", () => {
  it("should create a workload model with default config", () => {
    const workload = new EducationalWorkloadModel({
      numStudents: 50,
      numCourses: 5,
      avgConcurrentUsers: 10,
      peakConcurrentUsers: 40,
      avgDialogueTurns: 8,
      tidalStrength: 0.5,
      prefixReuseRate: 0.35,
      courseMaterialTokens: 2048,
      systemPromptTokens: 512
    });

    const profile = workload.getProfile();
    assert.ok(profile.prefixReuseRate === 0.35, "Prefix reuse rate should match");
    assert.ok(profile.prc === 0.35, "PRC should equal prefix reuse rate");
    assert.ok(profile.tii > 1, "TII should be greater than 1 (peak > avg)");
  });

  it("should generate synthetic trace", () => {
    const workload = createTypicalWorkload();
    const trace = workload.generateTrace(10); // 10 minutes

    assert.ok(trace.length > 0, "Should generate requests");
    assert.ok(trace[0].id, "Request should have an ID");
    assert.ok(trace[0].studentId, "Request should have a student ID");
    assert.ok(trace[0].courseId, "Request should have a course ID");
    assert.ok(trace[0].arrivalTimeMs >= 0, "Arrival time should be non-negative");
    assert.ok(trace[0].inputTokens > 0, "Input tokens should be positive");
    assert.ok(trace[0].outputTokens > 0, "Output tokens should be positive");
  });

  it("should generate PD workload trace compatible with simulator", () => {
    const workload = createTypicalWorkload();
    const pdTrace = workload.generatePDWorkloadTrace(5);

    assert.ok(pdTrace.length > 0, "Should generate PD workload");
    assert.ok(pdTrace[0].id, "Request should have an ID");
    assert.strictEqual(typeof pdTrace[0].arrivalMs, "number", "Should have arrival time");
    assert.strictEqual(typeof pdTrace[0].prefillTokens, "number", "Should have prefill tokens");
    assert.strictEqual(typeof pdTrace[0].decodeTokens, "number", "Should have decode tokens");
    assert.strictEqual(typeof pdTrace[0].cacheablePrefixTokens, "number", "Should have cacheable prefix");
  });

  it("should export trace to JSONL format", () => {
    const workload = createLightWorkload();
    const trace = workload.generateTrace(1);
    const jsonl = workload.exportToJSONL(trace.slice(0, 5));

    const lines = jsonl.split("\n").filter(l => l.length > 0);
    assert.strictEqual(lines.length, 5, "Should have 5 JSON lines");

    // Verify each line is valid JSON
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.ok(parsed.id, "Each JSON should have an id");
    }
  });

  it("should analyze workload characteristics", () => {
    const workload = createTypicalWorkload();
    const trace = workload.generateTrace(10);
    const analysis = workload.analyze(trace);

    assert.ok(analysis.profile, "Should have profile");
    assert.ok(analysis.theoreticalCacheHitUpperBound >= 0, "Upper bound should be valid");
    assert.ok(analysis.prefixReuseAnalysis, "Should have prefix analysis");
    assert.ok(analysis.arrivalAnalysis, "Should have arrival analysis");
    assert.ok(analysis.lengthAnalysis, "Should have length analysis");
    assert.ok(analysis.experimentVariables, "Should have experiment variables");

    // Check experiment variables
    const { LCR, PRC, TII } = analysis.experimentVariables;
    assert.ok(LCR > 0 && LCR < 1, "LCR should be between 0 and 1");
    assert.ok(PRC >= 0 && PRC <= 1, "PRC should be between 0 and 1");
    assert.ok(TII >= 1, "TII should be at least 1");
  });

  it("should compute correct prefix reuse metrics", () => {
    const workload = createTypicalWorkload();
    const trace = workload.generateTrace(5);
    const analysis = workload.analyze(trace);

    const { avgSharedPrefix, maxSharedPrefix, prefixDiversity } = analysis.prefixReuseAnalysis;
    assert.ok(avgSharedPrefix >= 0, "Average shared prefix should be non-negative");
    assert.ok(maxSharedPrefix >= avgSharedPrefix, "Max should be >= average");
    assert.ok(prefixDiversity >= 0, "Diversity should be non-negative");
  });

  it("should create different workload intensities", () => {
    const light = createLightWorkload();
    const typical = createTypicalWorkload();
    const heavy = createHeavyWorkload();

    const lightTrace = light.generateTrace(1);
    const typicalTrace = typical.generateTrace(1);
    const heavyTrace = heavy.generateTrace(1);

    // All workloads should generate some requests
    assert.ok(lightTrace.length > 0, "Light should generate requests");
    assert.ok(typicalTrace.length > 0, "Typical should generate requests");
    assert.ok(heavyTrace.length > 0, "Heavy should generate requests");
  });
});

describe("Workload Profile Validation", () => {
  it("should have valid task type distribution", () => {
    const workload = createTypicalWorkload();
    const profile = workload.getProfile();

    const total = Object.values(profile.taskTypeDistribution).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 0.001, "Task type distribution should sum to ~1");
  });

  it("should have valid multi-turn rounds", () => {
    const workload = createTypicalWorkload();
    const profile = workload.getProfile();

    assert.ok(profile.multiTurnRounds.min >= 1, "Min rounds should be at least 1");
    assert.ok(profile.multiTurnRounds.max >= profile.multiTurnRounds.min, "Max should be >= min");
  });

  it("should handle bimodal output length", () => {
    const workload = createTypicalWorkload();
    const trace = workload.generateTrace(5);
    const analysis = workload.analyze(trace);

    // Bimodal ratio should be between 0 and 1
    assert.ok(analysis.lengthAnalysis.bimodalRatio >= 0, "Bimodal ratio should be non-negative");
    assert.ok(analysis.lengthAnalysis.bimodalRatio <= 1, "Bimodal ratio should be <= 1");
  });
});

describe("Experiment Variables", () => {
  it("should compute LCR correctly", () => {
    const workload = new EducationalWorkloadModel({
      numStudents: 10,
      numCourses: 2,
      avgConcurrentUsers: 5,
      peakConcurrentUsers: 10,
      avgDialogueTurns: 5,
      tidalStrength: 0.5,
      prefixReuseRate: 0.3,
      courseMaterialTokens: 4096,
      systemPromptTokens: 512
    });

    const profile = workload.getProfile();
    // LCR = (courseMaterial + systemPrompt + 200) / 128K
    const expectedLCR = (4096 + 512 + 200) / (128 * 1024);
    assert.ok(Math.abs(profile.lcr - expectedLCR) < 0.001, "LCR should be computed correctly");
  });

  it("should compute TII correctly", () => {
    const workload = new EducationalWorkloadModel({
      numStudents: 10,
      numCourses: 2,
      avgConcurrentUsers: 10,
      peakConcurrentUsers: 50,
      avgDialogueTurns: 5,
      tidalStrength: 0.5,
      prefixReuseRate: 0.3,
      courseMaterialTokens: 2048,
      systemPromptTokens: 512
    });

    const profile = workload.getProfile();
    assert.strictEqual(profile.tii, 5, "TII should be peak/avg = 50/10 = 5");
  });
});
