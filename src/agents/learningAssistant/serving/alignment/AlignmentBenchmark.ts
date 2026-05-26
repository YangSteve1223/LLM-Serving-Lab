/**
 * Alignment Benchmark - Compare RadixTree vs Hash-based vs SGLang-LSP caching strategies.
 * 
 * This benchmark runs all three cache strategies against the same workload
 * and produces a comprehensive comparison report.
 */
import { RadixTree } from "../cache/RadixPrefixCacheManager.ts";
import { HashBasedPrefixCache } from "./HashBasedPrefixCache.ts";
import { SGLangRadixAttentionSimulator, SGLangSchedulerAdapter } from "./SGLangRadixAttentionSimulator.ts";
import type { PDWorkloadRequest } from "../ServingTrace.ts";

export interface BenchmarkConfig {
  numRequests: number;
  avgPrefillTokens: number;
  avgDecodeTokens: number;
  numRuns: number;
  enableDetailedMetrics: boolean;
}

export interface CacheStrategyMetrics {
  strategyName: string;
  hitRate: number;
  tokenHitRate: number;
  avgLatencyMs: number;
  memoryUsageMB: number;
  prefillTokensSaved: number;
  ttftReductionMs: number;
}

export interface BenchmarkResult {
  runId: string;
  timestamp: string;
  config: BenchmarkConfig;
  strategies: {
    radix: CacheStrategyMetrics;
    hashBased: CacheStrategyMetrics;
    sglangLSP: CacheStrategyMetrics;
  };
  winner: {
    hitRate: string;
    latency: string;
    memory: string;
    overall: string;
  };
  comparisonTable: {
    metric: string;
    radix: string | number;
    hashBased: string | number;
    sglangLSP: string | number;
    best: string;
  }[];
  recommendations: string[];
}

/**
 * Run alignment benchmark comparing all cache strategies.
 */
export class AlignmentBenchmark {
  private config: BenchmarkConfig;
  private workload: PDWorkloadRequest[];

  constructor(config: Partial<BenchmarkConfig> = {}) {
    this.config = {
      numRequests: config.numRequests ?? 100,
      avgPrefillTokens: config.avgPrefillTokens ?? 512,
      avgDecodeTokens: config.avgDecodeTokens ?? 128,
      numRuns: config.numRuns ?? 3,
      enableDetailedMetrics: config.enableDetailedMetrics ?? false
    };
    
    this.workload = this.generateWorkload();
  }

  /**
   * Generate synthetic workload for benchmarking.
   */
  private generateWorkload(): PDWorkloadRequest[] {
    const workload: PDWorkloadRequest[] = [];
    const baseTokens = Array.from({ length: this.config.avgPrefillTokens }, (_, i) => (i % 100) + 1);
    
    for (let i = 0; i < this.config.numRequests; i++) {
      // Create requests with varying degrees of prefix overlap
      const overlapRatio = Math.random();
      let prefillTokens = this.config.avgPrefillTokens;
      
      if (overlapRatio > 0.7 && i > 0) {
        // High overlap - reuse prefix from previous request
        prefillTokens = Math.floor(this.config.avgPrefillTokens * (0.5 + Math.random() * 0.5));
      }
      
      const tokens = baseTokens.slice(0, prefillTokens);
      
      workload.push({
        id: `req_${i}`,
        arrivalMs: i * 100, // 100ms between arrivals
        prefillTokens: tokens.length,
        decodeTokens: this.config.avgDecodeTokens,
        cacheablePrefixTokens: Math.floor(tokens.length * 0.8),
        priority: Math.random() > 0.9 ? "background" : "interactive"
      });
    }
    
    return workload;
  }

  /**
   * Run complete benchmark.
   */
  async run(): Promise<BenchmarkResult> {
    console.log("Starting Alignment Benchmark...");
    console.log(`Workload: ${this.config.numRequests} requests`);
    
    const runId = `bench_${Date.now()}`;
    const results: CacheStrategyMetrics[] = [];
    
    for (let run = 0; run < this.config.numRuns; run++) {
      console.log(`\nRun ${run + 1}/${this.config.numRuns}`);
      
      // Test Radix Tree
      console.log("  Testing Radix Tree...");
      const radixResult = await this.benchmarkRadixTree();
      results.push(radixResult);
      
      // Test Hash-based
      console.log("  Testing Hash-based...");
      const hashResult = await this.benchmarkHashBased();
      results.push(hashResult);
      
      // Test SGLang LSP
      console.log("  Testing SGLang LSP...");
      const sglangResult = await this.benchmarkSGLangLSP();
      results.push(sglangResult);
    }
    
    // Aggregate results (average across runs)
    const avgResults = this.aggregateResults(results);
    
    // Determine winners
    const winner = this.determineWinners(avgResults);
    
    // Generate comparison table
    const comparisonTable = this.generateComparisonTable(avgResults);
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(avgResults);
    
    return {
      runId,
      timestamp: new Date().toISOString(),
      config: this.config,
      strategies: avgResults,
      winner,
      comparisonTable,
      recommendations
    };
  }

  /**
   * Benchmark Radix Tree strategy.
   */
  private async benchmarkRadixTree(): Promise<CacheStrategyMetrics> {
    const tree = new RadixTree({
      maxMemoryMB: 512,
      kvCacheSizePerTokenMB: 0.64,
      flopsPerToken: 1e6,
      evictionStrategy: "LRU"
    });
    
    const startTime = Date.now();
    let totalHits = 0;
    let totalTokens = 0;
    let prefillTokensSaved = 0;
    
    for (const request of this.workload) {
      const tokens = Array.from({ length: request.prefillTokens }, (_, i) => (i % 100) + 1);
      
      // Lookup first (simulate cache check)
      const lookup = tree.findLongestPrefix(tokens);
      if (lookup.match) {
        totalHits++;
        prefillTokensSaved += lookup.matchedLength;
      }
      
      // Insert for future requests
      tree.insert(tokens);
      totalTokens += tokens.length;
    }
    
    const stats = tree.getStats();
    
    return {
      strategyName: "Radix Tree",
      hitRate: totalHits / this.workload.length,
      tokenHitRate: prefillTokensSaved / totalTokens,
      avgLatencyMs: (Date.now() - startTime) / this.workload.length,
      memoryUsageMB: stats.memoryUsageMB,
      prefillTokensSaved,
      ttftReductionMs: prefillTokensSaved * 0.18
    };
  }

  /**
   * Benchmark Hash-based strategy.
   */
  private async benchmarkHashBased(): Promise<CacheStrategyMetrics> {
    const cache = new HashBasedPrefixCache({
      maxMemoryMB: 512,
      blockSizeTokens: 64,
      enableRefCount: true,
      enableLRU: true
    });
    
    const startTime = Date.now();
    let totalHits = 0;
    let totalTokens = 0;
    let prefillTokensSaved = 0;
    const insertedIds: string[][] = [];
    
    for (const request of this.workload) {
      const tokens = Array.from({ length: request.prefillTokens }, (_, i) => (i % 100) + 1);
      
      // Lookup
      const lookup = cache.lookup(tokens);
      if (lookup.chainMatchLength > 0) {
        totalHits++;
        prefillTokensSaved += lookup.chainMatchLength * 64; // block size
      }
      
      // Insert
      const blockIds = cache.insert(tokens);
      insertedIds.push(blockIds);
      totalTokens += tokens.length;
    }
    
    // Release old blocks (simulate reference counting)
    for (let i = 0; i < insertedIds.length - 1; i++) {
      cache.release(insertedIds[i]);
    }
    
    const stats = cache.getStats();
    
    return {
      strategyName: "Hash-Based (vLLM)",
      hitRate: totalHits / this.workload.length,
      tokenHitRate: prefillTokensSaved / totalTokens,
      avgLatencyMs: (Date.now() - startTime) / this.workload.length,
      memoryUsageMB: stats.memoryUsageMB,
      prefillTokensSaved,
      ttftReductionMs: prefillTokensSaved * 0.18
    };
  }

  /**
   * Benchmark SGLang LSP strategy.
   */
  private async benchmarkSGLangLSP(): Promise<CacheStrategyMetrics> {
    const simulator = new SGLangRadixAttentionSimulator({
      enableLSPFirst: true,
      enableCompressedFSM: true,
      maxBatchSize: 16,
      stepBudgetMs: 100,
      prefillChunkSize: 512,
      slo: { ttftMs: 1000, tpotMs: 100, e2eMs: 10000 },
      maxSteps: 500
    });
    
    const result = simulator.runScheduling(this.workload, "sglang_lsp");
    
    return {
      strategyName: "SGLang LSP",
      hitRate: result.cacheMetrics.avgCacheHitRatio,
      tokenHitRate: result.cacheMetrics.prefillTokensSaved / this.workload.reduce((sum, r) => sum + r.prefillTokens, 0),
      avgLatencyMs: result.latency.ttftP50,
      memoryUsageMB: result.cacheMetrics.avgSharedPrefixDepth * 0.64, // Simplified
      prefillTokensSaved: result.cacheMetrics.prefillTokensSaved,
      ttftReductionMs: result.cacheMetrics.ttftReductionMs
    };
  }

  /**
   * Aggregate results across multiple runs.
   */
  private aggregateResults(results: CacheStrategyMetrics[]): {
    radix: CacheStrategyMetrics;
    hashBased: CacheStrategyMetrics;
    sglangLSP: CacheStrategyMetrics;
  } {
    const groups = {
      radix: results.filter((_, i) => i % 3 === 0),
      hashBased: results.filter((_, i) => i % 3 === 1),
      sglangLSP: results.filter((_, i) => i % 3 === 2)
    };
    
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    
    return {
      radix: this.averageMetrics(groups.radix),
      hashBased: this.averageMetrics(groups.hashBased),
      sglangLSP: this.averageMetrics(groups.sglangLSP)
    };
  }

  private averageMetrics(metrics: CacheStrategyMetrics[]): CacheStrategyMetrics {
    if (metrics.length === 0) {
      return {
        strategyName: "Unknown",
        hitRate: 0,
        tokenHitRate: 0,
        avgLatencyMs: 0,
        memoryUsageMB: 0,
        prefillTokensSaved: 0,
        ttftReductionMs: 0
      };
    }
    
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    
    return {
      strategyName: metrics[0].strategyName,
      hitRate: avg(metrics.map(m => m.hitRate)),
      tokenHitRate: avg(metrics.map(m => m.tokenHitRate)),
      avgLatencyMs: avg(metrics.map(m => m.avgLatencyMs)),
      memoryUsageMB: avg(metrics.map(m => m.memoryUsageMB)),
      prefillTokensSaved: avg(metrics.map(m => m.prefillTokensSaved)),
      ttftReductionMs: avg(metrics.map(m => m.ttftReductionMs))
    };
  }

  /**
   * Determine winners for each metric.
   */
  private determineWinners(avg: ReturnType<typeof this.aggregateResults>): {
    hitRate: string;
    latency: string;
    memory: string;
    overall: string;
  } {
    const strategies = [
      { name: "radix", ...avg.radix },
      { name: "hashBased", ...avg.hashBased },
      { name: "sglangLSP", ...avg.sglangLSP }
    ];
    
    // Higher hit rate is better
    const hitRateWinner = strategies.reduce((best, s) => 
      s.hitRate > best.hitRate ? s : best, strategies[0]);
    
    // Lower latency is better
    const latencyWinner = strategies.reduce((best, s) => 
      s.avgLatencyMs < best.avgLatencyMs ? s : best, strategies[0]);
    
    // Lower memory is better
    const memoryWinner = strategies.reduce((best, s) => 
      s.memoryUsageMB < best.memoryUsageMB ? s : best, strategies[0]);
    
    // Overall: weighted score
    const scores = strategies.map(s => ({
      name: s.name,
      score: s.hitRate * 0.4 + (1 - s.avgLatencyMs / 100) * 0.3 + (1 - s.memoryUsageMB / 100) * 0.3
    }));
    const overallWinner = scores.reduce((best, s) => s.score > best.score ? s : best, scores[0]);
    
    return {
      hitRate: this.formatStrategyName(hitRateWinner.name),
      latency: this.formatStrategyName(latencyWinner.name),
      memory: this.formatStrategyName(memoryWinner.name),
      overall: this.formatStrategyName(overallWinner.name)
    };
  }

  private formatStrategyName(name: string): string {
    const names: Record<string, string> = {
      radix: "Radix Tree",
      hashBased: "Hash-Based",
      sglangLSP: "SGLang LSP"
    };
    return names[name] || name;
  }

  /**
   * Generate comparison table.
   */
  private generateComparisonTable(avg: ReturnType<typeof this.aggregateResults>): BenchmarkResult["comparisonTable"] {
    const strategies = [
      { name: "radix", ...avg.radix },
      { name: "hashBased", ...avg.hashBased },
      { name: "sglangLSP", ...avg.sglangLSP }
    ];
    
    const best = (metric: string, higher: boolean) => {
      const vals = strategies.map(s => ({ name: s.name, val: (s as any)[metric] }));
      const winner = higher 
        ? vals.reduce((best, v) => v.val > best.val ? v : best, vals[0])
        : vals.reduce((best, v) => v.val < best.val ? v : best, vals[0]);
      return this.formatStrategyName(winner.name);
    };
    
    return [
      { metric: "Cache Hit Rate", radix: `${(avg.radix.hitRate * 100).toFixed(1)}%`, hashBased: `${(avg.hashBased.hitRate * 100).toFixed(1)}%`, sglangLSP: `${(avg.sglangLSP.hitRate * 100).toFixed(1)}%`, best: best("hitRate", true) },
      { metric: "Token Hit Rate", radix: `${(avg.radix.tokenHitRate * 100).toFixed(1)}%`, hashBased: `${(avg.hashBased.tokenHitRate * 100).toFixed(1)}%`, sglangLSP: `${(avg.sglangLSP.tokenHitRate * 100).toFixed(1)}%`, best: best("tokenHitRate", true) },
      { metric: "Avg Latency (ms)", radix: avg.radix.avgLatencyMs.toFixed(2), hashBased: avg.hashBased.avgLatencyMs.toFixed(2), sglangLSP: avg.sglangLSP.avgLatencyMs.toFixed(2), best: best("avgLatencyMs", false) },
      { metric: "Memory Usage (MB)", radix: avg.radix.memoryUsageMB.toFixed(1), hashBased: avg.hashBased.memoryUsageMB.toFixed(1), sglangLSP: avg.sglangLSP.memoryUsageMB.toFixed(1), best: best("memoryUsageMB", false) },
      { metric: "Prefill Tokens Saved", radix: avg.radix.prefillTokensSaved.toFixed(0), hashBased: avg.hashBased.prefillTokensSaved.toFixed(0), sglangLSP: avg.sglangLSP.prefillTokensSaved.toFixed(0), best: best("prefillTokensSaved", true) },
      { metric: "TTFT Reduction (ms)", radix: avg.radix.ttftReductionMs.toFixed(1), hashBased: avg.hashBased.ttftReductionMs.toFixed(1), sglangLSP: avg.sglangLSP.ttftReductionMs.toFixed(1), best: best("ttftReductionMs", true) }
    ];
  }

  /**
   * Generate recommendations based on results.
   */
  private generateRecommendations(avg: ReturnType<typeof this.aggregateResults>): string[] {
    const recs: string[] = [];
    
    if (avg.hashBased.hitRate > avg.radix.hitRate) {
      recs.push("Hash-Based (vLLM-style) cache shows higher hit rate - consider for workloads with high prefix sharing");
    }
    
    if (avg.sglangLSP.ttftReductionMs > avg.radix.ttftReductionMs) {
      recs.push("SGLang LSP scheduling provides better TTFT reduction - recommended for latency-critical workloads");
    }
    
    if (avg.hashBased.memoryUsageMB < avg.radix.memoryUsageMB) {
      recs.push("Hash-Based cache is more memory efficient - better for memory-constrained environments");
    }
    
    if (avg.sglangLSP.avgLatencyMs < avg.hashBased.avgLatencyMs && avg.sglangLSP.avgLatencyMs < avg.radix.avgLatencyMs) {
      recs.push("SGLang LSP achieves lowest latency - optimal for real-time serving scenarios");
    }
    
    recs.push("For mixed workloads, consider hybrid approach: SGLang LSP scheduling with Hash-Based cache backend");
    recs.push("Enable reference counting for Hash-Based cache when request patterns have significant overlap");
    
    return recs;
  }

  /**
   * Generate markdown report.
   */
  generateReport(result: BenchmarkResult): string {
    const tableRows = result.comparisonTable.map(row => 
      `| ${row.metric} | ${row.radix} | ${row.hashBased} | ${row.sglangLSP} | ${row.best} |`
    ).join("\n");
    
    return `# Cache Strategy Alignment Benchmark Report

## Run Information
- **Run ID**: ${result.runId}
- **Timestamp**: ${result.timestamp}
- **Config**: ${result.config.numRequests} requests, ${result.config.numRuns} runs

## Strategy Comparison

| Metric | Radix Tree | Hash-Based (vLLM) | SGLang LSP | Best |
|--------|------------|-------------------|------------|------|
${tableRows}

## Winners
- **Hit Rate**: ${result.winner.hitRate}
- **Latency**: ${result.winner.latency}
- **Memory**: ${result.winner.memory}
- **Overall**: ${result.winner.overall}

## Recommendations
${result.recommendations.map(r => `- ${r}`).join("\n")}

## Detailed Metrics

### Radix Tree
- Hit Rate: ${(result.strategies.radix.hitRate * 100).toFixed(1)}%
- Token Hit Rate: ${(result.strategies.radix.tokenHitRate * 100).toFixed(1)}%
- Avg Latency: ${result.strategies.radix.avgLatencyMs.toFixed(2)}ms
- Memory Usage: ${result.strategies.radix.memoryUsageMB.toFixed(1)}MB

### Hash-Based (vLLM Style)
- Hit Rate: ${(result.strategies.hashBased.hitRate * 100).toFixed(1)}%
- Token Hit Rate: ${(result.strategies.hashBased.tokenHitRate * 100).toFixed(1)}%
- Avg Latency: ${result.strategies.hashBased.avgLatencyMs.toFixed(2)}ms
- Memory Usage: ${result.strategies.hashBased.memoryUsageMB.toFixed(1)}MB

### SGLang LSP
- Hit Rate: ${(result.strategies.sglangLSP.hitRate * 100).toFixed(1)}%
- Token Hit Rate: ${(result.strategies.sglangLSP.tokenHitRate * 100).toFixed(1)}%
- Avg Latency: ${result.strategies.sglangLSP.avgLatencyMs.toFixed(2)}ms
- Memory Usage: ${result.strategies.sglangLSP.memoryUsageMB.toFixed(1)}MB
`;
  }
}
