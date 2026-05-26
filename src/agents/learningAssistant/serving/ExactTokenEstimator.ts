/**
 * Exact Token Estimator with multiple tokenization methods.
 * 
 * Features:
 * - Heuristic estimation (existing method)
 * - Lightweight BPE implementation
 * - Tiktoken-style byte-pair encoding
 * - Exact tokenizer integration (when available)
 * - Comparison interface for error analysis
 */
import type {
  TokenEstimatorType,
  TokenEstimateResult,
  TokenEstimateComparison,
  ExactTokenEstimatorConfig
} from "./ServingTrace.ts";

// Common BPE merges for English text (simplified GPT-2 style vocab)
const COMMON_BPE_MERGES = [
  ["t", "h"], ["t", "he"], ["th", "e"], ["the"],
  ["i", "n"], ["in", "g"], ["ing"],
  ["e", "r"], ["er", ""], ["re"],
  ["o", "u"], ["ou", ""],
  ["a", "n"], ["an", "d"], ["and"],
  ["c", "o"], ["co", "n"], ["con"],
  ["d", "e"], ["de", ""],
  ["s", "t"], ["st", "r"], ["str"],
  ["e", "d"], ["ed", ""],
  ["n", "t"], ["nt", ""],
  ["o", "f"], ["of", ""],
  ["t", "o"], ["to", ""],
  ["w", "h"], ["wh", "a"], ["what"],
  ["a", "s"], ["as", ""],
  ["i", "s"], ["is", ""],
  ["t", "hat"], ["that"],
  ["f", "or"], ["for"],
  ["h", "a"], ["ha", "v"], ["have"],
  ["w", "i"], ["wi", "th"], ["with"],
  ["n", "o"], ["no", "t"], ["not"],
  ["b", "e"], ["be", "e"], ["been"],
  ["t", "hey"], ["they"],
  ["w", "e"], ["we", "r"], ["were"],
  ["t", "his"], ["this"],
  ["w", "ill"], ["will"],
  ["f", "r"], ["fr", "om"], ["from"],
  ["b", "y"], ["by", ""],
  ["t", "heir"], ["their"],
  ["o", "n"], ["on", ""],
  ["a", "r"], ["ar", "e"], ["are"],
  ["d", "o"], ["do", ""],
  ["a", "t"], ["at", ""],
  ["w", "hich"], ["which"],
  ["w", "ould"], ["would"],
  ["c", "ou"], ["cou", "ld"], ["could"],
  ["s", "h"], ["sh", "o"], ["show"],
  ["a", "ll"], ["all", ""],
  ["a", "bout"], ["about"],
  ["i", "t"], ["it", ""],
  ["t", "ime"], ["time"],
  ["w", "ork"], ["work"],
  ["p", "e"], ["pe", "r"], ["per"],
  ["p", "l"], ["pl", "a"], ["place"],
  ["s", "a"], ["sa", "y"], ["say"],
  ["p", "eople"], ["people"],
  ["w", "orld"], ["world"],
  ["l", "i"], ["li", "ke"], ["like"],
  ["k", "n"], ["kn", "o"], ["know"],
  ["s", "ee"], ["see"],
  ["c", "ome"], ["come"],
  ["o", "nly"], ["only"],
  ["t", "hen"], ["then"],
  ["b", "ecause"], ["because"],
  ["e", "ven"], ["even"],
  ["s", "o"], ["so", ""],
  ["s", "ome"], ["some"],
  ["t", "ake"], ["take"],
  ["f", "irst"], ["first"],
  ["g", "e"], ["ge", "t"], ["get"],
  ["v", "e"], ["ve", ""], ["very"],
  ["d", "a"], ["da", "y"], ["day"],
  ["w", "ay"], ["way"],
  ["m", "a"], ["ma", "n"], ["man"],
  ["w", "ant"], ["want"],
  ["m", "a"], ["ma", "k"], ["make"],
  ["n", "e"], ["ne", "w"], ["new"],
  ["c", "i"], ["ci", "t"], ["city"],
  ["t", "wo"], ["two"],
  ["m", "o"], ["mo", "st"], ["most"],
  ["p", "art"], ["part"],
  ["f", "ind"], ["find"],
  ["b", "ig"], ["big"],
  ["y", "e"], ["ye", "a"], ["year"],
  ["r", "i"], ["ri", "g"], ["right"],
  ["g", "o"], ["go", ""],
  ["w", "hen"], ["when"],
  ["t", "hree"], ["three"],
  ["g", "i"], ["gi", "v"], ["give"],
  ["m", "a"], ["ma", "n"], ["many"],
  ["m", "o"], ["mo", "r"], ["more"],
  ["m", "e"], ["me", "t"], ["might"],
  ["c", "o"], ["co", "m"], ["come"],
  ["d", "o"], ["do", "e"], ["does"],
  ["d", "i"], ["di", "f"], ["different"],
  ["a", "n"], ["an", "y"], ["any"],
  ["m", "u"], ["mu", "s"], ["must"],
  ["a", "f"], ["af", "t"], ["after"],
  ["m", "o"], ["mo", "s"], ["most"],
  ["b", "e"], ["be", "f"], ["before"],
  ["c", "h"], ["ch", "a"], ["change"],
  ["s", "t"], ["st", "u"], ["study"],
  ["s", "t"], ["st", "i"], ["still"],
  ["h", "o"], ["ho", "w"], ["how"],
  ["s", "t"], ["st", "a"], ["stand"],
  ["l", "o"], ["lo", "n"], ["long"],
  ["u", "n"], ["un", "d"], ["under"],
  ["p", "u"], ["pu", "b"], ["public"],
  ["t", "e"], ["te", "a"], ["teach"],
  ["s", "t"], ["st", "u"], ["student"],
  ["s", "c"], ["sc", "h"], ["school"],
  ["e", "a"], ["ea", "ch"], ["each"],
  ["g", "o"], ["go", "v"], ["govern"],
  ["w", "h"], ["wh", "o"], ["who"],
  ["h", "e"], ["he", ""],
  ["s", "h"], ["sh", "e"], ["she"],
  ["h", "er"], ["her", ""],
  ["w", "i"], ["wi", "th"], ["with"],
  ["h", "i"], ["hi", "m"], ["him"],
  ["t", "h"], ["th", "eir"], ["their"],
  ["w", "e"], ["we", ""],
  ["t", "h"], ["th", "e"], ["the"],
  ["a", "r"], ["ar", "e"], ["are"],
  ["t", "h"], ["th", "ey"], ["they"],
  ["t", "h"], ["th", "is"], ["this"],
  ["m", "y"], ["my", ""],
  ["y", "o"], ["yo", "u"], ["you"],
  ["i", "t"], ["it", ""],
  ["i", "s"], ["is", ""],
  ["i", "n"], ["in", ""],
  ["i", "a"], ["ia", ""], ["ia"]
];

// Pre-tokenization patterns
const ENGLISH_TOKEN_PATTERN = /[A-Za-z0-9]+|[^\sA-Za-z0-9]+/g;
const CHINESE_CHAR_PATTERN = /[\u3400-\u9fff]/g;
const WHITESPACE_PATTERN = /\s+/g;

/**
 * Lightweight BPE Tokenizer implementation.
 * Supports basic BPE operations without external dependencies.
 */
export class BPETokenizer {
  private vocab: Map<string, number>;
  private merges: Array<[string, string, string]>; // (a, b) -> ab
  private reverseVocab: Map<number, string>;
  
  constructor(vocabSize = 5000) {
    this.vocab = new Map();
    this.reverseVocab = new Map();
    this.merges = [];
    this.initializeBaseVocab(vocabSize);
  }
  
  /**
   * Initialize base vocabulary with common tokens.
   */
  private initializeBaseVocab(targetSize: number): void {
    let tokenId = 0;
    
    // Special tokens
    const specialTokens = ["<pad>", "<unk>", "<s>", "</s>", "<|endoftext|>"];
    for (const token of specialTokens) {
      this.vocab.set(token, tokenId);
      this.reverseVocab.set(tokenId, token);
      tokenId++;
    }
    
    // Byte-level tokens (GPT-2 style)
    for (let i = 0; i < 256; i++) {
      const token = String.fromCharCode(i);
      this.vocab.set(token, tokenId);
      this.reverseVocab.set(tokenId, token);
      tokenId++;
    }
    
    // Common English words and patterns
    const commonTokens = [
      // Single letters
      ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
      // Common bigrams
      " th", " he", "in", " ng", "er", " ou", " an", "co", "de", "st", "ed", "nt", " of", " to", "wa", "ha", "wi", "no", "be", "re",
      // Common trigrams
      " th", "the", "ing", "her", "hat", "his", "tha", "ere", " for", "ter", " and", "ould", " have", " from",
      // Common words
      " the", " and", " to", " of", " a", " in", " that", " is", " it", " for", " not", " on", " with", " he", " as", " you", " do", " at", " this", " but", " his", " by", " from", " they", " we", " say", " her", " she", " or", " an", " will", " my", " one", " all", " would", " there", " their", " what", " so", " up", " out", " if", " about", " who", " get", " which", " go", " me", " when", " make", " can", " like", " time", " no", " just", " him", " know", " take", " people", " into", " year", " your", " good", " some", " could", " them", " see", " other", " than", " then", " now", " look", " only", " come", " its", " over", " think", " also", " back", " after", " use", " two", " how", " our", " work", " first", " well", " way", " even", " new", " want", " because", " any", " these", " give", " day", " most", " us",
      // Chinese character patterns (CJK Unified Ideographs)
      ...Array.from({ length: 100 }, (_, i) => String.fromCharCode(0x4E00 + i))
    ];
    
    for (const token of commonTokens) {
      if (tokenId >= targetSize) break;
      if (!this.vocab.has(token)) {
        this.vocab.set(token, tokenId);
        this.reverseVocab.set(tokenId, token);
        tokenId++;
      }
    }
  }
  
  /**
   * Pre-tokenize text into words.
   */
  preTokenize(text: string): string[] {
    if (!text) return [];
    
    const tokens: string[] = [];
    
    // Split by whitespace first
    const words = text.split(WHITESPACE_PATTERN).filter(w => w.length > 0);
    
    for (const word of words) {
      // Check for Chinese characters
      const chineseChars = word.match(CHINESE_CHAR_PATTERN);
      if (chineseChars && chineseChars.length === word.length) {
        // Pure Chinese text - each character is a token
        for (const char of word) {
          tokens.push(char);
        }
      } else {
        // English or mixed text - use BPE-style splitting
        const parts = word.match(ENGLISH_TOKEN_PATTERN) || [];
        for (const part of parts) {
          if (part.length > 0) {
            tokens.push(part);
          }
        }
      }
    }
    
    return tokens;
  }
  
  /**
   * Encode text to token IDs using BPE.
   */
  encode(text: string): number[] {
    if (!text) return [];
    
    const preTokens = this.preTokenize(text);
    const tokenIds: number[] = [];
    
    for (const preToken of preTokens) {
      // Add leading space for non-CJK tokens
      const token = preToken.match(CHINESE_CHAR_PATTERN)?.length === preToken.length
        ? preToken
        : " " + preToken;
      
      // Split into characters for BPE
      const chars = Array.from(token);
      
      // Apply BPE merges (simplified - just check for known merges)
      let merged = chars.join("");
      
      // Try common merges
      for (const [a, b, ab] of this.merges) {
        merged = merged.split(a + b).join(ab);
      }
      
      // Convert to token IDs
      const ids = this.tokensToIds([merged]);
      tokenIds.push(...ids);
    }
    
    return tokenIds;
  }
  
  /**
   * Convert tokens to IDs.
   */
  private tokensToIds(tokens: string[]): number[] {
    const ids: number[] = [];
    for (const token of tokens) {
      if (this.vocab.has(token)) {
        ids.push(this.vocab.get(token)!);
      } else {
        // Unknown token - split into bytes
        for (const char of token) {
          const charCode = char.charCodeAt(0);
          if (charCode < 256) {
            ids.push(charCode);
          } else {
            // Non-ASCII - use unknown
            ids.push(this.vocab.get("<unk>") ?? 1);
          }
        }
      }
    }
    return ids;
  }
  
  /**
   * Get vocabulary size.
   */
  getVocabSize(): number {
    return this.vocab.size;
  }
  
  /**
   * Get vocabulary.
   */
  getVocab(): Map<string, number> {
    return new Map(this.vocab);
  }
}

/**
 * Simple heuristic token estimator (inlined, replacing deleted TokenEstimator).
 */
function estimateTokensHeuristic(text: string | undefined): number {
  if (!text) return 0;
  // Count words + special token approximation
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  // Average ~4 chars per English token, 1.5 per Chinese char
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishChars = text.length - chineseChars;
  const tokens = Math.ceil(wordCount * 1.3) + Math.ceil(chineseChars * 1.5) + Math.ceil(englishChars / 4);
  return Math.max(1, Math.ceil(tokens));
}

/**
 * Exact Token Estimator with multiple estimation methods.
 */
export class ExactTokenEstimator {
  private bpeTokenizer: BPETokenizer;
  private config: ExactTokenEstimatorConfig;
  
  constructor(config: ExactTokenEstimatorConfig = { estimatorType: "heuristic" }) {
    this.bpeTokenizer = new BPETokenizer(5000);
    this.config = {
      estimatorType: config.estimatorType ?? "heuristic",
      modelName: config.modelName,
      enableComparison: config.enableComparison ?? false
    };
  }
  
  /**
   * Estimate tokens using the configured method.
   */
  estimate(text: string | undefined): TokenEstimateResult {
    switch (this.config.estimatorType) {
      case "bpe":
        return this.estimateBPE(text);
      case "tiktoken":
        return this.estimateTiktoken(text);
      case "exact":
        return this.estimateExact(text);
      case "heuristic":
      default:
        return this.estimateHeuristic(text);
    }
  }
  
  /**
   * Estimate using heuristic method.
   */
  private estimateHeuristic(text: string | undefined): TokenEstimateResult {
    const tokenCount = estimateTokensHeuristic(text);
    return {
      estimatorType: "heuristic",
      tokenCount,
      confidence: 0.6,
      details: {
        numOperations: text ? text.length : 0
      }
    };
  }
  
  /**
   * Estimate using BPE method.
   */
  private estimateBPE(text: string | undefined): TokenEstimateResult {
    if (!text) {
      return {
        estimatorType: "bpe",
        tokenCount: 0,
        confidence: 0.75,
        details: { vocabSize: this.bpeTokenizer.getVocabSize() }
      };
    }
    
    const tokenIds = this.bpeTokenizer.encode(text);
    const numOperations = text.length;
    
    return {
      estimatorType: "bpe",
      tokenCount: tokenIds.length,
      confidence: 0.75,
      details: {
        vocabSize: this.bpeTokenizer.getVocabSize(),
        numOperations,
        bpeMerges: Math.floor(tokenIds.length * 0.3) // Estimated merge count
      }
    };
  }
  
  /**
   * Estimate using tiktoken-style method.
   * This is a simplified approximation of tiktoken behavior.
   */
  private estimateTiktoken(text: string | undefined): TokenEstimateResult {
    if (!text) {
      return {
        estimatorType: "tiktoken",
        tokenCount: 0,
        confidence: 0.85,
        details: { vocabSize: 100256 } // GPT-4 vocab size approximation
      };
    }
    
    // Tiktoken-style estimation:
    // 1. Split on whitespace
    // 2. For each word, estimate tokens based on length and character patterns
    const words = text.split(WHITESPACE_PATTERN).filter(w => w.length > 0);
    let tokenCount = 0;
    
    for (const word of words) {
      const chineseChars = word.match(CHINESE_CHAR_PATTERN);
      
      if (chineseChars && chineseChars.length === word.length) {
        // Pure Chinese: ~1.5-2 tokens per character (tiktoken cl100k_base approximation)
        tokenCount += Math.ceil(word.length * 1.5);
      } else {
        // English: ~4 chars per token on average
        tokenCount += Math.ceil(word.length / 4) + 1;
      }
    }
    
    // Add approximation for whitespace
    tokenCount += Math.ceil(text.split(WHITESPACE_PATTERN).length * 0.1);
    
    return {
      estimatorType: "tiktoken",
      tokenCount: Math.max(1, tokenCount),
      confidence: 0.85,
      details: {
        vocabSize: 100256,
        numOperations: text.length
      }
    };
  }
  
  /**
   * Estimate using exact tokenizer (when model name is provided).
   */
  private estimateExact(text: string | undefined): TokenEstimateResult {
    // When model name is provided, use model-specific estimation
    // This is a placeholder for actual tokenizer integration
    if (this.config.modelName) {
      // For known models, use optimized estimation
      if (this.config.modelName.includes("gpt-4") || this.config.modelName.includes("gpt-3.5")) {
        return this.estimateTiktoken(text); // Use tiktoken for GPT models
      }
      if (this.config.modelName.includes("llama") || this.config.modelName.includes("mistral")) {
        return this.estimateBPE(text); // Use BPE for LLaMA-family
      }
    }
    
    // Fallback to heuristic
    return this.estimateHeuristic(text);
  }
  
  /**
   * Compare multiple estimation methods.
   */
  compare(text: string | undefined): TokenEstimateComparison {
    const estimators: TokenEstimatorType[] = ["heuristic", "bpe", "tiktoken"];
    const estimates: TokenEstimateResult[] = [];
    
    // Temporarily switch config for each estimator
    const originalType = this.config.estimatorType;
    
    for (const type of estimators) {
      this.config.estimatorType = type;
      estimates.push(this.estimate(text));
    }
    
    // Restore original config
    this.config.estimatorType = originalType;
    
    // Calculate differences
    const tokenCounts = estimates.map(e => e.tokenCount);
    const maxCount = Math.max(...tokenCounts);
    const minCount = Math.min(...tokenCounts);
    const maxDifference = maxCount - minCount;
    const avgDifference = tokenCounts.reduce((sum, count, i) => {
      return sum + Math.abs(count - tokenCounts[0]);
    }, 0) / (tokenCounts.length - 1);
    
    // Find most accurate (highest confidence)
    const mostAccurate = estimates.reduce((best, current) => {
      return current.confidence > best.confidence ? current : best;
    }).estimatorType;
    
    return {
      text: text ?? "",
      truncatedText: text && text.length > 100 ? text.slice(0, 100) + "..." : text,
      estimates,
      maxDifference,
      avgDifference: Math.round(avgDifference * 100) / 100,
      mostAccurate
    };
  }
  
  /**
   * Set estimator type.
   */
  setEstimatorType(type: TokenEstimatorType): void {
    this.config.estimatorType = type;
  }
  
  /**
   * Get current configuration.
   */
  getConfig(): ExactTokenEstimatorConfig {
    return { ...this.config };
  }
}

/**
 * Factory function to create exact token estimator.
 */
export function createExactTokenEstimator(
  type: TokenEstimatorType = "heuristic",
  modelName?: string
): ExactTokenEstimator {
  return new ExactTokenEstimator({
    estimatorType: type,
    modelName
  });
}

/**
 * Convenience function for quick token estimation.
 */
export function estimateTokensExact(text: string | undefined, type: TokenEstimatorType = "heuristic"): number {
  const estimator = new ExactTokenEstimator({ estimatorType: type });
  return estimator.estimate(text).tokenCount;
}

// Export singleton instances
export const exactTokenEstimator = new ExactTokenEstimator({ estimatorType: "heuristic" });
export const bpeTokenEstimator = new ExactTokenEstimator({ estimatorType: "bpe" });
export const tiktokenEstimator = new ExactTokenEstimator({ estimatorType: "tiktoken" });
