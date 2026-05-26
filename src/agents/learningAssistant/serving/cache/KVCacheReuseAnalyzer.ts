/**
 * KV-Cache Reuse Analyzer
 * 
 * Analyzes cache reuse metrics at a fine-grained level for PD-separated serving.
 * Calculates prefix reuse ratio, KV transfer savings, and cost efficiency metrics.
 * Works with any AbstractPrefixCache implementation (Radix or Hash-based).
 * 
 * References:
 * - Agrawal et al. (2024). "Taming Throughput-Latency Tradeoff in LLM Inference 
 *   with Sarathi-Serve". OSDI.
 * - Kwon et al. (2023). "Efficient Memory Management for Large Language Model 
 *   Serving with PagedAttention". SOSP.
 */
import type { AbstractPrefixCache, CacheLookupResult } from "./AbstractPrefixCache.ts";
import type { PDWorkloadRequest, ServingSLO } from "../ServingTrace.ts";
import { round } from "../utils/MathUtils.ts";

// ==================== Types ====================

export interface KVCacheReuseMetrics {
  prefixReuseRatio: number;
  kvTransferSavingsBytes: number;
  kvTransferSavingsPercent: number;
  tokenReuseHistogram: number[];
  costAnalysis: CostAnalysis;
  detailedStats: DetailedReuseStats;
}

export interface CostAnalysis {
  savedPrefillComputeMs: number;
  savedNetworkTransferMs: number;
  memoryOverheadMB: number;
  costEfficiencyRatio: number;
}

export interface DetailedReuseStats {
  totalRequests: number;
  totalTokens: number;
  reusedTokens: number;
  uniqueTokens: number;
  cacheHits: number;
  cacheMisses: number;
  avgReuseChainLength: number;
  maxReuseChainLength: number;
}

export interface ReuseSegment {
  requestId: string;
  sharedPrefixLength: number;
  uniqueTokens: number;
  reuseStartIndex: number;
  reuseEndIndex: number;
}

export interface CacheComparisonResult {
  cacheName: string;
  metrics: KVCacheReuseMetrics;
  score: number;
}

// ==================== Constants ====================

const DEFAULT_KV_SIZE_BYTES_PER_TOKEN = 640; // ~640 bytes per token per layer (Llama-70B)
const DEFAULT_PREFILL_MS_PER_TOKEN = 0.18;   // ms per token for prefill compute
const DEFAULT_NETWORK_GBPS = 400;            // Network bandwidth in GB/s
const DEFAULT_LAYERS = 80;                   // Llama-70B has 80 layers

const HISTOGRAM_BUCKETS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

// ==================== Helper Functions ====================

function computeReuseHistogram(chainLengths: number[]): number[] {
  const histogram = new Array(HISTOGRAM_BUCKETS.length).fill(0);
  
  for (const length of chainLengths) {
    for (let i = HISTOGRAM_BUCKETS.length - 1; i >= 0; i--) {
      if (length >= HISTOGRAM_BUCKETS[i]) {
        histogram[i]++;
        break;
      }
    }
  }
  
  return histogram;
}

function computeHistogramLabels(): string[] {
  return HISTOGRAM_BUCKETS.map((b, i) => {
    if (i === HISTOGRAM_BUCKETS.length - 1) {
      return `>${HISTOGRAM_BUCKETS[i - 1]}`;
    }
    return `${b}-${HISTOGRAM_BUCKETS[i + 1] - 1}`;
  });
}

// ==================== KVCacheReuseAnalyzer Class ====================

export class KVCacheReuseAnalyzer {
  private cache: AbstractPrefixCache;
  private requestTokenMap: Map<string, number[]> = new Map();
  private reuseChainMap: Map<string, number[]> = new Map();
  private segmentMap: ReuseSegment[] = [];

  constructor(cache: AbstractPrefixCache) {
    this.cache = cache;
  }

  /**
   * Analyze cache reuse metrics for a workload.
   */
  analyzeWorkload(requests: PDWorkloadRequest[]): KVCacheReuseMetrics {
    // Reset state
    this.requestTokenMap.clear();
    this.reuseChainMap.clear();
    this.segmentMap = [];

    // Generate synthetic tokens for analysis
    const tokenSequences = this.generateTokenSequences(requests);
    
    // Store token sequences for later use
    for (let i = 0; i < requests.length; i++) {
      this.requestTokenMap.set(requests[i].id, tokenSequences[i]);
    }

    // Analyze reuse patterns
    const reuseChains: number[] = [];
    let totalReusedTokens = 0;
    let totalUniqueTokens = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    const chainLengths: number[] = [];

    // Build cache with first request and measure hits for subsequent ones
    for (let i = 0; i < requests.length; i++) {
      const tokens = tokenSequences[i];
      const result = this.cache.lookup(tokens);

      if (i === 0) {
        // First request: insert into cache
        this.cache.insert(tokens);
        totalUniqueTokens += tokens.length;
        chainLengths.push(tokens.length);
      } else {
        // Subsequent requests: measure reuse
        const matchedLength = result.matchedLength;
        
        if (matchedLength > 0) {
          cacheHits++;
          totalReusedTokens += matchedLength;
          chainLengths.push(matchedLength);
          reuseChains.push(matchedLength);

          // Calculate savings from reuse
          const savingsBytes = matchedLength * DEFAULT_KV_SIZE_BYTES_PER_TOKEN;
          
          // For requests with partial hits, insert remaining tokens
          if (matchedLength < tokens.length) {
            this.cache.insert(tokens.slice(matchedLength));
            totalUniqueTokens += (tokens.length - matchedLength);
          }
        } else {
          cacheMisses++;
          totalUniqueTokens += tokens.length;
          this.cache.insert(tokens);
        }
      }
    }

    // Calculate metrics
    const totalTokens = requests.reduce((sum, r) => {
      const tokens = this.requestTokenMap.get(r.id);
      return sum + (tokens?.length ?? r.prefillTokens);
    }, 0);

    const prefixReuseRatio = totalTokens > 0 
      ? round(totalReusedTokens / totalTokens) 
      : 0;

    // Calculate KV transfer savings
    const kvTransferSavingsBytes = totalReusedTokens * DEFAULT_KV_SIZE_BYTES_PER_TOKEN;
    const potentialTransferBytes = totalTokens * DEFAULT_KV_SIZE_BYTES_PER_TOKEN;
    const kvTransferSavingsPercent = potentialTransferBytes > 0 
      ? round((kvTransferSavingsBytes / potentialTransferBytes) * 100) 
      : 0;

    // Calculate cost analysis
    const savedPrefillComputeMs = totalReusedTokens * DEFAULT_PREFILL_MS_PER_TOKEN;
    const savedNetworkTransferMs = (kvTransferSavingsBytes / (DEFAULT_NETWORK_GBPS * 1e9)) * 1000;
    const memoryOverheadMB = this.cache.getStats().memoryUsageMB;
    
    const costEfficiencyRatio = memoryOverheadMB > 0
      ? round((savedPrefillComputeMs + savedNetworkTransferMs) / memoryOverheadMB)
      : 0;

    // Generate histogram
    const tokenReuseHistogram = computeReuseHistogram(chainLengths);

    // Calculate detailed stats
    const avgReuseChainLength = chainLengths.length > 0
      ? round(chainLengths.reduce((a, b) => a + b, 0) / chainLengths.length)
      : 0;
    const maxReuseChainLength = chainLengths.length > 0
      ? Math.max(...chainLengths)
      : 0;

    return {
      prefixReuseRatio,
      kvTransferSavingsBytes,
      kvTransferSavingsPercent,
      tokenReuseHistogram,
      costAnalysis: {
        savedPrefillComputeMs,
        savedNetworkTransferMs,
        memoryOverheadMB,
        costEfficiencyRatio
      },
      detailedStats: {
        totalRequests: requests.length,
        totalTokens,
        reusedTokens: totalReusedTokens,
        uniqueTokens: totalUniqueTokens,
        cacheHits,
        cacheMisses,
        avgReuseChainLength,
        maxReuseChainLength
      }
    };
  }

  /**
   * Compare multiple cache implementations on the same workload.
   */
  compareCaches(
    caches: Map<string, AbstractPrefixCache>,
    requests: PDWorkloadRequest[]
  ): Map<string, KVCacheReuseMetrics> {
    const results = new Map<string, KVCacheReuseMetrics>();

    for (const [name, cache] of caches) {
      // Create fresh analyzer for each cache
      const analyzer = new KVCacheReuseAnalyzer(cache);
      const metrics = analyzer.analyzeWorkload(requests);
      results.set(name, metrics);
    }

    return results;
  }

  /**
   * Generate comparison report for multiple caches.
   */
  generateComparisonReport(
    comparison: Map<string, KVCacheReuseMetrics>
  ): string {
    const lines: string[] = [];
    
    lines.push('# KV-Cache Reuse Comparison Report\n');
    lines.push(`Generated: ${new Date().toISOString()}\n`);
    
    lines.push('## Summary\n');
    lines.push('| Cache | Prefix Reuse % | KV Savings (MB) | Cost Efficiency |');
    lines.push('|-------|---------------|-----------------|-----------------|');
    
    for (const [name, metrics] of comparison) {
      lines.push(`| ${name} | ${metrics.prefixReuseRatio.toFixed(2)} | ${(metrics.kvTransferSavingsBytes / 1e6).toFixed(2)} | ${metrics.costAnalysis.costEfficiencyRatio.toFixed(2)} |`);
    }
    
    // Find best cache
    let bestCache = '';
    let bestScore = -1;
    for (const [name, metrics] of comparison) {
      if (metrics.costAnalysis.costEfficiencyRatio > bestScore) {
        bestScore = metrics.costAnalysis.costEfficiencyRatio;
        bestCache = name;
      }
    }
    
    lines.push(`\n**Best Cache**: ${bestCache} (Cost Efficiency: ${bestScore.toFixed(2)})\n`);
    
    return lines.join('\n');
  }

  /**
   * Generate a detailed markdown report from metrics.
   */
  generateReport(metrics: KVCacheReuseMetrics): string {
    const lines: string[] = [];
    
    lines.push('# KV-Cache Reuse Analysis Report\n');
    lines.push(`Generated: ${new Date().toISOString()}\n`);
    
    // Summary section
    lines.push('## Summary\n');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Requests | ${metrics.detailedStats.totalRequests} |`);
    lines.push(`| Total Tokens | ${metrics.detailedStats.totalTokens} |`);
    lines.push(`| Reused Tokens | ${metrics.detailedStats.reusedTokens} |`);
    lines.push(`| Unique Tokens | ${metrics.detailedStats.uniqueTokens} |`);
    lines.push(`| Cache Hits | ${metrics.detailedStats.cacheHits} |`);
    lines.push(`| Cache Misses | ${metrics.detailedStats.cacheMisses} |`);
    
    // Reuse ratio section
    lines.push('\n## Reuse Metrics\n');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| **Prefix Reuse Ratio** | ${(metrics.prefixReuseRatio * 100).toFixed(2)}% |`);
    lines.push(`| Avg Reuse Chain Length | ${metrics.detailedStats.avgReuseChainLength} tokens |`);
    lines.push(`| Max Reuse Chain Length | ${metrics.detailedStats.maxReuseChainLength} tokens |`);
    
    // Transfer savings section
    lines.push('\n## KV Transfer Savings\n');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Bytes Saved | ${(metrics.kvTransferSavingsBytes / 1e6).toFixed(2)} MB |`);
    lines.push(`| Savings Percentage | ${metrics.kvTransferSavingsPercent.toFixed(2)}% |`);
    
    // Cost analysis section
    lines.push('\n## Cost Analysis\n');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Saved Prefill Compute | ${metrics.costAnalysis.savedPrefillComputeMs.toFixed(2)} ms |`);
    lines.push(`| Saved Network Transfer | ${metrics.costAnalysis.savedNetworkTransferMs.toFixed(2)} ms |`);
    lines.push(`| Memory Overhead | ${metrics.costAnalysis.memoryOverheadMB.toFixed(2)} MB |`);
    lines.push(`| **Cost Efficiency Ratio** | ${metrics.costAnalysis.costEfficiencyRatio.toFixed(4)} |`);
    
    // Histogram section
    lines.push('\n## Token Reuse Histogram\n');
    lines.push('Distribution of reuse chain lengths:\n');
    
    const labels = computeHistogramLabels();
    lines.push('| Bucket | Count |');
    lines.push('|--------|-------|');
    
    for (let i = 0; i < labels.length; i++) {
      lines.push(`| ${labels[i]} tokens | ${metrics.tokenReuseHistogram[i]} |`);
    }
    
    return lines.join('\n');
  }

  /**
   * Get metrics as structured data for programmatic use.
   */
  getMetricsData(metrics: KVCacheReuseMetrics): {
    summary: Record<string, number>;
    histogramBuckets: { label: string; count: number }[];
  } {
    const labels = computeHistogramLabels();
    
    return {
      summary: {
        prefixReuseRatio: metrics.prefixReuseRatio,
        kvTransferSavingsBytes: metrics.kvTransferSavingsBytes,
        kvTransferSavingsPercent: metrics.kvTransferSavingsPercent,
        savedPrefillComputeMs: metrics.costAnalysis.savedPrefillComputeMs,
        savedNetworkTransferMs: metrics.costAnalysis.savedNetworkTransferMs,
        memoryOverheadMB: metrics.costAnalysis.memoryOverheadMB,
        costEfficiencyRatio: metrics.costAnalysis.costEfficiencyRatio,
        totalRequests: metrics.detailedStats.totalRequests,
        totalTokens: metrics.detailedStats.totalTokens,
        reusedTokens: metrics.detailedStats.reusedTokens,
        cacheHits: metrics.detailedStats.cacheHits,
        cacheMisses: metrics.detailedStats.cacheMisses
      },
      histogramBuckets: labels.map((label, i) => ({
        label,
        count: metrics.tokenReuseHistogram[i]
      }))
    };
  }

  /**
   * Generate synthetic token sequences for workload requests.
   * Uses cacheable prefix tokens if specified in requests.
   */
  private generateTokenSequences(requests: PDWorkloadRequest[]): number[][] {
    const sequences: number[][] = [];
    
    for (const request of requests) {
      // Generate tokens with cacheable prefix if specified
      const cacheablePrefix = request.cacheablePrefixTokens ?? Math.floor(request.prefillTokens * 0.3);
      const uniqueTokens = request.prefillTokens - cacheablePrefix;
      
      // Create a realistic token sequence
      // Prefix tokens (cacheable) + unique tokens
      const tokens: number[] = [];
      
      // Add cacheable prefix (deterministic based on request ID)
      const seed = this.hashString(request.id);
      for (let i = 0; i < cacheablePrefix; i++) {
        tokens.push((seed + i) % 50000);
      }
      
      // Add unique tokens
      for (let i = 0; i < uniqueTokens; i++) {
        tokens.push((seed + cacheablePrefix + i * 7) % 50000);
      }
      
      sequences.push(tokens);
    }
    
    return sequences;
  }

  /**
   * Simple string hash function for deterministic token generation.
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}

/**
 * Create a standard analyzer with default configuration.
 */
export function createReuseAnalyzer(cache: AbstractPrefixCache): KVCacheReuseAnalyzer {
  return new KVCacheReuseAnalyzer(cache);
}

/**
 * Default reuse analyzer instance.
 */
export const defaultReuseAnalyzer = new KVCacheReuseAnalyzer({
  lookup: () => ({ matchedLength: 0, totalRequested: 0, hitRate: 0, cacheEntry: null }),
  insert: () => {},
  getStats: () => ({ totalHits: 0, totalMisses: 0, hitRate: 0, memoryUsageMB: 0, evictions: 0 }),
  clear: () => {},
  release: () => {},
  getImplementationName: () => 'default'
} as AbstractPrefixCache);
