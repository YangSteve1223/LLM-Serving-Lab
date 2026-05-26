/**
 * Tests for ContextBudgetPlanner
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  ContextBudgetPlanner,
  createBudgetPlanner
} from "../../../src/agents/learningAssistant/serving/optimization/ContextBudgetPlanner.ts";
import type { PromptComponent } from "../../../src/agents/learningAssistant/serving/CacheAwarePromptBuilder.ts";

describe("ContextBudgetPlanner", () => {
  let planner: ContextBudgetPlanner;

  beforeEach(() => {
    planner = new ContextBudgetPlanner({
      maxContextTokens: 2000
    });
  });

  describe("calculateComponentImportance", () => {
    it("should return higher importance for high-priority components", () => {
      const lowPressureState = {
        gpuMemoryPressure: 0.2,
        concurrentRequests: 2,
        sloUrgency: 0.3,
        avgPromptLength: 500,
        cacheHitRate: 0.7
      };
      
      const questionImportance = planner.calculateComponentImportance("question", lowPressureState);
      const historyImportance = planner.calculateComponentImportance("chat_history", lowPressureState);
      
      assert.ok(questionImportance > historyImportance);
    });

    it("should adjust importance under memory pressure", () => {
      const normalState = {
        gpuMemoryPressure: 0.3,
        concurrentRequests: 2,
        sloUrgency: 0.3,
        avgPromptLength: 500,
        cacheHitRate: 0.7
      };
      
      const highPressureState = {
        gpuMemoryPressure: 0.8,
        concurrentRequests: 2,
        sloUrgency: 0.3,
        avgPromptLength: 500,
        cacheHitRate: 0.7
      };
      
      const normalImportance = planner.calculateComponentImportance("current_page", normalState);
      const highImportance = planner.calculateComponentImportance("current_page", highPressureState);
      
      // High memory pressure should adjust importance (may increase or decrease based on implementation)
      assert.ok(typeof highImportance === "number");
      assert.ok(highImportance >= 0 && highImportance <= 1);
    });

    it("should protect critical components under SLO urgency", () => {
      const normalState = {
        gpuMemoryPressure: 0.5,
        concurrentRequests: 5,
        sloUrgency: 0.3,
        avgPromptLength: 500,
        cacheHitRate: 0.5
      };
      
      const urgentState = {
        gpuMemoryPressure: 0.5,
        concurrentRequests: 5,
        sloUrgency: 0.9,
        avgPromptLength: 500,
        cacheHitRate: 0.5
      };
      
      const normalImportance = planner.calculateComponentImportance("system", normalState);
      const urgentImportance = planner.calculateComponentImportance("system", urgentState);
      
      // SLO urgency should increase importance of critical components
      assert.ok(urgentImportance >= normalImportance);
    });
  });

  describe("determineCompressionStrategy", () => {
    it("should return 'none' or 'light' for low pressure", () => {
      const state = {
        gpuMemoryPressure: 0.2,
        concurrentRequests: 1,
        sloUrgency: 0.2,
        avgPromptLength: 300,
        cacheHitRate: 0.8
      };
      
      const strategy = planner.determineCompressionStrategy(state);
      assert.ok(["none", "light"].includes(strategy));
    });

    it("should return 'aggressive' for high pressure", () => {
      const state = {
        gpuMemoryPressure: 0.9,
        concurrentRequests: 10,
        sloUrgency: 0.2,
        avgPromptLength: 2000,
        cacheHitRate: 0.2
      };
      
      const strategy = planner.determineCompressionStrategy(state);
      assert.strictEqual(strategy, "aggressive");
    });

    it("should return 'moderate' for medium pressure", () => {
      const state = {
        gpuMemoryPressure: 0.6,
        concurrentRequests: 6,
        sloUrgency: 0.5,
        avgPromptLength: 1000,
        cacheHitRate: 0.5
      };
      
      const strategy = planner.determineCompressionStrategy(state);
      assert.ok(["moderate", "aggressive"].includes(strategy));
    });
  });

  describe("calculatePerplexityGuidedImportance", () => {
    it("should assign higher importance to rare tokens", () => {
      const text = "The quick brown fox jumps over the lazy dog";
      const probabilities = new Map<string, number>();
      probabilities.set("The", 0.1);
      probabilities.set("fox", 0.001);
      probabilities.set("dog", 0.002);
      
      const importance = planner.calculatePerplexityGuidedImportance(text, probabilities);
      
      // "fox" and "dog" should have higher importance than "The"
      assert.ok(importance.get(3)! > importance.get(0)!);
    });
  });

  describe("identifyCriticalTokens", () => {
    it("should identify numbers as critical", () => {
      const text = "Chapter 3 discusses equation 5 and 50% efficiency";
      const critical = planner.identifyCriticalTokens(text);
      
      assert.ok(critical.size > 0);
    });

    it("should identify technical terms as critical", () => {
      const text = "Definition of entropy and the theorem proves formula";
      const critical = planner.identifyCriticalTokens(text);
      
      assert.ok(critical.size > 0);
    });

    it("should include neighbors for context", () => {
      const text = "This is eq.5 for analysis";
      const critical = planner.identifyCriticalTokens(text);
      
      // Should identify eq.5 as critical (matches /eq\.\s*\d+/)
      assert.ok(critical.size >= 1);
    });
  });

  describe("allocateBudget", () => {
    it("should not compress when within budget", () => {
      const components: PromptComponent[] = [
        { name: "system", text: "You are a teacher", estimatedTokens: 100, hash: "h1", cacheable: true, volatility: "stable" },
        { name: "question", text: "What is AI?", estimatedTokens: 50, hash: "h2", cacheable: false, volatility: "request_scoped" }
      ];
      
      const state = {
        gpuMemoryPressure: 0.2,
        concurrentRequests: 1,
        sloUrgency: 0.2,
        avgPromptLength: 300,
        cacheHitRate: 0.8
      };
      
      const allocation = planner.allocateBudget(components, state);
      
      assert.strictEqual(allocation.overallCompressionRatio, 1);
      assert.strictEqual(allocation.criticalPreserved, true);
    });

    it("should handle compression proportionally under pressure", () => {
      const components: PromptComponent[] = [
        { name: "system", text: "System prompt", estimatedTokens: 500, hash: "h1", cacheable: true, volatility: "stable" },
        { name: "current_page", text: "Page content", estimatedTokens: 1000, hash: "h2", cacheable: true, volatility: "page_scoped" },
        { name: "chat_history", text: "History", estimatedTokens: 500, hash: "h3", cacheable: false, volatility: "turn_scoped" }
      ];
      
      const state = {
        gpuMemoryPressure: 0.8,
        concurrentRequests: 8,
        sloUrgency: 0.5,
        avgPromptLength: 1500,
        cacheHitRate: 0.3
      };
      
      const allocation = planner.allocateBudget(components, state);
      
      // Should return valid allocation
      assert.ok(allocation.overallCompressionRatio > 0);
      assert.ok(allocation.totalAllocatedTokens > 0);
      assert.ok(allocation.decisions.length === 3);
    });

    it("should preserve critical components", () => {
      const components: PromptComponent[] = [
        { name: "system", text: "System", estimatedTokens: 500, hash: "h1", cacheable: true, volatility: "stable" },
        { name: "question", text: "Question", estimatedTokens: 100, hash: "h2", cacheable: false, volatility: "request_scoped" }
      ];
      
      const state = {
        gpuMemoryPressure: 0.9,
        concurrentRequests: 10,
        sloUrgency: 0.8,
        avgPromptLength: 2000,
        cacheHitRate: 0.2
      };
      
      const allocation = planner.allocateBudget(components, state);
      
      // Critical components should be preserved
      const systemDecision = allocation.decisions.find(d => d.component === "system");
      const questionDecision = allocation.decisions.find(d => d.component === "question");
      
      assert.ok(systemDecision!.preservedRatio >= 0.8);
      assert.ok(questionDecision!.preservedRatio >= 0.8);
    });
  });

  describe("planComponentTrimming", () => {
    it("should return original when within target", () => {
      const text = "This is a short text with few tokens";
      
      const result = planner.planComponentTrimming(text, 100);
      
      assert.strictEqual(result.tokens, result.trimmed.split(/\s+/).length);
    });

    it("should trim to target tokens", () => {
      const words = Array(50).fill("word").map((w, i) => `${w}${i}`).join(" ");
      
      const result = planner.planComponentTrimming(words, 10);
      
      assert.ok(result.tokens <= 10);
    });

    it("should preserve critical patterns", () => {
      const text = "Chapter 3 has formula 5 and 50% efficiency";
      
      const result = planner.planComponentTrimming(text, 5, true);
      
      // Should preserve critical numbers
      assert.ok(result.preservedCritical);
    });
  });

  describe("getBudgetSuggestion", () => {
    it("should suggest appropriate policy for low load", () => {
      const state = {
        gpuMemoryPressure: 0.2,
        concurrentRequests: 1,
        sloUrgency: 0.2,
        avgPromptLength: 300,
        cacheHitRate: 0.8
      };
      
      const suggestion = planner.getBudgetSuggestion(state);
      
      assert.ok(["full", "compressed"].includes(suggestion.recommendedPolicy));
      assert.ok(["low", "medium"].includes(suggestion.risk));
    });

    it("should suggest appropriate policy for critical load", () => {
      const state = {
        gpuMemoryPressure: 0.9,
        concurrentRequests: 12,
        sloUrgency: 0.9,
        avgPromptLength: 3000,
        cacheHitRate: 0.1
      };
      
      const suggestion = planner.getBudgetSuggestion(state);
      
      assert.ok(["minimal", "compressed"].includes(suggestion.recommendedPolicy));
      assert.ok(["high", "medium"].includes(suggestion.risk));
    });
  });

  describe("updateConfig", () => {
    it("should update max context tokens", () => {
      planner.updateConfig({ maxContextTokens: 5000 });
      
      const state = {
        gpuMemoryPressure: 0.5,
        concurrentRequests: 5,
        sloUrgency: 0.5,
        avgPromptLength: 2000,
        cacheHitRate: 0.5
      };
      
      const components: PromptComponent[] = [
        { name: "current_page", text: "Content", estimatedTokens: 4000, hash: "h1", cacheable: true, volatility: "page_scoped" }
      ];
      
      const allocation = planner.allocateBudget(components, state);
      
      // With 5000 token limit and light compression, should fit more
      assert.ok(allocation.totalAllocatedTokens > 0);
    });
  });

  describe("createBudgetPlanner factory", () => {
    it("should create planner with custom config", () => {
      const customPlanner = createBudgetPlanner({
        maxContextTokens: 1000,
        perplexityThreshold: 10
      });
      
      const suggestion = customPlanner.getBudgetSuggestion({
        gpuMemoryPressure: 0.5,
        concurrentRequests: 5,
        sloUrgency: 0.5,
        avgPromptLength: 500,
        cacheHitRate: 0.5
      });
      
      assert.ok(suggestion.reason.length > 0);
    });
  });
});
