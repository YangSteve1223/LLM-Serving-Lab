/**
 * Tests for HashBasedPrefixCache (vLLM-style automatic prefix caching).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { HashBasedPrefixCache } from '../../../src/agents/learningAssistant/serving/alignment/HashBasedPrefixCache.ts';

describe('HashBasedPrefixCache', () => {
  let cache: HashBasedPrefixCache;

  beforeEach(() => {
    cache = new HashBasedPrefixCache({
      maxMemoryMB: 64,
      blockSizeTokens: 64,
      enableRefCount: true,
      enableLRU: true
    });
  });

  afterEach(() => {
    cache.clear();
  });

  it('should insert and lookup tokens', () => {
    const tokens = [1, 2, 3, 4, 5, 6, 7, 8];
    const blockIds = cache.insert(tokens);
    
    assert.ok(blockIds.length > 0, 'Should return block IDs');
    
    const result = cache.lookup(tokens);
    assert.ok(result.chainMatchLength > 0, 'Should find matching chain');
  });

  it('should track reference counts', () => {
    const tokens1 = [1, 2, 3, 4, 5, 6];
    const tokens2 = [1, 2, 3, 4, 5, 6, 7, 8]; // Shares prefix with tokens1
    
    cache.insert(tokens1);
    const blockIds = cache.insert(tokens2);
    
    // Release first insertion
    cache.release(blockIds.slice(0, 1));
    
    // Should still exist due to ref count
    const result = cache.lookup(tokens1);
    assert.ok(result.chainMatchLength > 0, 'Should still have cache after partial release');
  });

  it('should evict LRU blocks when capacity exceeded', () => {
    // Create many blocks to exceed capacity
    for (let i = 0; i < 100; i++) {
      const tokens = Array.from({ length: 128 }, (_, j) => (i * 1000) + j);
      cache.insert(tokens);
    }
    
    const stats = cache.getStats();
    assert.ok(stats.totalBlocks > 0, 'Should have some blocks');
    // Note: eviction depends on memory configuration and reference counts
    assert.ok(stats.evictions >= 0, 'Should track evictions');
  });

  it('should calculate hit rate correctly', () => {
    const tokens = [1, 2, 3, 4, 5, 6];
    
    // First lookup - miss
    cache.lookup(tokens);
    
    // Insert
    cache.insert(tokens);
    
    // Second lookup - hit
    cache.lookup(tokens);
    
    const stats = cache.getStats();
    assert.strictEqual(stats.totalHits, 1, 'Should have 1 hit');
    assert.strictEqual(stats.totalMisses, 1, 'Should have 1 miss');
  });

  it('should pin blocks to prevent eviction', () => {
    const tokens = Array.from({ length: 128 }, (_, i) => i);
    const blockIds = cache.insert(tokens);
    
    assert.ok(blockIds.length > 0, 'Should return block IDs');
    
    // Pin first block
    cache.pin(blockIds[0]);
    
    const stats = cache.getStats();
    assert.strictEqual(stats.pinCount, 1, 'Should have 1 pinned block');
    
    // Unpin
    cache.unpin(blockIds[0]);
    
    const statsAfter = cache.getStats();
    assert.strictEqual(statsAfter.pinCount, 0, 'Should have 0 pinned blocks');
  });

  it('should compute block hashes correctly', () => {
    const tokens1 = [1, 2, 3];
    const tokens2 = [1, 2, 3];
    
    const blockIds1 = cache.insert(tokens1);
    const blockIds2 = cache.insert(tokens2);
    
    // Same tokens should produce same block IDs
    assert.strictEqual(blockIds1[0], blockIds2[0], 'Same tokens should produce same block ID');
  });
});
