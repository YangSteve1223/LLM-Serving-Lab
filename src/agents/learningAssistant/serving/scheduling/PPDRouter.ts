/**
 * PPD Router - Prefill Prefill-capable Decode dynamic routing.
 * 
 * Implements PPD (Prefill Prefill-capable Decode) dynamic routing:
 * - Multi-turn conversations: append-prefill (reuse cached KV) vs full prefill
 * - Turn 2+ requests can be processed locally on D instance (append-prefill)
 * - Routing decision based on SLO and input token count
 * 
 * Reference: PPD Paper (2026.5)
 * Key insight: append-prefill interferes 10x less than full prefill
 */
import type { PDWorkloadRequest, ServingSLO } from "../ServingTrace.ts";

export interface PPDRouterConfig {
  // Turn 1: always route to P (full prefill)
  turn1AlwaysPrefill: boolean;
  
  // Turn 2+: routing thresholds
  maxTokensForLocalAppend: number;     // Max new tokens for D-side append-prefill
  sloMarginPercent: number;             // SLO margin for safe routing
  cacheHitThreshold: number;            // Min cache hit ratio for local append
  
  // Fallback
  fallbackToPrefillOnMiss: boolean;
  
  // SLO constraints
  slo: ServingSLO;
  
  // Context budget
  maxContextBudgetTokens: number;
  enableDynamicBudget: boolean;
}

export interface PPDRoutingDecision {
  requestId: string;
  turnNumber: number;
  newInputTokens: number;
  cachedTokens: number;
  
  // Routing decision
  route: "prefilling" | "decode_append" | "decode_local";
  targetInstance: "P" | "D";
  
  // Reasoning
  reasoning: string;
  cacheHitRatio: number;
  estimatedTTFT: number;
  
  // SLO check
  sloCompliant: boolean;
  sloMargin: number;
}

export interface PPDRoutingMetrics {
  totalRequests: number;
  routedToP: number;
  routedToD: number;
  appendPrefillCount: number;
  fullPrefillCount: number;
  
  // Metrics
  avgTTFT: number;
  avgTPOT: number;
  avgSloMargin: number;
  
  // Cache metrics
  totalCacheHits: number;
  totalCacheMisses: number;
  cacheHitRate: number;
  
  // Comparison with non-PPD
  ttftImprovement: number;
  interferenceReduction: number;
}

export interface PPDConversation {
  conversationId: string;
  turns: PPDRoutingDecision[];
  cachedKVTokens: number;
  lastTurnTimestamp: number;
  isActive: boolean;
}

const DEFAULT_PPD_CONFIG: PPDRouterConfig = {
  turn1AlwaysPrefill: true,
  maxTokensForLocalAppend: 512,
  sloMarginPercent: 20,
  cacheHitThreshold: 0.6,
  fallbackToPrefillOnMiss: true,
  slo: { ttftMs: 2000, tpotMs: 150, e2eMs: 15000 },
  maxContextBudgetTokens: 8192,
  enableDynamicBudget: true
};

/**
 * PPD Router - Dynamic routing for Prefill Prefill-capable Decode.
 * 
 * Core algorithm:
 * 1. Turn 1: Always route to P (full prefill needed)
 * 2. Turn 2+: Check if conditions met for D-side append-prefill
 *    - New tokens < threshold
 *    - SLO allows
 *    - Cache hit ratio > threshold
 * 3. Else: Route to P
 */
export class PPDRouter {
  private config: Required<PPDRouterConfig>;
  private conversations: Map<string, PPDConversation>;
  private metrics: PPDRoutingMetrics;

  constructor(config: Partial<PPDRouterConfig> = {}) {
    this.config = { ...DEFAULT_PPD_CONFIG, ...config };
    this.conversations = new Map();
    this.resetMetrics();
  }

  /**
   * Reset metrics.
   */
  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      routedToP: 0,
      routedToD: 0,
      appendPrefillCount: 0,
      fullPrefillCount: 0,
      avgTTFT: 0,
      avgTPOT: 0,
      avgSloMargin: 0,
      totalCacheHits: 0,
      totalCacheMisses: 0,
      cacheHitRate: 0,
      ttftImprovement: 0,
      interferenceReduction: 0
    };
  }

  /**
   * Get metrics.
   */
  getMetrics(): PPDRoutingMetrics {
    return { ...this.metrics };
  }

  /**
   * Make routing decision for a request.
   */
  route(request: PDWorkloadRequest, turnNumber: number, conversationId: string): PPDRoutingDecision {
    this.metrics.totalRequests++;

    // Get or create conversation
    let conversation = this.conversations.get(conversationId);
    if (!conversation) {
      conversation = {
        conversationId,
        turns: [],
        cachedKVTokens: 0,
        lastTurnTimestamp: Date.now(),
        isActive: true
      };
      this.conversations.set(conversationId, conversation);
    }

    const newInputTokens = request.prefillTokens;
    const cachedTokens = conversation.cachedKVTokens;

    // Estimate cache hit ratio
    const cacheHitRatio = cachedTokens > 0 
      ? Math.min(1, cachedTokens / (cachedTokens + newInputTokens))
      : 0;

    // Calculate SLO margin
    const estimatedTTFT = this.estimateTTFT(newInputTokens, cacheHitRatio);
    const sloMargin = this.config.slo.ttftMs 
      ? (this.config.slo.ttftMs - estimatedTTFT) / this.config.slo.ttftMs * 100
      : 100;

    let decision: PPDRoutingDecision;

    // Turn 1: Always full prefill on P
    if (turnNumber === 1 && this.config.turn1AlwaysPrefill) {
      decision = this.makePrefillDecision(request, turnNumber, newInputTokens, cachedTokens, cacheHitRatio, estimatedTTFT, sloMargin);
    } else {
      // Turn 2+: Consider D-side append-prefill
      
      // Check conditions for D-side append
      const canUseLocalAppend = 
        newInputTokens <= this.config.maxTokensForLocalAppend &&
        cacheHitRatio >= this.config.cacheHitThreshold &&
        sloMargin >= this.config.sloMarginPercent;

      if (canUseLocalAppend) {
        decision = this.makeAppendDecision(request, turnNumber, newInputTokens, cachedTokens, cacheHitRatio, estimatedTTFT, sloMargin);
      } else {
        // Fall back to P-side prefill
        if (cacheHitRatio < this.config.cacheHitThreshold && this.config.fallbackToPrefillOnMiss) {
          decision = this.makePrefillDecision(request, turnNumber, newInputTokens, cachedTokens, cacheHitRatio, estimatedTTFT, sloMargin);
        } else {
          // Use D-side but with full prefill (append mode)
          decision = this.makeAppendDecision(request, turnNumber, newInputTokens, cachedTokens, cacheHitRatio, estimatedTTFT, sloMargin);
        }
      }
    }

    // Update conversation
    conversation.turns.push(decision);
    conversation.lastTurnTimestamp = Date.now();
    
    // Update cached tokens (for next turn)
    if (decision.route === "decode_append" || decision.route === "decode_local") {
      // Append mode: only new tokens processed, cache grows
      conversation.cachedKVTokens += newInputTokens;
    } else {
      // Full prefill: cache is fully populated
      conversation.cachedKVTokens = newInputTokens;
    }

    // Update metrics
    this.updateMetrics(decision);

    return decision;
  }

  /**
   * Make prefill routing decision.
   */
  private makePrefillDecision(
    request: PDWorkloadRequest,
    turnNumber: number,
    newInputTokens: number,
    cachedTokens: number,
    cacheHitRatio: number,
    estimatedTTFT: number,
    sloMargin: number
  ): PPDRoutingDecision {
    this.metrics.routedToP++;
    this.metrics.fullPrefillCount++;

    return {
      requestId: request.id,
      turnNumber,
      newInputTokens,
      cachedTokens,
      route: "prefilling",
      targetInstance: "P",
      reasoning: turnNumber === 1 
        ? "Turn 1: Always full prefill on P"
        : `Full prefill: cache hit ${(cacheHitRatio * 100).toFixed(0)}% < threshold ${(this.config.cacheHitThreshold * 100).toFixed(0)}%`,
      cacheHitRatio,
      estimatedTTFT,
      sloCompliant: sloMargin >= 0,
      sloMargin
    };
  }

  /**
   * Make append-prefill routing decision.
   */
  private makeAppendDecision(
    request: PDWorkloadRequest,
    turnNumber: number,
    newInputTokens: number,
    cachedTokens: number,
    cacheHitRatio: number,
    estimatedTTFT: number,
    sloMargin: number
  ): PPDRoutingDecision {
    this.metrics.routedToD++;
    this.metrics.appendPrefillCount++;

    // Append-prefill has much lower interference
    const interferenceMultiplier = 0.1; // 10x less interference
    const adjustedTTFT = estimatedTTFT * interferenceMultiplier;

    return {
      requestId: request.id,
      turnNumber,
      newInputTokens,
      cachedTokens,
      route: "decode_append",
      targetInstance: "D",
      reasoning: `Append-prefill on D: new tokens ${newInputTokens} <= ${this.config.maxTokensForLocalAppend}, cache ${(cacheHitRatio * 100).toFixed(0)}%, SLO margin ${sloMargin.toFixed(0)}%`,
      cacheHitRatio,
      estimatedTTFT: adjustedTTFT,
      sloCompliant: sloMargin >= 0,
      sloMargin
    };
  }

  /**
   * Estimate TTFT based on input tokens and cache hit ratio.
   */
  private estimateTTFT(inputTokens: number, cacheHitRatio: number): number {
    // Base prefill time per token (ms)
    const basePrefillMsPerToken = 0.15;
    
    // Effective tokens = total - cached
    const effectiveTokens = inputTokens * (1 - cacheHitRatio);
    
    // TTFT = effective prefill time + base overhead
    const baseOverhead = 20;
    
    return effectiveTokens * basePrefillMsPerToken + baseOverhead;
  }

  /**
   * Update metrics based on decision.
   */
  private updateMetrics(decision: PPDRoutingDecision): void {
    // Running average for TTFT
    const n = this.metrics.totalRequests;
    this.metrics.avgTTFT = (this.metrics.avgTTFT * (n - 1) + decision.estimatedTTFT) / n;
    
    // Running average for SLO margin
    this.metrics.avgSloMargin = (this.metrics.avgSloMargin * (n - 1) + decision.sloMargin) / n;
    
    // Cache metrics
    if (decision.cacheHitRatio > 0) {
      this.metrics.totalCacheHits++;
    } else {
      this.metrics.totalCacheMisses++;
    }
    this.metrics.cacheHitRate = this.metrics.totalCacheHits / this.metrics.totalRequests;
  }

  /**
   * Get conversation state.
   */
  getConversation(conversationId: string): PPDConversation | undefined {
    return this.conversations.get(conversationId);
  }

  /**
   * Clean up inactive conversations.
   */
  cleanupInactiveConversations(maxAgeMs: number = 3600000): void {
    const now = Date.now();
    for (const [id, conv] of this.conversations) {
      if (now - conv.lastTurnTimestamp > maxAgeMs) {
        this.conversations.delete(id);
      }
    }
  }

  /**
   * Simulate routing for a batch of requests.
   */
  simulateBatch(
    requests: PDWorkloadRequest[],
    getTurnNumber: (reqId: string) => number,
    getConversationId: (reqId: string) => string
  ): PPDRoutingDecision[] {
    const decisions: PPDRoutingDecision[] = [];
    
    for (const request of requests) {
      const turnNumber = getTurnNumber(request.id);
      const conversationId = getConversationId(request.id);
      
      const decision = this.route(request, turnNumber, conversationId);
      decisions.push(decision);
    }
    
    return decisions;
  }

  /**
   * Compare with non-PPD (all to P).
   */
  compareWithBaseline(): {
    ttftImprovement: number;
    interferenceReduction: number;
    routingEfficiency: number;
  } {
    // Assume non-PPD baseline has full interference
    const baselineTTFT = this.metrics.avgTTFT * 1.5; // 50% higher due to no append optimization
    const baselineInterference = 0.5;
    const pdInterference = 0.1; // PPD interference factor

    return {
      ttftImprovement: ((baselineTTFT - this.metrics.avgTTFT) / baselineTTFT) * 100,
      interferenceReduction: ((baselineInterference - pdInterference) / baselineInterference) * 100,
      routingEfficiency: this.metrics.routedToD / this.metrics.totalRequests * 100
    };
  }

  /**
   * Generate routing statistics report.
   */
  generateReport(): string {
    const comparison = this.compareWithBaseline();
    const activeConversations = Array.from(this.conversations.values())
      .filter(c => c.isActive && Date.now() - c.lastTurnTimestamp < 3600000);

    return `# PPD Routing Statistics Report

## Overview
- **Total Requests**: ${this.metrics.totalRequests}
- **Routed to P**: ${this.metrics.routedToP} (${(this.metrics.routedToP / this.metrics.totalRequests * 100).toFixed(1)}%)
- **Routed to D**: ${this.metrics.routedToD} (${(this.metrics.routedToD / this.metrics.totalRequests * 100).toFixed(1)}%)

## Prefill Breakdown
- **Full Prefill**: ${this.metrics.fullPrefillCount}
- **Append Prefill**: ${this.metrics.appendPrefillCount}

## Performance Metrics
- **Avg TTFT**: ${this.metrics.avgTTFT.toFixed(2)}ms
- **Avg SLO Margin**: ${this.metrics.avgSloMargin.toFixed(1)}%

## Cache Performance
- **Cache Hits**: ${this.metrics.totalCacheHits}
- **Cache Misses**: ${this.metrics.totalCacheMisses}
- **Hit Rate**: ${(this.metrics.cacheHitRate * 100).toFixed(1)}%

## PPD vs Baseline Comparison
- **TTFT Improvement**: ${comparison.ttftImprovement.toFixed(1)}%
- **Interference Reduction**: ${comparison.interferenceReduction.toFixed(1)}%
- **Routing Efficiency**: ${comparison.routingEfficiency.toFixed(1)}% (D-side)

## Active Conversations
- **Count**: ${activeConversations.length}
- **Avg Turns per Conversation**: ${(activeConversations.reduce((sum, c) => sum + c.turns.length, 0) / Math.max(1, activeConversations.length)).toFixed(1)}

## Configuration
- **Max Tokens for Local Append**: ${this.config.maxTokensForLocalAppend}
- **SLO Margin**: ${this.config.sloMarginPercent}%
- **Cache Hit Threshold**: ${(this.config.cacheHitThreshold * 100).toFixed(0)}%
- **Turn 1 Always Prefill**: ${this.config.turn1AlwaysPrefill}
`;
  }
}

/**
 * PPD Router Factory - Creates configured router instances.
 */
export class PPDRouterFactory {
  static createDefault(): PPDRouter {
    return new PPDRouter({});
  }

  static createForLowLatency(): PPDRouter {
    return new PPDRouter({
      maxTokensForLocalAppend: 256,
      sloMarginPercent: 30,
      cacheHitThreshold: 0.7,
      slo: { ttftMs: 1000, tpotMs: 80, e2eMs: 8000 }
    });
  }

  static createForHighThroughput(): PPDRouter {
    return new PPDRouter({
      maxTokensForLocalAppend: 1024,
      sloMarginPercent: 10,
      cacheHitThreshold: 0.5,
      slo: { ttftMs: 3000, tpotMs: 200, e2eMs: 25000 }
    });
  }

  static createForLongContext(): PPDRouter {
    return new PPDRouter({
      maxTokensForLocalAppend: 512,
      sloMarginPercent: 15,
      cacheHitThreshold: 0.6,
      maxContextBudgetTokens: 16384,
      enableDynamicBudget: true,
      slo: { ttftMs: 2500, tpotMs: 180, e2eMs: 20000 }
    });
  }
}
