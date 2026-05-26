/**
 * Hash-Based Prefix Cache - Simulates vLLM Automatic Prefix Caching.
 * 
 * Key differences from RadixTree:
 * - Uses hash-based indirect addressing (block identified by hash(parent_hash + block_tokens))
 * - Global hash table instead of tree traversal
 * - Reference count + LRU combined eviction
 * - Cross-request block sharing
 * 
 * This is a simulation of vLLM's Automatic Prefix Caching mechanism.
 */
import { createHash } from "node:crypto";

export interface HashBlock {
  blockId: string;           // hash(parent_hash + block_tokens)
  parentHash: string | null; // Parent block hash for chain
  tokens: number[];          // Token sequence in this block
  refCount: number;           // Reference count for sharing
  lastAccessTime: number;     // For LRU tracking
  sizeBytes: number;          // Memory size
  createdAt: number;
  isPinned: boolean;          // Prevent eviction
}

export interface HashCacheConfig {
  maxMemoryMB: number;
  blockSizeTokens: number;    // Tokens per block
  enableRefCount: boolean;   // Enable reference counting
  enableLRU: boolean;        // Enable LRU as secondary eviction
}

export interface HashCacheStats {
  totalBlocks: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  memoryUsageMB: number;
  maxMemoryMB: number;
  evictions: number;
  pinCount: number;
  chainDepth: number;         // Max chain depth
}

export interface HashLookupResult {
  block: HashBlock | null;
  chainMatchLength: number;    // How many blocks matched in chain
  missingBlocks: number[];    // Indices of missing blocks in chain
}

/**
 * Hash-based prefix cache with indirect addressing.
 * Simulates vLLM's Automatic Prefix Caching.
 */
export class HashBasedPrefixCache {
  private config: Required<HashCacheConfig>;
  private blocks: Map<string, HashBlock>;
  private accessOrder: string[]; // For LRU tracking
  private stats: HashCacheStats;

  constructor(config: Partial<HashCacheConfig> = {}) {
    this.config = {
      maxMemoryMB: config.maxMemoryMB ?? 1024,
      blockSizeTokens: config.blockSizeTokens ?? 64,
      enableRefCount: config.enableRefCount ?? true,
      enableLRU: config.enableLRU ?? true
    };
    
    this.blocks = new Map();
    this.accessOrder = [];
    this.stats = {
      totalBlocks: 0,
      totalHits: 0,
      totalMisses: 0,
      hitRate: 0,
      memoryUsageMB: 0,
      maxMemoryMB: this.config.maxMemoryMB,
      evictions: 0,
      pinCount: 0,
      chainDepth: 0
    };
  }

  /**
   * Compute block hash from parent hash and tokens.
   */
  private computeBlockHash(parentHash: string | null, tokens: number[]): string {
    const data = JSON.stringify({ parent: parentHash, tokens });
    return createHash("sha256").update(data).digest("hex").substring(0, 16);
  }

  /**
   * Pin a block to prevent eviction.
   */
  pin(blockId: string): boolean {
    const block = this.blocks.get(blockId);
    if (block) {
      block.isPinned = true;
      this.stats.pinCount++;
      return true;
    }
    return false;
  }

  /**
   * Unpin a block.
   */
  unpin(blockId: string): boolean {
    const block = this.blocks.get(blockId);
    if (block && block.isPinned) {
      block.isPinned = false;
      this.stats.pinCount--;
      return true;
    }
    return false;
  }

  /**
   * Insert a token sequence into the cache.
   */
  insert(tokens: number[]): string[] {
    const blockIds: string[] = [];
    let parentHash: string | null = null;
    
    // Split tokens into blocks
    for (let i = 0; i < tokens.length; i += this.config.blockSizeTokens) {
      const blockTokens = tokens.slice(i, i + this.config.blockSizeTokens);
      const blockId = this.computeBlockHash(parentHash, blockTokens);
      
      const existing = this.blocks.get(blockId);
      if (existing) {
        // Update existing block
        existing.refCount++;
        existing.lastAccessTime = Date.now();
        this.updateLRU(blockId);
      } else {
        // Create new block
        const sizeBytes = blockTokens.length * 640; // ~640 bytes per token per layer
        this.ensureCapacity(sizeBytes);
        
        const block: HashBlock = {
          blockId,
          parentHash,
          tokens: blockTokens,
          refCount: 1,
          lastAccessTime: Date.now(),
          sizeBytes,
          createdAt: Date.now(),
          isPinned: false
        };
        
        this.blocks.set(blockId, block);
        this.stats.totalBlocks++;
        this.updateLRU(blockId);
      }
      
      blockIds.push(blockId);
      parentHash = blockId;
    }
    
    this.stats.chainDepth = Math.max(this.stats.chainDepth, blockIds.length);
    return blockIds;
  }

  /**
   * Lookup tokens in cache, return matching chain.
   */
  lookup(tokens: number[]): HashLookupResult {
    let parentHash: string | null = null;
    let chainMatchLength = 0;
    const missingBlocks: number[] = [];
    
    for (let i = 0; i < tokens.length; i += this.config.blockSizeTokens) {
      const blockTokens = tokens.slice(i, i + this.config.blockSizeTokens);
      const blockId = this.computeBlockHash(parentHash, blockTokens);
      
      const block = this.blocks.get(blockId);
      if (block) {
        chainMatchLength++;
        // Update access for LRU
        block.lastAccessTime = Date.now();
        this.updateLRRU(blockId);
      } else {
        missingBlocks.push(Math.floor(i / this.config.blockSizeTokens));
      }
      
      parentHash = blockId;
    }
    
    const lastBlockId = this.computeBlockHash(
      parentHash ? this.blocks.get(parentHash)?.parentHash ?? null : null,
      tokens.slice(Math.floor((tokens.length - 1) / this.config.blockSizeTokens) * this.config.blockSizeTokens, tokens.length)
    );
    
    const lastBlock = this.blocks.get(lastBlockId) ?? null;
    
    if (chainMatchLength > 0) {
      this.stats.totalHits++;
    } else {
      this.stats.totalMisses++;
    }
    
    this.stats.hitRate = this.stats.totalHits / (this.stats.totalHits + this.stats.totalMisses);
    
    return { block: lastBlock, chainMatchLength, missingBlocks };
  }

  /**
   * Get the first N blocks of a token sequence from cache.
   */
  getBlocks(tokens: number[]): HashBlock[] {
    const blocks: HashBlock[] = [];
    let parentHash: string | null = null;
    
    for (let i = 0; i < tokens.length; i += this.config.blockSizeTokens) {
      const blockTokens = tokens.slice(i, i + this.config.blockSizeTokens);
      const blockId = this.computeBlockHash(parentHash, blockTokens);
      
      const block = this.blocks.get(blockId);
      if (block) {
        blocks.push(block);
        parentHash = blockId;
      } else {
        break; // Stop at first miss
      }
    }
    
    return blocks;
  }

  /**
   * Decrement reference count and evict if zero.
   */
  release(blockIds: string[]): void {
    for (const blockId of blockIds) {
      const block = this.blocks.get(blockId);
      if (block && this.config.enableRefCount) {
        block.refCount--;
        if (block.refCount <= 0 && !block.isPinned) {
          this.evict(blockId);
        }
      }
    }
  }

  /**
   * Update LRU access order.
   */
  private updateLRU(blockId: string): void {
    if (!this.config.enableLRU) return;
    
    const idx = this.accessOrder.indexOf(blockId);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
    this.accessOrder.push(blockId);
  }

  private updateLRRU(blockId: string): void {
    this.updateLRU(blockId);
  }

  /**
   * Ensure capacity, evict if needed.
   */
  private ensureCapacity(additionalBytes: number): void {
    const currentMB = this.stats.memoryUsageMB;
    const additionalMB = additionalBytes / (1024 * 1024);
    
    while (currentMB + additionalMB > this.config.maxMemoryMB) {
      const evicted = this.evictLRU();
      if (!evicted) break; // No more evictable blocks
    }
    
    this.stats.memoryUsageMB = currentMB + additionalMB;
  }

  /**
   * Evict least recently used unpinned block.
   */
  private evictLRU(): boolean {
    if (!this.config.enableLRU) return false;
    
    for (let i = 0; i < this.accessOrder.length; i++) {
      const blockId = this.accessOrder[i];
      const block = this.blocks.get(blockId);
      
      if (block && !block.isPinned && block.refCount <= 0) {
        return this.evict(blockId);
      }
    }
    
    return false;
  }

  /**
   * Evict a specific block.
   */
  private evict(blockId: string): boolean {
    const block = this.blocks.get(blockId);
    if (!block || block.isPinned) return false;
    
    this.blocks.delete(blockId);
    this.stats.totalBlocks--;
    this.stats.memoryUsageMB -= block.sizeBytes / (1024 * 1024);
    this.stats.evictions++;
    
    // Remove from LRU order
    const idx = this.accessOrder.indexOf(blockId);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
    
    // Recursively evict children (if they have refCount 0)
    const children = Array.from(this.blocks.values())
      .filter(b => b.parentHash === blockId);
    
    for (const child of children) {
      if (child.refCount <= 0 && !child.isPinned) {
        this.evict(child.blockId);
      }
    }
    
    return true;
  }

  /**
   * Get cache statistics.
   */
  getStats(): HashCacheStats {
    return { ...this.stats };
  }

  /**
   * Clear all non-pinned blocks.
   */
  clear(): void {
    for (const [blockId, block] of this.blocks) {
      if (!block.isPinned) {
        this.blocks.delete(blockId);
        this.stats.totalBlocks--;
        this.stats.memoryUsageMB -= block.sizeBytes / (1024 * 1024);
      }
    }
    this.accessOrder = [];
  }

  /**
   * Get cache size in bytes.
   */
  getSizeBytes(): number {
    let total = 0;
    for (const block of this.blocks.values()) {
      total += block.sizeBytes;
    }
    return total;
  }
}

/**
 * Compare Hash-based cache with Radix Tree interface.
 */
export function compareHashToRadixInterface(): void {
  console.log("=== Hash-Based vs Radix Tree Interface Comparison ===");
  console.log("");
  console.log("Hash-Based Prefix Cache (vLLM-style):");
  console.log("  - insert(tokens): string[]        // Returns block IDs");
  console.log("  - lookup(tokens): LookupResult     // Returns match info");
  console.log("  - release(blockIds): void         // Decrement ref counts");
  console.log("  - getBlocks(tokens): Block[]       // Get cached blocks");
  console.log("");
  console.log("Radix Prefix Cache (Tree-style):");
  console.log("  - insert(tokens): CacheEntry       // Returns entry");
  console.log("  - findLongestPrefix(tokens): Result // Returns match + length");
  console.log("  - findExact(tokens): CacheEntry    // Exact match only");
  console.log("");
  console.log("Key Differences:");
  console.log("  1. Hash-based uses indirect addressing (hash -> block)");
  console.log("  2. Radix uses tree traversal (token -> node)");
  console.log("  3. Hash-based has reference counting for sharing");
  console.log("  4. Radix has cumulative access counts per node");
  console.log("  5. Hash-based is O(1) lookup, Radix is O(n) where n = token depth");
}
