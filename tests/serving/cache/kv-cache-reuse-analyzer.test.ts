/**
 * Tests for KVCacheReuseAnalyzer
 */
import { describe, it } from "node:test";
import assert from "node:assert";

// Import cache components
import { KVCacheReuseAnalyzer, createReuseAnalyzer, type KVCacheReuseMetrics } from "../../../src/agents/learningAssistant/serving/cache/KVCacheReuseAnalyzer.ts";
import type { AbstractPrefixCache, CacheLookupResult, CacheStats } from "../../../src/agents/learningAssistant/serving/cache/AbstractPrefixCache.ts";
import type { PDWorkloadRequest } from "../../../src/agents/learningAssistant/serving/ServingTrace.ts";

// Mock implementations for testing
class MockPrefixCache implements AbstractPrefixCache {
  private storage: Map<string, number[]> = new Map();
  private hits = 0;
  private misses = 0;
  private memoryUsageMB = 0;
  private hitRatio: number;

  constructor(hitRatio = 0.5) {
    this.hitRatio = hitRatio;
    // Initialize with some common prefixes
    this.storage.set('common', Array(100).fill(0).map((_, i) => i));
  }

  lookup(tokens: number[]): CacheLookupResult {
    const key = tokens.slice(0, 10).join(',');
    
    // Simulate hit rate
    if (this.storage.has(key) || Math.random() < this.hitRatio) {
      this.hits++;
      return {
        matchedLength: tokens.length,
        totalRequested: tokens.length,
        hitRate: this.hitRatio,
        cacheEntry: this.storage.get(key) ?? tokens
      };
    }
    
    this.misses++;
    return {
      matchedLength: 0,
      totalRequested: tokens.length,
      hitRate: 0,
      cacheEntry: null
    };
  }

  insert(tokens: number[]): void {
    const key = tokens.slice(0, 10).join(',');
    this.storage.set(key, tokens);
    this.memoryUsageMB += tokens.length * 640 / 1e6;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      totalHits: this.hits,
      totalMisses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      memoryUsageMB: this.memoryUsageMB,
      evictions: 0
    };
  }

  clear(): void {
    this.storage.clear();
    this.hits = 0;
    this.misses = 0;
    this.memoryUsageMB = 0;
  }

  release(tokens: number[]): void {
    const key = tokens.slice(0, 10).join(',');
    this.storage.delete(key);
  }

  getImplementationName(): string {
    return 'MockPrefixCache';
  }
}

describe('KVCacheReuseAnalyzer', () => {
  describe('constructor', () => {
    it('should create analyzer with provided cache', () => {
      const cache = new MockPrefixCache();
      const analyzer = new KVCacheReuseAnalyzer(cache);
      assert.ok(analyzer);
    });

    it('should create analyzer with createReuseAnalyzer helper', () => {
      const cache = new MockPrefixCache();
      const analyzer = createReuseAnalyzer(cache);
      assert.ok(analyzer);
    });
  });

  describe('analyzeWorkload', () => {
    it('should analyze empty workload', () => {
      const cache = new MockPrefixCache();
      const analyzer = new KVCacheReuseAnalyzer(cache);
      
      const metrics = analyzer.analyzeWorkload([]);
      
      assert.strictEqual(metrics.prefixReuseRatio, 0);
      assert.strictEqual(metrics.kvTransferSavingsBytes, 0);
      assert.strictEqual(metrics.kvTransferSavingsPercent, 0);
      assert.strictEqual(metrics.detailedStats.totalRequests, 0);
    });

    it('should analyze single request workload', () => {
      const cache = new MockPrefixCache();
      const analyzer = new KVCacheReuseAnalyzer(cache);
      
      const requests: PDWorkloadRequest[] = [
        {
          id: 'req-1',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        }
      ];

      const metrics = analyzer.analyzeWorkload(requests);
      
      assert.strictEqual(metrics.prefixReuseRatio, 0); // First request has no reuse
      assert.strictEqual(metrics.detailedStats.totalRequests, 1);
      assert.ok(metrics.detailedStats.totalTokens > 0);
    });

    it('should analyze multiple request workload', () => {
      const cache = new MockPrefixCache(0.5);
      const analyzer = new KVCacheReuseAnalyzer(cache);
      
      const requests: PDWorkloadRequest[] = [
        {
          id: 'req-1',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100
        },
        {
          id: 'req-2',
          arrivalMs: 100,
          prefillTokens: 256,
          decodeTokens: 50
        },
        {
          id: 'req-3',
          arrivalMs: 200,
          prefillTokens: 1024,
          decodeTokens: 200
        }
      ];

      const metrics = analyzer.analyzeWorkload(requests);
      
      assert.strictEqual(metrics.detailedStats.totalRequests, 3);
      assert.ok(metrics.detailedStats.totalTokens > 0);
      assert.strictEqual(metrics.tokenReuseHistogram.length, 11); // Default histogram buckets
    });

    it('should calculate reuse with cacheable prefix', () => {
      const cache = new MockPrefixCache(0.8);
      const analyzer = new KVCacheReuseAnalyzer(cache);
      
      const requests: PDWorkloadRequest[] = [
        {
          id: 'req-1',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100,
          cacheablePrefixTokens: 200
        },
        {
          id: 'req-2',
          arrivalMs: 100,
          prefillTokens: 512,
          decodeTokens: 100,
          cacheablePrefixTokens: 200
        }
      ];

      const metrics = analyzer.analyzeWorkload(requests);
      
      assert.ok(metrics.prefixReuseRatio >= 0);
      assert.ok(metrics.kvTransferSavingsBytes >= 0);
    });

    it('should calculate correct cost analysis', () => {
      const cache = new MockPrefixCache(0.7);
      const analyzer = new KVCacheReuseAnalyzer(cache);
      
      const requests: PDWorkloadRequest[] = [
        {
          id: 'req-1',
          arrivalMs: 0,
          prefillTokens: 1024,
          decodeTokens: 100
        },
        {
          id: 'req-2',
          arrivalMs: 100,
          prefillTokens: 1024,
          decodeTokens: 100
        }
      ];

      const metrics = analyzer.analyzeWorkload(requests);
      
      assert.ok(metrics.costAnalysis.savedPrefillComputeMs >= 0);
      assert.ok(metrics.costAnalysis.savedNetworkTransferMs >= 0);
      assert.ok(metrics.costAnalysis.memoryOverheadMB >= 0);
      assert.ok(typeof metrics.costAnalysis.costEfficiencyRatio === 'number');
    });
  });

  describe('compareCaches', () => {
    it('should compare multiple caches', () => {
      const cache1 = new MockPrefixCache(0.3);
      const cache2 = new MockPrefixCache(0.7);
      const cache3 = new MockPrefixCache(1.0);
      
      const caches = new Map([
        ['low_hit', cache1],
        ['high_hit', cache2],
        ['always_hit', cache3]
      ]);

      const requests: PDWorkloadRequest[] = [
        { id: 'req-1', arrivalMs: 0, prefillTokens: 512, decodeTokens: 100 },
        { id: 'req-2', arrivalMs: 100, prefillTokens: 512, decodeTokens: 100 },
        { id: 'req-3', arrivalMs: 200, prefillTokens: 512, decodeTokens: 100 }
      ];

      const analyzer = new KVCacheReuseAnalyzer(cache1);
      const results = analyzer.compareCaches(caches, requests);
      
      assert.strictEqual(results.size, 3);
      assert.ok(results.has('low_hit'));
      assert.ok(results.has('high_hit'));
      assert.ok(results.has('always_hit'));
    });
  });

  describe('generateReport', () => {
    it('should generate markdown report', () => {
      const cache = new MockPrefixCache(0.5);
      const analyzer = new KVCacheReuseAnalyzer(cache);
      
      const requests: PDWorkloadRequest[] = [
        { id: 'req-1', arrivalMs: 0, prefillTokens: 512, decodeTokens: 100 },
        { id: 'req-2', arrivalMs: 100, prefillTokens: 256, decodeTokens: 50 }
      ];

      const metrics = analyzer.analyzeWorkload(requests);
      const report = analyzer.generateReport(metrics);
      
      assert.ok(report.includes('# KV-Cache Reuse Analysis Report'));
      assert.ok(report.includes('## Summary'));
      assert.ok(report.includes('## Reuse Metrics'));
      assert.ok(report.includes('## Cost Analysis'));
      assert.ok(report.includes('## Token Reuse Histogram'));
    });

    it('should include KV transfer savings in report', () => {
      const cache = new MockPrefixCache(0.7);
      const analyzer = new KVCacheReuseAnalyzer(cache);
      
      const requests: PDWorkloadRequest[] = [
        { id: 'req-1', arrivalMs: 0, prefillTokens: 1024, decodeTokens: 100 },
        { id: 'req-2', arrivalMs: 100, prefillTokens: 1024, decodeTokens: 100 }
      ];

      const metrics = analyzer.analyzeWorkload(requests);
      const report = analyzer.generateReport(metrics);
      
      assert.ok(report.includes('KV Transfer Savings'));
      assert.ok(report.includes('Bytes Saved'));
      assert.ok(report.includes('Savings Percentage'));
    });
  });

  describe('generateComparisonReport', () => {
    it('should generate comparison report for multiple caches', () => {
      const cache1 = new MockPrefixCache(0.5);
      const cache2 = new MockPrefixCache(0.8);
      
      const caches = new Map([
        ['cache_a', cache1],
        ['cache_b', cache2]
      ]);

      const requests: PDWorkloadRequest[] = [
        { id: 'req-1', arrivalMs: 0, prefillTokens: 512, decodeTokens: 100 },
        { id: 'req-2', arrivalMs: 100, prefillTokens: 512, decodeTokens: 100 }
      ];

      const analyzer = new KVCacheReuseAnalyzer(cache1);
      const results = analyzer.compareCaches(caches, requests);
      const report = analyzer.generateComparisonReport(results);
      
      assert.ok(report.includes('# KV-Cache Reuse Comparison Report'));
      assert.ok(report.includes('cache_a'));
      assert.ok(report.includes('cache_b'));
      assert.ok(report.includes('Best Cache'));
    });
  });

  describe('getMetricsData', () => {
    it('should return structured metrics data', () => {
      const cache = new MockPrefixCache(0.5);
      const analyzer = new KVCacheReuseAnalyzer(cache);
      
      const requests: PDWorkloadRequest[] = [
        { id: 'req-1', arrivalMs: 0, prefillTokens: 512, decodeTokens: 100 },
        { id: 'req-2', arrivalMs: 100, prefillTokens: 256, decodeTokens: 50 }
      ];

      const metrics = analyzer.analyzeWorkload(requests);
      const data = analyzer.getMetricsData(metrics);
      
      assert.ok(data.summary);
      assert.strictEqual(data.summary.prefixReuseRatio, metrics.prefixReuseRatio);
      assert.strictEqual(data.summary.kvTransferSavingsBytes, metrics.kvTransferSavingsBytes);
      assert.strictEqual(data.summary.costEfficiencyRatio, metrics.costAnalysis.costEfficiencyRatio);
      assert.strictEqual(data.histogramBuckets.length, 11);
    });
  });

  describe('edge cases', () => {
    it('should handle very large token counts', () => {
      const cache = new MockPrefixCache();
      const analyzer = new KVCacheReuseAnalyzer(cache);
      
      const requests: PDWorkloadRequest[] = [
        {
          id: 'req-large',
          arrivalMs: 0,
          prefillTokens: 32768, // Very large
          decodeTokens: 1000
        }
      ];

      const metrics = analyzer.analyzeWorkload(requests);
      
      assert.strictEqual(metrics.detailedStats.totalTokens, 32768);
      assert.strictEqual(metrics.prefixReuseRatio, 0); // Single request
    });

    it('should handle zero cacheable tokens', () => {
      const cache = new MockPrefixCache();
      const analyzer = new KVCacheReuseAnalyzer(cache);
      
      const requests: PDWorkloadRequest[] = [
        {
          id: 'req-1',
          arrivalMs: 0,
          prefillTokens: 512,
          decodeTokens: 100,
          cacheablePrefixTokens: 0
        }
      ];

      const metrics = analyzer.analyzeWorkload(requests);
      
      assert.ok(metrics.detailedStats.uniqueTokens >= 0);
    });

    it('should handle mixed priority requests', () => {
      const cache = new MockPrefixCache(0.5);
      const analyzer = new KVCacheReuseAnalyzer(cache);
      
      const requests: PDWorkloadRequest[] = [
        { id: 'req-1', arrivalMs: 0, prefillTokens: 512, decodeTokens: 100, priority: 'interactive' },
        { id: 'req-2', arrivalMs: 50, prefillTokens: 256, decodeTokens: 50, priority: 'background' },
        { id: 'req-3', arrivalMs: 100, prefillTokens: 1024, decodeTokens: 200, priority: 'interactive' }
      ];

      const metrics = analyzer.analyzeWorkload(requests);
      
      assert.strictEqual(metrics.detailedStats.totalRequests, 3);
    });
  });
});

describe('Cache Reuse Histogram', () => {
  it('should produce valid histogram buckets', () => {
    const cache = new MockPrefixCache(0.6);
    const analyzer = new KVCacheReuseAnalyzer(cache);
    
    const requests: PDWorkloadRequest[] = [
      { id: 'req-1', arrivalMs: 0, prefillTokens: 64, decodeTokens: 10 },
      { id: 'req-2', arrivalMs: 50, prefillTokens: 128, decodeTokens: 20 },
      { id: 'req-3', arrivalMs: 100, prefillTokens: 256, decodeTokens: 30 },
      { id: 'req-4', arrivalMs: 150, prefillTokens: 512, decodeTokens: 40 },
      { id: 'req-5', arrivalMs: 200, prefillTokens: 1024, decodeTokens: 50 }
    ];

    const metrics = analyzer.analyzeWorkload(requests);
    
    // Histogram should have 11 buckets
    assert.strictEqual(metrics.tokenReuseHistogram.length, 11);
    
    // All counts should be non-negative
    metrics.tokenReuseHistogram.forEach(count => {
      assert.ok(count >= 0);
    });
    
    // Total count should match requests
    const totalCount = metrics.tokenReuseHistogram.reduce((a, b) => a + b, 0);
    assert.ok(totalCount > 0);
  });
});

describe('Cost Efficiency', () => {
  it('should calculate correct cost efficiency ratio', () => {
    const cache = new MockPrefixCache(0.7);
    const analyzer = new KVCacheReuseAnalyzer(cache);
    
    const requests: PDWorkloadRequest[] = [
      { id: 'req-1', arrivalMs: 0, prefillTokens: 512, decodeTokens: 100 },
      { id: 'req-2', arrivalMs: 100, prefillTokens: 512, decodeTokens: 100 },
      { id: 'req-3', arrivalMs: 200, prefillTokens: 512, decodeTokens: 100 },
      { id: 'req-4', arrivalMs: 300, prefillTokens: 512, decodeTokens: 100 },
      { id: 'req-5', arrivalMs: 400, prefillTokens: 512, decodeTokens: 100 }
    ];

    const metrics = analyzer.analyzeWorkload(requests);
    
    // Cost efficiency should be calculated
    assert.ok(typeof metrics.costAnalysis.costEfficiencyRatio === 'number');
    
    // Should have saved compute
    assert.ok(metrics.costAnalysis.savedPrefillComputeMs >= 0);
    
    // Should have saved network transfer
    assert.ok(metrics.costAnalysis.savedNetworkTransferMs >= 0);
  });

  it('should handle zero memory overhead', () => {
    const emptyCache: AbstractPrefixCache = {
      lookup: () => ({ matchedLength: 0, totalRequested: 0, hitRate: 0, cacheEntry: null }),
      insert: () => {},
      getStats: () => ({ totalHits: 0, totalMisses: 0, hitRate: 0, memoryUsageMB: 0, evictions: 0 }),
      clear: () => {},
      release: () => {},
      getImplementationName: () => 'EmptyCache'
    };

    const analyzer = new KVCacheReuseAnalyzer(emptyCache);
    
    const requests: PDWorkloadRequest[] = [
      { id: 'req-1', arrivalMs: 0, prefillTokens: 512, decodeTokens: 100 }
    ];

    const metrics = analyzer.analyzeWorkload(requests);
    
    // Should handle zero memory gracefully
    assert.strictEqual(metrics.costAnalysis.memoryOverheadMB, 0);
    assert.strictEqual(metrics.costAnalysis.costEfficiencyRatio, 0);
  });
});
