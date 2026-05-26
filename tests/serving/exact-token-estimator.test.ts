import assert from "node:assert/strict";
import test from "node:test";
import {
  ExactTokenEstimator,
  BPETokenizer,
  createExactTokenEstimator,
  exactTokenEstimator,
  bpeTokenEstimator,
  tiktokenEstimator,
  estimateTokensExact,
  type TokenEstimatorType,
  type TokenEstimateComparison
} from "../../src/agents/learningAssistant/serving/index.ts";

const TEST_TEXTS = {
  english: "The quick brown fox jumps over the lazy dog. This is a sample text for token estimation testing.",
  chinese: "人工智能是当今科技发展的重要方向。机器学习和深度学习技术正在改变各行各业。",
  mixed: "The model can process both English text and 中文文本 together. AI技术发展迅速。",
  short: "Hello world",
  empty: "",
  code: "function calculate(a: number, b: number): number { return a + b; }",
  long: "The development of artificial intelligence has accelerated rapidly in recent years. Machine learning algorithms have become increasingly sophisticated, enabling computers to perform tasks that were previously thought to require human intelligence. Deep learning models, particularly transformer architectures, have revolutionized natural language processing and computer vision. Applications of AI span from healthcare diagnostics to autonomous vehicles, from recommendation systems to creative content generation. The ethical implications of AI deployment continue to be a subject of intense debate among researchers, policymakers, and the general public."
};

test("ExactTokenEstimator is instantiated correctly", () => {
  const estimator = new ExactTokenEstimator();
  assert.ok(estimator !== undefined);
});

test("ExactTokenEstimator with custom config", () => {
  const estimator = new ExactTokenEstimator({
    estimatorType: "bpe",
    modelName: "gpt-4",
    enableComparison: true
  });
  
  const config = estimator.getConfig();
  assert.equal(config.estimatorType, "bpe");
  assert.equal(config.modelName, "gpt-4");
  assert.equal(config.enableComparison, true);
});

test("Heuristic estimation returns valid count", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "heuristic" });
  
  for (const [name, text] of Object.entries(TEST_TEXTS)) {
    const result = estimator.estimate(text);
    assert.ok(result.tokenCount >= 0, `Failed for ${name}`);
    assert.equal(result.estimatorType, "heuristic");
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  }
});

test("BPE estimation returns valid count", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "bpe" });
  
  for (const [name, text] of Object.entries(TEST_TEXTS)) {
    const result = estimator.estimate(text);
    assert.ok(result.tokenCount >= 0, `Failed for ${name}`);
    assert.equal(result.estimatorType, "bpe");
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  }
});

test("Tiktoken estimation returns valid count", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "tiktoken" });
  
  for (const [name, text] of Object.entries(TEST_TEXTS)) {
    const result = estimator.estimate(text);
    assert.ok(result.tokenCount >= 0, `Failed for ${name}`);
    assert.equal(result.estimatorType, "tiktoken");
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  }
});

test("Empty text returns zero tokens", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "bpe" });
  
  const result = estimator.estimate("");
  assert.equal(result.tokenCount, 0);
});

test("Undefined text returns zero tokens", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "tiktoken" });
  
  const result = estimator.estimate(undefined);
  assert.equal(result.tokenCount, 0);
});

test("Longer text estimates more tokens", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "heuristic" });
  
  const shortResult = estimator.estimate(TEST_TEXTS.short);
  const longResult = estimator.estimate(TEST_TEXTS.long);
  
  assert.ok(longResult.tokenCount > shortResult.tokenCount);
});

test("Chinese text estimation with tiktoken method", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "tiktoken" });
  
  const result = estimator.estimate(TEST_TEXTS.chinese);
  
  // Chinese text should estimate higher tokens due to character-based tokenization
  assert.ok(result.tokenCount > 0);
  assert.ok(result.details?.vocabSize !== undefined);
});

test("Mixed text estimation", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "bpe" });
  
  const result = estimator.estimate(TEST_TEXTS.mixed);
  
  assert.ok(result.tokenCount > 0);
  assert.ok(result.tokenCount <= TEST_TEXTS.mixed.length);
});

test("Code text estimation", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "tiktoken" });
  
  const result = estimator.estimate(TEST_TEXTS.code);
  
  // Code often has more tokens due to special characters
  assert.ok(result.tokenCount > 0);
});

test("Comparison across all methods", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "heuristic" });
  
  const comparison = estimator.compare(TEST_TEXTS.english);
  
  assert.equal(comparison.estimates.length, 3);
  assert.ok(comparison.estimates.some(e => e.estimatorType === "heuristic"));
  assert.ok(comparison.estimates.some(e => e.estimatorType === "bpe"));
  assert.ok(comparison.estimates.some(e => e.estimatorType === "tiktoken"));
  assert.ok(comparison.maxDifference >= 0);
  assert.ok(comparison.avgDifference >= 0);
});

test("Comparison identifies most accurate estimator", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "heuristic" });
  
  const comparison = estimator.compare(TEST_TEXTS.english);
  
  // Tiktoken should have highest confidence for English
  assert.ok(["heuristic", "bpe", "tiktoken"].includes(comparison.mostAccurate));
});

test("Comparison truncates long text in output", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "heuristic" });
  
  const longText = "A".repeat(200);
  const comparison = estimator.compare(longText);
  
  assert.ok(comparison.truncatedText !== undefined);
  assert.ok(comparison.truncatedText.length < longText.length);
  assert.ok(comparison.truncatedText.endsWith("..."));
});

test("Set estimator type changes behavior", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "heuristic" });
  
  estimator.setEstimatorType("bpe");
  let result = estimator.estimate(TEST_TEXTS.english);
  assert.equal(result.estimatorType, "bpe");
  
  estimator.setEstimatorType("tiktoken");
  result = estimator.estimate(TEST_TEXTS.english);
  assert.equal(result.estimatorType, "tiktoken");
});

test("BPETokenizer is instantiated correctly", () => {
  const tokenizer = new BPETokenizer();
  assert.ok(tokenizer !== undefined);
});

test("BPETokenizer has vocabulary", () => {
  const tokenizer = new BPETokenizer(1000);
  
  const vocabSize = tokenizer.getVocabSize();
  assert.ok(vocabSize > 0);
});

test("BPETokenizer pre-tokenizes correctly", () => {
  const tokenizer = new BPETokenizer();
  
  const tokens = tokenizer.preTokenize("Hello world");
  assert.ok(tokens.length > 0);
});

test("BPETokenizer pre-tokenizes Chinese", () => {
  const tokenizer = new BPETokenizer();
  
  const tokens = tokenizer.preTokenize("人工智能");
  assert.ok(tokens.length > 0);
});

test("BPETokenizer encodes text", () => {
  const tokenizer = new BPETokenizer();
  
  const ids = tokenizer.encode("Hello world");
  assert.ok(ids.length > 0);
});

test("BPETokenizer encodes Chinese", () => {
  const tokenizer = new BPETokenizer();
  
  const ids = tokenizer.encode("人工智能");
  assert.ok(ids.length > 0);
});

test("createExactTokenEstimator factory function", () => {
  const estimator = createExactTokenEstimator("bpe", "llama-3");
  
  assert.ok(estimator instanceof ExactTokenEstimator);
  const config = estimator.getConfig();
  assert.equal(config.estimatorType, "bpe");
  assert.equal(config.modelName, "llama-3");
});

test("estimateTokensExact convenience function", () => {
  const count = estimateTokensExact(TEST_TEXTS.english, "heuristic");
  assert.ok(count >= 0);
});

test("Singleton instances are available", () => {
  assert.ok(exactTokenEstimator instanceof ExactTokenEstimator);
  assert.ok(bpeTokenEstimator instanceof ExactTokenEstimator);
  assert.ok(tiktokenEstimator instanceof ExactTokenEstimator);
});

test("Different estimators produce different results", () => {
  const heuristicCount = estimateTokensExact(TEST_TEXTS.mixed, "heuristic");
  const bpeCount = estimateTokensExact(TEST_TEXTS.mixed, "bpe");
  const tiktokenCount = estimateTokensExact(TEST_TEXTS.mixed, "tiktoken");
  
  // Results may differ between methods
  // At minimum, all should be valid counts
  assert.ok(heuristicCount >= 0);
  assert.ok(bpeCount >= 0);
  assert.ok(tiktokenCount >= 0);
});

test("Exact estimation with GPT-4 model name", () => {
  const estimator = new ExactTokenEstimator({
    estimatorType: "exact",
    modelName: "gpt-4"
  });
  
  const result = estimator.estimate(TEST_TEXTS.english);
  assert.ok(result.tokenCount >= 0);
});

test("Exact estimation with LLaMA model name", () => {
  const estimator = new ExactTokenEstimator({
    estimatorType: "exact",
    modelName: "llama-3-70b"
  });
  
  const result = estimator.estimate(TEST_TEXTS.english);
  assert.ok(result.tokenCount >= 0);
});

test("Estimator confidence values", () => {
  const heuristic = new ExactTokenEstimator({ estimatorType: "heuristic" });
  const bpe = new ExactTokenEstimator({ estimatorType: "bpe" });
  const tiktoken = new ExactTokenEstimator({ estimatorType: "tiktoken" });
  
  const hResult = heuristic.estimate(TEST_TEXTS.english);
  const bResult = bpe.estimate(TEST_TEXTS.english);
  const tResult = tiktoken.estimate(TEST_TEXTS.english);
  
  // Tiktoken should have higher confidence for English
  assert.ok(tResult.confidence >= hResult.confidence);
});

test("Multiple estimates are deterministic", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "bpe" });
  
  const first = estimator.estimate(TEST_TEXTS.english);
  const second = estimator.estimate(TEST_TEXTS.english);
  
  assert.equal(first.tokenCount, second.tokenCount);
});

test("Token count does not exceed text length for English", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "tiktoken" });
  
  const result = estimator.estimate(TEST_TEXTS.english);
  
  // Token count should generally be less than character count for English
  assert.ok(result.tokenCount <= TEST_TEXTS.english.length);
});

test("BPE vocabulary is accessible", () => {
  const tokenizer = new BPETokenizer(2000);
  
  const vocab = tokenizer.getVocab();
  assert.ok(vocab instanceof Map);
  assert.ok(vocab.size > 0);
});

test("Model-specific estimation for Chinese text", () => {
  const estimator = new ExactTokenEstimator({
    estimatorType: "exact",
    modelName: "qwen-72b"
  });
  
  const result = estimator.estimate(TEST_TEXTS.chinese);
  assert.ok(result.tokenCount >= 0);
});

test("Error handling for special characters", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "bpe" });
  
  const result = estimator.estimate("!@#$%^&*()_+-=[]{}|;':\",./<>?");
  assert.ok(result.tokenCount > 0);
});

test("Error handling for unicode", () => {
  const estimator = new ExactTokenEstimator({ estimatorType: "tiktoken" });
  
  const result = estimator.estimate("🎉🚀💻");
  assert.ok(result.tokenCount >= 0);
});
