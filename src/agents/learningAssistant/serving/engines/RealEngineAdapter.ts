/**
 * RealEngineAdapter - Interface for real inference engine adapters.
 * 
 * This module provides a unified interface for interacting with real inference engines
 * (vLLM, SGLang, DeepSeek API) and comparing their performance with simulators.
 * 
 * Key features:
 * - Streaming token-by-token latency collection
 * - TTFT (Time To First Token) measurement
 * - TPOT (Time Per Output Token) calculation
 * - E2E latency tracking
 * - Cache hit rate monitoring (for vLLM/SGLang)
 */
import { performance } from "node:perf_hooks";

/**
 * Supported inference engine types.
 */
export type EngineType = 'vllm' | 'sglang' | 'deepseek';

/**
 * Configuration for real engine adapters.
 */
export interface RealEngineConfig {
  /** Engine type */
  engineType: EngineType;
  /** Base URL for the API endpoint */
  baseUrl: string;
  /** API key for authentication (optional for some engines) */
  apiKey?: string;
  /** Model name */
  model: string;
  /** Maximum tokens to generate */
  maxTokens: number;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Temperature for generation */
  temperature?: number;
}

/**
 * Comprehensive metrics from a real engine request.
 */
export interface RealEngineMetrics {
  /** Time To First Token in milliseconds */
  ttftMs: number;
  /** Time Per Output Token in milliseconds (average) */
  tpotMs: number;
  /** End-to-end latency in milliseconds */
  e2eMs: number;
  /** Throughput in tokens per second */
  tokensPerSecond: number;
  /** Number of prompt tokens */
  promptTokens: number;
  /** Number of completion tokens */
  completionTokens: number;
  /** Cache hit rate (vLLM/SGLang only) */
  cacheHitRate?: number;
  /** KV cache usage percentage (vLLM/SGLang only) */
  kvCacheUsage?: number;
  /** Token-by-token inter-token latencies in milliseconds */
  itlMs: number[];
  /** Request timestamp */
  timestamp: number;
}

/**
 * Result from a single engine request.
 */
export interface EngineRequestResult {
  /** Generated text */
  text: string;
  /** Detailed metrics */
  metrics: RealEngineMetrics;
  /** Raw API response (if available) */
  rawResponse?: Record<string, unknown>;
  /** Whether streaming was used */
  streamed: boolean;
}

/**
 * Statistics for a batch of measurements.
 */
export interface MetricsStatistics {
  /** Mean value */
  mean: number;
  /** Standard deviation */
  std: number;
  /** 50th percentile */
  p50: number;
  /** 95th percentile */
  p95: number;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Number of samples */
  count: number;
}

/**
 * Configuration for validation experiments.
 */
export interface ValidationConfig {
  /** Prompt token lengths to test */
  promptLengths: number[];
  /** Output token length */
  outputTokens: number;
  /** Number of repetitions per configuration */
  repetitions: number;
  /** Delay between requests in milliseconds */
  delayBetweenRequests: number;
  /** Maximum retry attempts for failed requests */
  maxRetries: number;
  /** Base delay for exponential backoff */
  baseRetryDelayMs: number;
}

/**
 * Default validation configuration.
 */
export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  promptLengths: [128, 512, 1024, 2048, 4096],
  outputTokens: 128,
  repetitions: 3,
  delayBetweenRequests: 1000,
  maxRetries: 3,
  baseRetryDelayMs: 1000
};

/**
 * Base interface for all real engine adapters.
 * 
 * Adapters implement the actual API calls and metric collection
 * for specific inference engines.
 */
export interface IRealEngineAdapter {
  /**
   * Get the engine configuration.
   */
  getConfig(): RealEngineConfig;
  
  /**
   * Send a streaming request and collect metrics.
   * @param prompt Input prompt
   * @param options Optional request parameters
   * @returns Request result with metrics
   */
  request(
    prompt: string,
    options?: { maxTokens?: number; temperature?: number }
  ): Promise<EngineRequestResult>;
  
  /**
   * Check if the adapter is properly configured and can make requests.
   */
  isAvailable(): boolean;
  
  /**
   * Get engine-specific metrics (e.g., cache stats for vLLM/SGLang).
   */
  getEngineMetrics?(): Promise<Record<string, number>>;
}

/**
 * Generate test prompt with approximate token count.
 * Uses deterministic selection based on token count.
 */
export function generateTestPrompt(tokenCount: number, seed?: number): string {
  const rng = seed !== undefined ? simpleRandom(seed) : null;
  
  const templates = [
    "Explain the concept of machine learning in detail.",
    "What are the key differences between supervised and unsupervised learning?",
    "Describe how neural networks process information through layers.",
    "Discuss the importance of data preprocessing in AI pipelines.",
    "What factors affect the training time of large language models?",
    "How does attention mechanism work in transformer architectures?",
    "Compare and contrast batch processing with streaming processing.",
    "What are the benefits of using gradient descent optimization?",
    "Explain the bias-variance tradeoff in machine learning.",
    "How can we prevent overfitting in deep neural networks?"
  ];
  
  const templateIndex = rng ? Math.floor(rng() * templates.length) : 0;
  const basePrompt = templates[templateIndex % templates.length];
  
  // Calculate filler needed
  const wordsPerToken = 0.75;
  const targetWords = Math.floor(tokenCount * wordsPerToken);
  const baseWords = basePrompt.split(/\s+/).length;
  
  if (targetWords <= baseWords) {
    return basePrompt.substring(0, Math.min(basePrompt.length, tokenCount * 4));
  }
  
  const filler = " Please provide comprehensive details, examples, and explanations with specific use cases. ";
  const fillerWords = filler.split(/\s+/).length;
  const repeats = Math.ceil((targetWords - baseWords) / fillerWords);
  
  return basePrompt + filler.repeat(repeats);
}

/**
 * Simple seeded random number generator (Linear Congruential Generator).
 */
function simpleRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Calculate statistics from an array of numbers.
 */
export function calculateStatistics(values: number[]): MetricsStatistics {
  if (values.length === 0) {
    return { mean: 0, std: 0, p50: 0, p95: 0, min: 0, max: 0, count: 0 };
  }
  
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / count;
  
  const variance = sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / count;
  const std = Math.sqrt(variance);
  
  const p50Index = Math.floor(count * 0.5);
  const p95Index = Math.floor(count * 0.95);
  
  return {
    mean,
    std,
    p50: sorted[p50Index],
    p95: sorted[p95Index],
    min: sorted[0],
    max: sorted[count - 1],
    count
  };
}

/**
 * Calculate MAPE (Mean Absolute Percentage Error).
 * Returns percentage value (e.g., 15.5 for 15.5%).
 */
export function calculateMAPE(actual: number[], predicted: number[]): number {
  if (actual.length !== predicted.length || actual.length === 0) {
    return 0;
  }
  
  let sum = 0;
  let count = 0;
  
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] > 0) {
      sum += Math.abs((actual[i] - predicted[i]) / actual[i]);
      count++;
    }
  }
  
  return count > 0 ? (sum / count) * 100 : 0;
}

/**
 * Calculate SMAPE (Symmetric Mean Absolute Percentage Error).
 * Returns percentage value.
 */
export function calculateSMAPE(actual: number[], predicted: number[]): number {
  if (actual.length !== predicted.length || actual.length === 0) {
    return 0;
  }
  
  let sum = 0;
  let count = 0;
  
  for (let i = 0; i < actual.length; i++) {
    const denominator = (Math.abs(actual[i]) + Math.abs(predicted[i])) / 2;
    if (denominator > 0) {
      sum += Math.abs(actual[i] - predicted[i]) / denominator;
      count++;
    }
  }
  
  return count > 0 ? (sum / count) * 100 : 0;
}

/**
 * Calculate MAE (Mean Absolute Error).
 */
export function calculateMAE(actual: number[], predicted: number[]): number {
  if (actual.length !== predicted.length || actual.length === 0) {
    return 0;
  }
  
  let sum = 0;
  for (let i = 0; i < actual.length; i++) {
    sum += Math.abs(actual[i] - predicted[i]);
  }
  
  return sum / actual.length;
}

/**
 * Exponential backoff delay helper.
 */
export async function exponentialBackoff(
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 30000
): Promise<void> {
  const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  // Add jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  await new Promise(resolve => setTimeout(resolve, delay + jitter));
}
