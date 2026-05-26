/**
 * Context Budget Planner (Enhanced).
 * 
 * Intelligent context trimming and compression:
 * - Component importance scoring based on information entropy
 * - Perplexity-guided compression (high-probability tokens = low info = compressible)
 * - Dynamic budget allocation based on system state
 * 
 * Integrates with CacheAwarePromptBuilder for budget-aware prompt construction.
 */
import type { PromptComponent } from "./CacheAwarePromptBuilder.ts";
import { round } from "../utils/MathUtils.ts";

// ==================== Types ====================

export type ComponentPriority = {
  component: string;
  priority: number; // 0-1, higher = more important
  baseTokens: number;
  compressibleRatio: number; // 0-1, how much can be trimmed
  preservableRatio: number; // Token ratios that MUST be preserved
};

export type BudgetDecision = {
  component: string;
  originalTokens: number;
  allocatedTokens: number;
  compressionRatio: number;
  preservedTokens: number;
  preservedRatio: number;
  reason: string;
};

export type BudgetAllocation = {
  totalOriginalTokens: number;
  totalAllocatedTokens: number;
  decisions: BudgetDecision[];
  overallCompressionRatio: number;
  estimatedQualityRetention: number;
  criticalPreserved: boolean;
};

// Re-export shared SystemMetricsState type for backward compatibility
export type { SystemMetricsState } from "../scheduling/SchedulerInterface.ts";

/**
 * SystemState with sloUrgency (extends SystemMetricsState).
 * Used in ContextBudgetPlanner for compression decisions.
 */
export type SystemState = {
  gpuMemoryPressure: number; // 0-1, higher = more pressure
  concurrentRequests: number;
  sloUrgency: number; // 0-1, higher = more urgent
  avgPromptLength: number;
  cacheHitRate: number;
};

export type CompressionStrategy = "none" | "light" | "moderate" | "aggressive";

export interface ContextBudgetConfig {
  maxContextTokens: number;
  componentPriorities: ComponentPriority[];
  compressionStrategies: {
    light: number; // Target compression ratio
    moderate: number;
    aggressive: number;
  };
  preserveCriticalPatterns: RegExp[]; // Patterns that must be preserved
  enablePerplexityGuidance: boolean;
  perplexityThreshold: number; // Above this = high info = preserve
}

// ==================== Default Configuration ====================

const DEFAULT_COMPONENT_PRIORITIES: ComponentPriority[] = [
  { component: "system", priority: 1.0, baseTokens: 500, compressibleRatio: 0.1, preservableRatio: 0.9 },
  { component: "course_policy", priority: 0.95, baseTokens: 200, compressibleRatio: 0.15, preservableRatio: 0.85 },
  { component: "material_outline", priority: 0.6, baseTokens: 300, compressibleRatio: 0.4, preservableRatio: 0.6 },
  { component: "current_page", priority: 0.9, baseTokens: 1000, compressibleRatio: 0.3, preservableRatio: 0.7 },
  { component: "teacher_script", priority: 0.5, baseTokens: 800, compressibleRatio: 0.5, preservableRatio: 0.5 },
  { component: "neighbor_pages", priority: 0.3, baseTokens: 600, compressibleRatio: 0.7, preservableRatio: 0.3 },
  { component: "selected_evidence", priority: 0.85, baseTokens: 500, compressibleRatio: 0.25, preservableRatio: 0.75 },
  { component: "learner_profile", priority: 0.7, baseTokens: 300, compressibleRatio: 0.35, preservableRatio: 0.65 },
  { component: "chat_history", priority: 0.4, baseTokens: 400, compressibleRatio: 0.6, preservableRatio: 0.4 },
  { component: "question", priority: 0.98, baseTokens: 100, compressibleRatio: 0.05, preservableRatio: 0.95 },
  { component: "format_contract", priority: 0.55, baseTokens: 100, compressibleRatio: 0.2, preservableRatio: 0.8 }
];

const DEFAULT_CRITICAL_PATTERNS: RegExp[] = [
  /\d+[.,]\d+/, // Numbers (formulas, decimals)
  /\$\d+/, // Money values
  /[A-Z][a-z]+\d+/, // Technical terms with numbers (e.g., "Chapter 3")
  /eq\.\s*\d+/, // Equation references
  /\d+\s*(%|percent)/i, // Percentages
  /\b(definition|theorem|formula|law|principle)\b/i, // Key concepts
  /\b(important|critical|essential|must|required)\b/i // Critical markers
];

// ==================== Helper Functions ====================

function calculateTokenSelfInformation(
  token: string,
  tokenFrequency: number,
  totalTokens: number
): number {
  // P(token) = frequency / total
  const probability = tokenFrequency / Math.max(1, totalTokens);
  
  // I(token) = -log2(P(token)) = self-information in bits
  if (probability <= 0) return Infinity;
  return -Math.log2(probability);
}

function estimateTokenProbability(token: string, context: string[]): number {
  // Simple unigram probability estimate
  const tokenCount = context.filter(t => t === token).length;
  return (tokenCount + 1) / (context.length + 1); // Add-one smoothing
}

// ==================== ContextBudgetPlanner Class ====================

export class ContextBudgetPlanner {
  private config: ContextBudgetConfig;

  constructor(config: Partial<ContextBudgetConfig> = {}) {
    this.config = this.normalizeConfig(config);
  }

  private normalizeConfig(config: Partial<ContextBudgetConfig>): ContextBudgetConfig {
    return {
      maxContextTokens: config.maxContextTokens ?? 8000,
      componentPriorities: config.componentPriorities ?? DEFAULT_COMPONENT_PRIORITIES,
      compressionStrategies: config.compressionStrategies ?? {
        light: 0.9,
        moderate: 0.7,
        aggressive: 0.5
      },
      preserveCriticalPatterns: config.preserveCriticalPatterns ?? DEFAULT_CRITICAL_PATTERNS,
      enablePerplexityGuidance: config.enablePerplexityGuidance ?? true,
      perplexityThreshold: config.perplexityThreshold ?? 8.0
    };
  }

  /**
   * Calculate importance score for a component based on priority and system state.
   */
  calculateComponentImportance(
    component: string,
    systemState: SystemState
  ): number {
    const priority = this.config.componentPriorities.find(
      p => p.component === component
    );
    
    if (!priority) return 0.5;

    // Adjust priority based on system state
    let adjustedPriority = priority.priority;

    // High memory pressure -> prioritize high-value components more aggressively
    if (systemState.gpuMemoryPressure > 0.7) {
      adjustedPriority = Math.pow(adjustedPriority, 1.5);
    }

    // High SLO urgency -> protect critical components
    if (systemState.sloUrgency > 0.8) {
      if (priority.priority > 0.8) {
        adjustedPriority = Math.min(1, adjustedPriority * 1.1);
      }
    }

    // Low cache hit rate -> need to be more aggressive with compression
    if (systemState.cacheHitRate < 0.3) {
      adjustedPriority *= (1 - (1 - priority.priority) * 0.2);
    }

    return Math.min(1, adjustedPriority);
  }

  /**
   * Determine compression strategy based on system state.
   */
  determineCompressionStrategy(systemState: SystemState): CompressionStrategy {
    const { gpuMemoryPressure, sloUrgency, concurrentRequests } = systemState;

    // Calculate pressure score
    const pressureScore = 
      gpuMemoryPressure * 0.4 +
      (1 - sloUrgency) * 0.3 +
      Math.min(1, concurrentRequests / 10) * 0.3;

    if (pressureScore < 0.3) return "none";
    if (pressureScore < 0.5) return "light";
    if (pressureScore < 0.7) return "moderate";
    return "aggressive";
  }

  /**
   * Calculate perplexity-guided importance for tokens.
   * High perplexity (low probability) = high information = preserve
   * Low perplexity (high probability) = low information = compressible
   */
  calculatePerplexityGuidedImportance(
    text: string,
    baselineProbabilities: Map<string, number>
  ): Map<number, number> {
    const importance = new Map<number, number>();
    const tokens = text.split(/\s+/);
    
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const probability = baselineProbabilities.get(token) ?? 0.01;
      
      // Perplexity = 2^(-log2(probability))
      // High perplexity (low probability) = important
      const perplexity = -Math.log2(probability);
      const information = perplexity; // Self-information
      
      // Normalize: higher information = higher importance
      // Scale to 0-1 range
      const importanceScore = Math.min(1, information / this.config.perplexityThreshold);
      
      importance.set(i, importanceScore);
    }

    return importance;
  }

  /**
   * Identify critical tokens that must be preserved.
   */
  identifyCriticalTokens(text: string): Set<number> {
    const critical = new Set<number>();
    const tokens = text.split(/\s+/);
    
    for (const pattern of this.config.preserveCriticalPatterns) {
      for (let i = 0; i < tokens.length; i++) {
        if (pattern.test(tokens[i])) {
          critical.add(i);
          // Also mark neighbors for context
          if (i > 0) critical.add(i - 1);
          if (i < tokens.length - 1) critical.add(i + 1);
        }
      }
    }

    return critical;
  }

  /**
   * Allocate budget across components based on importance and available tokens.
   */
  allocateBudget(
    components: PromptComponent[],
    systemState: SystemState
  ): BudgetAllocation {
    const strategy = this.determineCompressionStrategy(systemState);
    const targetRatio = this.config.compressionStrategies[strategy];
    
    // Calculate total tokens
    const totalOriginalTokens = components.reduce(
      (sum, c) => sum + c.estimatedTokens, 
      0
    );
    
    // If within budget, no compression needed
    if (totalOriginalTokens <= this.config.maxContextTokens) {
      return {
        totalOriginalTokens,
        totalAllocatedTokens: totalOriginalTokens,
        decisions: components.map(c => ({
          component: c.name,
          originalTokens: c.estimatedTokens,
          allocatedTokens: c.estimatedTokens,
          compressionRatio: 1,
          preservedTokens: c.estimatedTokens,
          preservedRatio: 1,
          reason: "Within budget"
        })),
        overallCompressionRatio: 1,
        estimatedQualityRetention: 1,
        criticalPreserved: true
      };
    }

    // Calculate available budget
    const availableTokens = Math.floor(
      this.config.maxContextTokens * targetRatio
    );
    
    // Calculate importance scores for all components
    const componentScores = components.map(c => ({
      component: c,
      importance: this.calculateComponentImportance(c.name, systemState),
      priority: this.config.componentPriorities.find(p => p.component === c.name)
    }));

    // Sort by importance (highest first)
    componentScores.sort((a, b) => b.importance - a.importance);

    // Allocate budget based on importance
    const decisions: BudgetDecision[] = [];
    let remainingBudget = availableTokens;
    let totalAllocated = 0;

    for (const { component, importance, priority } of componentScores) {
      const baseTokens = component.estimatedTokens;
      const priorityConfig = priority ?? {
        compressibleRatio: 0.5,
        preservableRatio: 0.5
      };

      // Calculate minimum preserved tokens (based on priority)
      const minPreserved = Math.ceil(baseTokens * priorityConfig.preservableRatio);
      
      // Calculate maximum compressible tokens
      const maxCompressible = Math.floor(baseTokens * priorityConfig.compressibleRatio);
      
      // Calculate target allocation based on importance
      const importanceBudget = Math.ceil(
        availableTokens * (importance / componentScores.reduce((s, c) => s + c.importance, 0))
      );
      
      // Allocate between minPreserved and min(baseTokens, importanceBudget)
      const allocated = Math.max(
        minPreserved,
        Math.min(baseTokens, Math.min(importanceBudget, remainingBudget))
      );

      const compressedRatio = allocated / baseTokens;
      const preservedTokens = allocated;
      const preservedRatio = allocated / baseTokens;

      decisions.push({
        component: component.name,
        originalTokens: baseTokens,
        allocatedTokens: allocated,
        compressionRatio: compressedRatio,
        preservedTokens,
        preservedRatio,
        reason: this.generateDecisionReason(
          strategy,
          importance,
          priorityConfig,
          compressedRatio
        )
      });

      totalAllocated += allocated;
      remainingBudget -= allocated;
    }

    // Calculate quality retention estimate
    const weightedRetention = decisions.reduce((sum, d) => {
      const config = this.config.componentPriorities.find(p => p.component === d.component);
      const priority = config?.priority ?? 0.5;
      return sum + d.preservedRatio * priority;
    }, 0) / decisions.reduce((sum, d) => {
      const config = this.config.componentPriorities.find(p => p.component === d.component);
      return sum + (config?.priority ?? 0.5);
    }, 0);

    // Check if critical components are preserved
    const criticalPreserved = decisions
      .filter(d => {
        const config = this.config.componentPriorities.find(p => p.component === d.component);
        return (config?.priority ?? 0) > 0.8;
      })
      .every(d => d.preservedRatio >= 0.8);

    return {
      totalOriginalTokens,
      totalAllocatedTokens: totalAllocated,
      decisions,
      overallCompressionRatio: totalAllocated / totalOriginalTokens,
      estimatedQualityRetention: weightedRetention,
      criticalPreserved
    };
  }

  /**
   * Generate human-readable reason for budget decision.
   */
  private generateDecisionReason(
    strategy: CompressionStrategy,
    importance: number,
    priority: { compressibleRatio: number; preservableRatio: number },
    compressionRatio: number
  ): string {
    if (strategy === "none") {
      return "No compression needed";
    }

    if (importance > 0.8) {
      return compressionRatio >= 0.9 
        ? "High-priority component, minimal compression"
        : "High-priority component, essential preservation applied";
    }

    if (importance > 0.5) {
      return "Medium-priority component, moderate compression";
    }

    return `Low-priority component, ${strategy} compression applied`;
  }

  /**
   * Plan context trimming for a single component.
   */
  planComponentTrimming(
    text: string,
    targetTokens: number,
    preserveCritical: boolean = true
  ): { trimmed: string; tokens: number; preservedCritical: boolean } {
    const tokens = text.split(/\s+/);
    const criticalTokens = preserveCritical ? this.identifyCriticalTokens(text) : new Set<number>();
    
    if (tokens.length <= targetTokens) {
      return { trimmed: text, tokens: tokens.length, preservedCritical: true };
    }

    // Calculate importance for each token
    const tokenImportance = new Map<number, number>();
    const tokenFrequency = new Map<string, number>();
    
    // Count frequencies
    for (const token of tokens) {
      tokenFrequency.set(token, (tokenFrequency.get(token) ?? 0) + 1);
    }
    
    // Calculate importance
    for (let i = 0; i < tokens.length; i++) {
      if (criticalTokens.has(i)) {
        tokenImportance.set(i, 1.0);
      } else {
        const freq = tokenFrequency.get(tokens[i]) ?? 1;
        // Frequent tokens = lower importance
        tokenImportance.set(i, 1 / Math.log2(freq + 2));
      }
    }

    // Sort tokens by importance
    const sortedIndices = Array.from(tokenImportance.keys())
      .sort((a, b) => tokenImportance.get(b)! - tokenImportance.get(a)!);

    // Select top tokens to preserve
    const preservedIndices = new Set(sortedIndices.slice(0, targetTokens));
    
    // Ensure critical tokens are preserved
    for (const idx of criticalTokens) {
      preservedIndices.add(idx);
    }

    // Reconstruct text preserving order
    const preservedTokens: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (preservedIndices.has(i)) {
        preservedTokens.push(tokens[i]);
      }
    }

    // If still over budget, apply additional trimming
    let result = preservedTokens.join(" ");
    while (preservedTokens.length > targetTokens) {
      // Remove lowest importance non-critical tokens
      const toRemove = sortedIndices.find(
        i => preservedIndices.has(i) && !criticalTokens.has(i)
      );
      if (toRemove === undefined) break;
      
      preservedIndices.delete(toRemove);
      const idx = preservedTokens.indexOf(tokens[toRemove]);
      if (idx >= 0) {
        preservedTokens.splice(idx, 1);
      }
    }

    result = preservedTokens.join(" ");
    
    // Verify critical preservation
    const allCriticalPreserved = !preserveCritical || 
      Array.from(criticalTokens).every(idx => preservedIndices.has(idx));

    return {
      trimmed: result,
      tokens: preservedTokens.length,
      preservedCritical: allCriticalPreserved
    };
  }

  /**
   * Get budget suggestion based on system state.
   */
  getBudgetSuggestion(systemState: SystemState): {
    recommendedPolicy: "full" | "compressed" | "minimal";
    reason: string;
    expectedTokenReduction: number;
    risk: "low" | "medium" | "high";
  } {
    const strategy = this.determineCompressionStrategy(systemState);
    const reduction = 1 - this.config.compressionStrategies[strategy];

    let policy: "full" | "compressed" | "minimal";
    let risk: "low" | "medium" | "high";

    switch (strategy) {
      case "none":
        policy = "full";
        risk = "low";
        break;
      case "light":
        policy = "compressed";
        risk = "low";
        break;
      case "moderate":
        policy = "compressed";
        risk = "medium";
        break;
      case "aggressive":
        policy = "minimal";
        risk = "high";
        break;
    }

    const reason = this.generateSuggestionReason(systemState, strategy);

    return {
      recommendedPolicy: policy,
      reason,
      expectedTokenReduction: reduction,
      risk
    };
  }

  private generateSuggestionReason(
    systemState: SystemState,
    strategy: CompressionStrategy
  ): string {
    const factors: string[] = [];

    if (systemState.gpuMemoryPressure > 0.7) {
      factors.push("high GPU memory pressure");
    }
    if (systemState.concurrentRequests > 5) {
      factors.push("high concurrent load");
    }
    if (systemState.sloUrgency > 0.7) {
      factors.push("SLO urgency");
    }
    if (systemState.cacheHitRate < 0.5) {
      factors.push("low cache hit rate");
    }

    if (factors.length === 0) {
      return "System load is low, full context recommended";
    }

    const strategyText = {
      none: "maintaining",
      light: "light",
      moderate: "moderate",
      aggressive: "significant"
    }[strategy];

    return `Applying ${strategyText} compression due to ${factors.join(", ")}`;
  }

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<ContextBudgetConfig>): void {
    this.config = this.normalizeConfig({ ...this.config, ...config });
  }
}

// ==================== Factory Function ====================

export function createBudgetPlanner(
  config?: Partial<ContextBudgetConfig>
): ContextBudgetPlanner {
  return new ContextBudgetPlanner(config);
}
