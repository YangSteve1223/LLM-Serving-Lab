/**
 * Tests for RealEngineAdapter utilities and DeepSeekAdapter
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateStatistics,
  calculateMAPE,
  calculateSMAPE,
  calculateMAE,
  generateTestPrompt,
  DEFAULT_VALIDATION_CONFIG
} from "../../../src/agents/learningAssistant/serving/engines/RealEngineAdapter.ts";
import { DeepSeekAdapter } from "../../../src/agents/learningAssistant/serving/engines/DeepSeekAdapter.ts";

test("calculateStatistics handles empty array", () => {
  const result = calculateStatistics([]);
  assert.equal(result.mean, 0);
  assert.equal(result.std, 0);
  assert.equal(result.count, 0);
});

test("calculateStatistics calculates mean correctly", () => {
  const values = [10, 20, 30, 40, 50];
  const result = calculateStatistics(values);
  assert.equal(result.mean, 30);
  assert.equal(result.count, 5);
});

test("calculateStatistics calculates standard deviation correctly", () => {
  const values = [10, 20, 30, 40, 50];
  const result = calculateStatistics(values);
  assert.ok(Math.abs(result.std - 14.14) < 0.1, `Expected std ~14.14, got ${result.std}`);
});

test("calculateStatistics calculates percentiles correctly", () => {
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const result = calculateStatistics(values);
  // P50 = index 5 in 10-element sorted array = 60
  // P95 = index 9 in 10-element sorted array = 100
  assert.equal(result.p50, 60);
  assert.equal(result.p95, 100);
  assert.equal(result.min, 10);
  assert.equal(result.max, 100);
});

test("calculateMAPE returns 0 for empty arrays", () => {
  const result = calculateMAPE([], []);
  assert.equal(result, 0);
});

test("calculateMAPE calculates correctly", () => {
  const actual = [100, 200, 300];
  const predicted = [110, 220, 330];
  const result = calculateMAPE(actual, predicted);
  // (|100-110|/100 + |200-220|/200 + |300-330|/300) / 3 * 100 = 10%
  assert.ok(Math.abs(result - 10) < 1, `Expected ~10%, got ${result}%`);
});

test("calculateMAPE handles zeros in actual values", () => {
  const actual = [100, 0, 300];
  const predicted = [110, 100, 330];
  const result = calculateMAPE(actual, predicted);
  // Only calculates for non-zero actual values
  assert.ok(Math.abs(result - 10) < 1, `Expected ~10%, got ${result}%`);
});

test("calculateSMAPE returns 0 for empty arrays", () => {
  const result = calculateSMAPE([], []);
  assert.equal(result, 0);
});

test("calculateSMAPE returns 0 for identical values", () => {
  const actual = [100, 200, 300];
  const predicted = [100, 200, 300];
  const result = calculateSMAPE(actual, predicted);
  assert.equal(result, 0);
});

test("calculateSMAPE handles different values", () => {
  const actual = [100, 200, 300];
  const predicted = [90, 180, 270];
  const result = calculateSMAPE(actual, predicted);
  assert.ok(result > 0, "SMAPE should be positive");
  assert.ok(result < 20, `SMAPE should be < 20%, got ${result}%`);
});

test("calculateMAE returns 0 for empty arrays", () => {
  const result = calculateMAE([], []);
  assert.equal(result, 0);
});

test("calculateMAE calculates correctly", () => {
  const actual = [100, 200, 300];
  const predicted = [110, 190, 310];
  const result = calculateMAE(actual, predicted);
  // (|100-110| + |200-190| + |300-310|) / 3 = (10 + 10 + 10) / 3 = 10
  assert.equal(result, 10);
});

test("generateTestPrompt creates non-empty prompt", () => {
  const prompt = generateTestPrompt(128);
  assert.ok(prompt.length > 0, "Prompt should not be empty");
  assert.ok(prompt.length > 100, `Prompt should be longer than 100 chars, got ${prompt.length}`);
});

test("generateTestPrompt is deterministic with seed", () => {
  const prompt1 = generateTestPrompt(128, 42);
  const prompt2 = generateTestPrompt(128, 42);
  assert.equal(prompt1, prompt2, "Same seed should produce same prompt");
});

test("generateTestPrompt produces different outputs with different seeds", () => {
  const prompt1 = generateTestPrompt(128, 42);
  const prompt2 = generateTestPrompt(128, 123);
  assert.notEqual(prompt1, prompt2, "Different seeds should produce different prompts");
});

test("DEFAULT_VALIDATION_CONFIG has expected values", () => {
  assert.deepEqual(DEFAULT_VALIDATION_CONFIG.promptLengths, [128, 512, 1024, 2048, 4096]);
  assert.equal(DEFAULT_VALIDATION_CONFIG.outputTokens, 128);
  assert.equal(DEFAULT_VALIDATION_CONFIG.repetitions, 3);
  assert.equal(DEFAULT_VALIDATION_CONFIG.delayBetweenRequests, 1000);
  assert.equal(DEFAULT_VALIDATION_CONFIG.maxRetries, 3);
});

// DeepSeekAdapter tests
test("DeepSeekAdapter uses default configuration", () => {
  // Delete any API key from env
  const originalKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  
  const adapter = new DeepSeekAdapter();
  const config = adapter.getConfig();
  
  assert.equal(config.engineType, "deepseek");
  assert.equal(config.model, "deepseek-chat");
  assert.equal(config.baseUrl, "https://api.deepseek.com");
  assert.equal(config.maxTokens, 1024);
  
  // Restore
  if (originalKey) {
    process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test("DeepSeekAdapter applies custom options", () => {
  const adapter = new DeepSeekAdapter({
    baseUrl: "https://custom.api.com",
    model: "custom-model",
    maxTokens: 500,
    timeoutMs: 30000,
    temperature: 0.5
  });
  
  const config = adapter.getConfig();
  assert.equal(config.baseUrl, "https://custom.api.com");
  assert.equal(config.model, "custom-model");
  assert.equal(config.maxTokens, 500);
  assert.equal(config.timeoutMs, 30000);
  assert.equal(config.temperature, 0.5);
});

test("DeepSeekAdapter reads API key from environment", () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "env-test-key";
  
  const adapter = new DeepSeekAdapter();
  assert.equal(adapter.getConfig().apiKey, "env-test-key");
  
  // Restore
  if (originalKey) {
    process.env.DEEPSEEK_API_KEY = originalKey;
  } else {
    delete process.env.DEEPSEEK_API_KEY;
  }
});

test("DeepSeekAdapter prefers explicit API key over environment", () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "env-key";
  
  const adapter = new DeepSeekAdapter({ apiKey: "explicit-key" });
  assert.equal(adapter.getConfig().apiKey, "explicit-key");
  
  // Restore
  if (originalKey) {
    process.env.DEEPSEEK_API_KEY = originalKey;
  } else {
    delete process.env.DEEPSEEK_API_KEY;
  }
});

test("DeepSeekAdapter isAvailable returns false without API key", () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  
  const adapter = new DeepSeekAdapter();
  assert.equal(adapter.isAvailable(), false);
  
  // Restore
  if (originalKey) {
    process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test("DeepSeekAdapter isAvailable returns true with API key", () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key";
  
  const adapter = new DeepSeekAdapter();
  assert.equal(adapter.isAvailable(), true);
  
  // Restore
  if (originalKey) {
    process.env.DEEPSEEK_API_KEY = originalKey;
  } else {
    delete process.env.DEEPSEEK_API_KEY;
  }
});
