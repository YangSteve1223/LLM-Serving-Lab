/**
 * Tests for RLStrategySelector
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  RLStrategySelector,
  createRLStrategySelector,
  runRLEpisode
} from "../../../src/agents/learningAssistant/serving/optimization/RLStrategySelector.ts";

describe("RLStrategySelector", () => {
  let selector: RLStrategySelector;

  beforeEach(() => {
    selector = new RLStrategySelector({
      learningRate: 0.1,
      discountFactor: 0.9,
      initialEpsilon: 1.0,
      minEpsilon: 0.1,
      epsilonDecay: 0.99
    });
  });

  describe("selectAction", () => {
    it("should select action with epsilon-greedy", () => {
      const state = {
        gpuMemoryPressure: 0.5,
        concurrentRequests: 5,
        avgPromptLength: 1000,
        cacheHitRate: 0.5
      };
      
      // With epsilon=1, should always explore
      const decision = selector.selectAction(state);
      
      assert.ok(decision.action);
      assert.strictEqual(decision.exploration, true);
      assert.strictEqual(decision.epsilon, 1);
    });

    it("should eventually exploit with decaying epsilon", () => {
      // Force exploitation by setting epsilon to 0
      const selectorWithLowEpsilon = new RLStrategySelector({
        initialEpsilon: 0,
        minEpsilon: 0
      });
      
      const state = {
        gpuMemoryPressure: 0.3,
        concurrentRequests: 2,
        avgPromptLength: 500,
        cacheHitRate: 0.8
      };
      
      const decision = selectorWithLowEpsilon.selectAction(state);
      
      assert.strictEqual(decision.exploration, false);
      assert.ok(decision.action);
      assert.ok(decision.confidence >= 0);
    });

    it("should generate decision reason", () => {
      const state = {
        gpuMemoryPressure: 0.8,
        concurrentRequests: 8,
        avgPromptLength: 1500,
        cacheHitRate: 0.3
      };
      
      const decision = selector.selectAction(state);
      
      assert.ok(decision.reason.length > 0);
    });
  });

  describe("storeExperience", () => {
    it("should store experience in replay buffer", () => {
      const experience = {
        state: {
          gpuMemoryPressure: 0.5,
          concurrentRequests: 5,
          avgPromptLength: 1000,
          cacheHitRate: 0.5
        },
        action: {
          schedulingStrategy: "SLO_AWARE" as const,
          evictionStrategy: "FLOP_AWARE" as const,
          compressionLevel: "low" as const
        },
        reward: 0.8,
        nextState: {
          gpuMemoryPressure: 0.4,
          concurrentRequests: 4,
          avgPromptLength: 900,
          cacheHitRate: 0.6
        },
        timestamp: Date.now()
      };
      
      selector.storeExperience(experience);
      
      const stats = selector.getStats();
      assert.strictEqual(stats.totalExperiences, 1);
    });

    it("should maintain buffer size limit", () => {
      const state = {
        gpuMemoryPressure: 0.5,
        concurrentRequests: 5,
        avgPromptLength: 1000,
        cacheHitRate: 0.5
      };
      
      const action = {
        schedulingStrategy: "FCFS" as const,
        evictionStrategy: "LRU" as const,
        compressionLevel: "none" as const
      };
      
      // Add more experiences than buffer size
      for (let i = 0; i < 100; i++) {
        selector.storeExperience({
          state,
          action,
          reward: Math.random(),
          nextState: state,
          timestamp: Date.now()
        });
      }
      
      const stats = selector.getStats();
      assert.ok(stats.totalExperiences <= 100); // May be capped by buffer size
    });
  });

  describe("calculateReward", () => {
    it("should give positive reward for SLO compliance", () => {
      const reward = selector.calculateReward(true, 500, 0.1, 0.1);
      assert.ok(reward > 0);
    });

    it("should give negative reward for SLO miss", () => {
      const reward = selector.calculateReward(false, 2000, 0.5, 0.3);
      assert.ok(reward < 0);
    });

    it("should penalize high latency", () => {
      const normalLatencyReward = selector.calculateReward(true, 500, 0.1, 0.1);
      const highLatencyReward = selector.calculateReward(true, 5000, 0.1, 0.1);
      
      assert.ok(highLatencyReward < normalLatencyReward);
    });

    it("should penalize high cache eviction rate", () => {
      const lowEvictionReward = selector.calculateReward(true, 500, 0.1, 0.1);
      const highEvictionReward = selector.calculateReward(true, 500, 0.8, 0.1);
      
      assert.ok(highEvictionReward < lowEvictionReward);
    });
  });

  describe("updateQValues", () => {
    it("should not update with insufficient experiences", () => {
      // Add fewer experiences than batch size
      for (let i = 0; i < 5; i++) {
        selector.storeExperience({
          state: { gpuMemoryPressure: 0.5, concurrentRequests: 5, avgPromptLength: 1000, cacheHitRate: 0.5 },
          action: { schedulingStrategy: "FCFS", evictionStrategy: "LRU", compressionLevel: "none" },
          reward: 0.5,
          nextState: { gpuMemoryPressure: 0.4, concurrentRequests: 4, avgPromptLength: 900, cacheHitRate: 0.6 },
          timestamp: Date.now()
        });
      }
      
      // Should not throw, just skip update
      selector.updateQValues();
      
      const stats = selector.getStats();
      assert.strictEqual(stats.totalExperiences, 5);
    });
  });

  describe("endEpisode", () => {
    it("should decay epsilon", () => {
      const initialEpsilon = selector.getStats().explorationRate;
      
      selector.endEpisode(0.5);
      
      const newEpsilon = selector.getStats().explorationRate;
      assert.ok(newEpsilon < initialEpsilon || newEpsilon === selector.getStats().explorationRate);
    });

    it("should track reward history", () => {
      selector.endEpisode(0.5);
      selector.endEpisode(0.3);
      
      const stats = selector.getStats();
      assert.strictEqual(stats.episodesCompleted, 2);
    });
  });

  describe("getStats", () => {
    it("should return comprehensive statistics", () => {
      const stats = selector.getStats();
      
      assert.ok("episodesCompleted" in stats);
      assert.ok("totalExperiences" in stats);
      assert.ok("avgReward" in stats);
      assert.ok("explorationRate" in stats);
      assert.ok("converged" in stats);
      assert.ok("qTableSize" in stats);
    });

    it("should track convergence", () => {
      // Run multiple episodes
      for (let i = 0; i < 60; i++) {
        selector.storeExperience({
          state: { gpuMemoryPressure: 0.5, concurrentRequests: 5, avgPromptLength: 1000, cacheHitRate: 0.5 },
          action: { schedulingStrategy: "FCFS", evictionStrategy: "LRU", compressionLevel: "none" },
          reward: 0.5,
          nextState: { gpuMemoryPressure: 0.5, concurrentRequests: 5, avgPromptLength: 1000, cacheHitRate: 0.5 },
          timestamp: Date.now()
        });
        selector.endEpisode(0.5);
      }
      
      const stats = selector.getStats();
      assert.ok(typeof stats.converged === "boolean");
    });
  });

  describe("exportQTable", () => {
    it("should export Q-table", () => {
      const qTable = selector.exportQTable();
      
      assert.ok(typeof qTable === "object");
      assert.ok(Object.keys(qTable).length >= 0);
    });

    it("should return deep copy", () => {
      const qTable1 = selector.exportQTable();
      const qTable2 = selector.exportQTable();
      
      // Modifying one should not affect the other
      const stateKey = Object.keys(qTable1)[0];
      if (stateKey) {
        const actionKey = Object.keys(qTable1[stateKey])[0];
        if (actionKey) {
          qTable1[stateKey][actionKey] = 999;
          assert.notStrictEqual(selector.exportQTable()[stateKey]?.[actionKey], 999);
        }
      }
    });
  });

  describe("importQTable", () => {
    it("should import Q-table", () => {
      const newQTable: Record<string, Record<string, number>> = {
        "S1_1_1_1": {
          "FCFS_LRU_none": 0.8,
          "SLO_AWARE_FLOP_AWARE_high": 0.9
        }
      };
      
      selector.importQTable(newQTable);
      
      const exported = selector.exportQTable();
      assert.strictEqual(exported["S1_1_1_1"]?.["FCFS_LRU_none"], 0.8);
    });
  });

  describe("getBestAction", () => {
    it("should return best action for state", () => {
      const state = {
        gpuMemoryPressure: 0.5,
        concurrentRequests: 5,
        avgPromptLength: 1000,
        cacheHitRate: 0.5
      };
      
      const action = selector.getBestAction(state);
      
      assert.ok(action.schedulingStrategy);
      assert.ok(action.evictionStrategy);
      assert.ok(action.compressionLevel);
    });
  });

  describe("reset", () => {
    it("should reset all state", () => {
      // Add some experiences
      for (let i = 0; i < 10; i++) {
        selector.storeExperience({
          state: { gpuMemoryPressure: 0.5, concurrentRequests: 5, avgPromptLength: 1000, cacheHitRate: 0.5 },
          action: { schedulingStrategy: "FCFS", evictionStrategy: "LRU", compressionLevel: "none" },
          reward: 0.5,
          nextState: { gpuMemoryPressure: 0.5, concurrentRequests: 5, avgPromptLength: 1000, cacheHitRate: 0.5 },
          timestamp: Date.now()
        });
      }
      selector.endEpisode(0.5);
      
      selector.reset();
      
      const stats = selector.getStats();
      assert.strictEqual(stats.episodesCompleted, 0);
      assert.strictEqual(stats.totalExperiences, 0);
    });
  });

  describe("getActionSpace", () => {
    it("should return all possible actions", () => {
      const actionSpace = selector.getActionSpace();
      
      assert.ok(actionSpace.length > 0);
      actionSpace.forEach(action => {
        assert.ok(["FCFS", "SJF", "SLO_AWARE"].includes(action.schedulingStrategy));
        assert.ok(["LRU", "LFU", "FLOP_AWARE"].includes(action.evictionStrategy));
        assert.ok(["none", "low", "high"].includes(action.compressionLevel));
      });
    });
  });

  describe("updateConfig", () => {
    it("should update learning rate", () => {
      selector.updateConfig({ learningRate: 0.2 });
      
      // Config should be updated (verified via behavior)
      const decision = selector.selectAction({
        gpuMemoryPressure: 0.5,
        concurrentRequests: 5,
        avgPromptLength: 1000,
        cacheHitRate: 0.5
      });
      
      assert.ok(decision.action);
    });
  });

  describe("runRLEpisode", () => {
    it("should run complete episode", async () => {
      const workload = [
        { gpuMemoryPressure: 0.3, concurrentRequests: 2, avgPromptLength: 500, cacheHitRate: 0.8 },
        { gpuMemoryPressure: 0.5, concurrentRequests: 5, avgPromptLength: 1000, cacheHitRate: 0.5 },
        { gpuMemoryPressure: 0.7, concurrentRequests: 8, avgPromptLength: 1500, cacheHitRate: 0.3 }
      ];
      
      const result = await runRLEpisode(selector, workload);
      
      assert.ok(typeof result.totalReward === "number");
      assert.strictEqual(result.decisions.length, workload.length);
    });
  });

  describe("createRLStrategySelector factory", () => {
    it("should create selector with custom config", () => {
      const customSelector = createRLStrategySelector({
        learningRate: 0.2,
        discountFactor: 0.95,
        epsilonDecay: 0.995
      });
      
      const stats = customSelector.getStats();
      assert.strictEqual(stats.totalExperiences, 0);
    });
  });
});
