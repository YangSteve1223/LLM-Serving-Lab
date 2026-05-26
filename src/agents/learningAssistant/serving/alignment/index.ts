/**
 * Alignment Module - vLLM/SGLang alignment adapters and benchmarks.
 * 
 * This module provides:
 * - HashBasedPrefixCache: vLLM-style automatic prefix caching simulation
 * - SGLangRadixAttentionSimulator: SGLang's LSP-First scheduling simulation
 * - AlignmentBenchmark: Compare all cache strategies
 */
export { HashBasedPrefixCache } from "./HashBasedPrefixCache.ts";
export type { HashBlock, HashCacheConfig, HashCacheStats, HashLookupResult } from "./HashBasedPrefixCache.ts";

export { SGLangRadixAttentionSimulator, SGLangSchedulerAdapter } from "./SGLangRadixAttentionSimulator.ts";
export type { 
  RadixAttentionConfig, 
  RadixRequestNode, 
  LSPBatchDecision, 
  RadixAttentionResult 
} from "./SGLangRadixAttentionSimulator.ts";

export { AlignmentBenchmark } from "./AlignmentBenchmark.ts";
export type { BenchmarkConfig, BenchmarkResult, CacheStrategyMetrics } from "./AlignmentBenchmark.ts";
