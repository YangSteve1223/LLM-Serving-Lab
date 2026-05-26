/**
 * DeepSeekAdapter - Real engine adapter for DeepSeek API.
 * 
 * Implements streaming requests to DeepSeek API with comprehensive
 * latency metric collection for simulator calibration.
 * 
 * Features:
 * - OpenAI-compatible API
 * - Streaming with token-by-token latency
 * - Automatic retry with exponential backoff
 * - Rate limit handling (429 errors)
 * 
 * API key is read from DEEPSEEK_API_KEY environment variable
 * and is NEVER written to any file.
 */
import type {
  RealEngineConfig,
  RealEngineMetrics,
  EngineRequestResult,
  IRealEngineAdapter,
  MetricsStatistics
} from "./RealEngineAdapter.ts";
import {
  generateTestPrompt,
  calculateStatistics,
  exponentialBackoff
} from "./RealEngineAdapter.ts";

/**
 * DeepSeek adapter specific options.
 */
export interface DeepSeekAdapterOptions {
  /** API key (reads from DEEPSEEK_API_KEY env if not provided) */
  apiKey?: string;
  /** Base URL (defaults to https://api.deepseek.com) */
  baseUrl?: string;
  /** Model name */
  model?: string;
  /** Maximum tokens per request */
  maxTokens?: number;
  /** Request timeout in ms */
  timeoutMs?: number;
  /** Temperature for generation */
  temperature?: number;
}

/**
 * Result of a streaming token event.
 */
interface TokenEvent {
  content: string;
  timestamp: number;
}

/**
 * DeepSeek API response chunk structure.
 */
interface DeepSeekChunk {
  id?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      content?: string;
      role?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * DeepSeekAdapter - Adapter for DeepSeek API integration.
 */
export class DeepSeekAdapter implements IRealEngineAdapter {
  private config: RealEngineConfig;
  private lastRequestMetrics?: RealEngineMetrics;
  
  // Default configuration
  private static readonly DEFAULT_BASE_URL = "https://api.deepseek.com";
  private static readonly DEFAULT_MODEL = "deepseek-chat";
  private static readonly DEFAULT_MAX_TOKENS = 1024;
  private static readonly DEFAULT_TIMEOUT_MS = 60000;
  
  constructor(options: DeepSeekAdapterOptions = {}) {
    const apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY || "";
    
    this.config = {
      engineType: 'deepseek',
      baseUrl: options.baseUrl || DeepSeekAdapter.DEFAULT_BASE_URL,
      apiKey: apiKey || undefined,
      model: options.model || DeepSeekAdapter.DEFAULT_MODEL,
      maxTokens: options.maxTokens || DeepSeekAdapter.DEFAULT_MAX_TOKENS,
      timeoutMs: options.timeoutMs || DeepSeekAdapter.DEFAULT_TIMEOUT_MS,
      temperature: options.temperature ?? 0.7
    };
  }
  
  /**
   * Get the engine configuration.
   */
  getConfig(): RealEngineConfig {
    return { ...this.config };
  }
  
  /**
   * Check if the adapter is properly configured.
   */
  isAvailable(): boolean {
    return Boolean(this.config.apiKey);
  }
  
  /**
   * Send a streaming request to DeepSeek API.
   * Collects token-by-token latencies for TTFT/TPOT calculation.
   */
  async request(
    prompt: string,
    options: { maxTokens?: number; temperature?: number } = {}
  ): Promise<EngineRequestResult> {
    const maxTokens = options.maxTokens ?? this.config.maxTokens;
    const temperature = options.temperature ?? this.config.temperature ?? 0.7;
    
    const requestStartMs = performance.now();
    let firstTokenMs: number | undefined;
    const tokenEvents: TokenEvent[] = [];
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let outputText = "";
    
    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "user", content: prompt }
          ],
          max_tokens: maxTokens,
          temperature,
          stream: true
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? DeepSeekAdapter.DEFAULT_TIMEOUT_MS)
      });
      
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(`Rate limit exceeded (429). Please wait before retrying.`);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      if (!response.body) {
        throw new Error("No response body");
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const text = decoder.decode(value, { stream: true });
        buffer += text;
        
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            
            try {
              const chunk = JSON.parse(data) as DeepSeekChunk;
              
              // Extract usage from first chunk with usage info
              if (chunk.usage) {
                promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
                completionTokens = chunk.usage.completion_tokens ?? completionTokens;
              }
              
              const content = chunk.choices?.[0]?.delta?.content;
              if (content) {
                const now = performance.now();
                firstTokenMs ??= now;
                tokenEvents.push({ content, timestamp: now });
                outputText += content;
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
      
      // Process remaining buffer
      if (buffer.startsWith("data: ")) {
        const data = buffer.slice(6).trim();
        if (data !== "[DONE]") {
          try {
            const chunk = JSON.parse(data) as DeepSeekChunk;
            const content = chunk.choices?.[0]?.delta?.content;
            if (content) {
              const now = performance.now();
              firstTokenMs ??= now;
              tokenEvents.push({ content, timestamp: now });
              outputText += content;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
      
    } catch (error) {
      throw new Error(`DeepSeek API request failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
    
    const e2eMs = performance.now() - requestStartMs;
    
    // Calculate ITL array
    const itlMs: number[] = [];
    for (let i = 1; i < tokenEvents.length; i++) {
      itlMs.push(tokenEvents[i].timestamp - tokenEvents[i - 1].timestamp);
    }
    
    // Calculate metrics
    const ttftMs = firstTokenMs ? firstTokenMs - requestStartMs : e2eMs;
    const tpotMs = itlMs.length > 0 
      ? itlMs.reduce((a, b) => a + b, 0) / itlMs.length 
      : 0;
    const tokensPerSecond = e2eMs > 0 && completionTokens 
      ? (completionTokens / e2eMs) * 1000 
      : tokenEvents.length > 0 
        ? (tokenEvents.length / e2eMs) * 1000 
        : 0;
    
    this.lastRequestMetrics = {
      ttftMs,
      tpotMs,
      e2eMs,
      tokensPerSecond,
      promptTokens: promptTokens ?? Math.ceil(prompt.split(/\s+/).length * 1.3),
      completionTokens: completionTokens ?? tokenEvents.length,
      itlMs,
      timestamp: requestStartMs
    };
    
    return {
      text: outputText,
      metrics: this.lastRequestMetrics,
      streamed: true
    };
  }
  
  /**
   * Send a request with automatic retry on failure.
   */
  async requestWithRetry(
    prompt: string,
    options: {
      maxTokens?: number;
      temperature?: number;
      maxRetries?: number;
      baseDelayMs?: number;
    } = {}
  ): Promise<EngineRequestResult> {
    const maxRetries = options.maxRetries ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 1000;
    
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.request(prompt, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Don't retry on non-retryable errors
        if (attempt < maxRetries && this.isRetryableError(lastError)) {
          console.log(`Attempt ${attempt + 1} failed: ${lastError.message}. Retrying...`);
          await exponentialBackoff(attempt, baseDelayMs);
        } else {
          throw lastError;
        }
      }
    }
    
    throw lastError ?? new Error("Request failed after retries");
  }
  
  /**
   * Check if an error is retryable.
   */
  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes("rate limit") ||
      message.includes("429") ||
      message.includes("timeout") ||
      message.includes("econnreset") ||
      message.includes("network") ||
      message.includes("503") ||
      message.includes("502") ||
      message.includes("504")
    );
  }
  
  /**
   * Get HTTP headers for DeepSeek API.
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }
    
    return headers;
  }
  
  /**
   * Run multiple measurements and return statistics.
   */
  async runMeasurements(
    prompt: string,
    outputTokens: number,
    repetitions: number,
    delayMs: number = 1000
  ): Promise<{
    metrics: RealEngineMetrics[];
    statistics: {
      ttft: MetricsStatistics;
      tpot: MetricsStatistics;
      e2e: MetricsStatistics;
      throughput: MetricsStatistics;
    };
  }> {
    const metrics: RealEngineMetrics[] = [];
    
    for (let i = 0; i < repetitions; i++) {
      try {
        const result = await this.requestWithRetry(prompt, { maxTokens: outputTokens });
        metrics.push(result.metrics);
        console.log(`  Rep ${i + 1}/${repetitions}: TTFT=${result.metrics.ttftMs.toFixed(1)}ms, TPOT=${result.metrics.tpotMs.toFixed(1)}ms, E2E=${result.metrics.e2eMs.toFixed(1)}ms`);
      } catch (error) {
        console.error(`  Rep ${i + 1} failed:`, error instanceof Error ? error.message : String(error));
      }
      
      // Delay between requests
      if (i < repetitions - 1 && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    const ttftValues = metrics.map(m => m.ttftMs);
    const tpotValues = metrics.map(m => m.tpotMs);
    const e2eValues = metrics.map(m => m.e2eMs);
    const throughputValues = metrics.map(m => m.tokensPerSecond);
    
    return {
      metrics,
      statistics: {
        ttft: calculateStatistics(ttftValues),
        tpot: calculateStatistics(tpotValues),
        e2e: calculateStatistics(e2eValues),
        throughput: calculateStatistics(throughputValues)
      }
    };
  }
  
  /**
   * Get the last request metrics.
   */
  getLastMetrics(): RealEngineMetrics | undefined {
    return this.lastRequestMetrics;
  }
}

/**
 * Factory function to create a DeepSeekAdapter.
 */
export function createDeepSeekAdapter(options?: DeepSeekAdapterOptions): DeepSeekAdapter {
  return new DeepSeekAdapter(options);
}
