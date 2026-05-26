/**
 * RL Strategy Selector.
 * 
 * Implements a simplified Q-learning based strategy selector:
 * - State space: GPU memory pressure, concurrent requests, prompt length, cache hit rate
 * - Action space: scheduling strategy, eviction strategy, compression level
 * - Q-table for state-action value estimation
 * - Epsilon-greedy exploration
 * 
 * Integrates with CacheExperimentRunner for comparative evaluation.
 */
import type { EvictionStrategy } from "../cache/RadixPrefixCacheManager.ts";
import { DeterministicRandom } from "../utils/DeterministicRandom.ts";
import { round } from "../utils/MathUtils.ts";

// ==================== Types ====================

export type SchedulingStrategy = "FCFS" | "SJF" | "SLO_AWARE";
export type CompressionLevel = "none" | "low" | "high";

// Re-export shared SystemMetricsState type for backward compatibility
export type { SystemMetricsState } from "../scheduling/SchedulerInterface.ts";

/**
 * SystemState for RL strategy selection (without sloUrgency).
 * Uses the shared SystemMetricsState interface.
 */
export interface SystemState {
  gpuMemoryPressure: number; // 0-1
  concurrentRequests: number;
  avgPromptLength: number; // tokens
  cacheHitRate: number; // 0-1
}

export type Action = {
  schedulingStrategy: SchedulingStrategy;
  evictionStrategy: EvictionStrategy;
  compressionLevel: CompressionLevel;
};

export interface QTable {
  [stateKey: string]: {
    [actionKey: string]: number;
  };
}

export interface LearningExperience {
  state: SystemState;
  action: Action;
  reward: number;
  nextState: SystemState;
  timestamp: number;
}

export interface RLStrategyStats {
  episodesCompleted: number;
  totalExperiences: number;
  avgReward: number;
  explorationRate: number;
  converged: boolean;
  qTableSize: number;
}

export interface StrategyDecision {
  action: Action;
  exploration: boolean;
  epsilon: number;
  confidence: number; // 0-1, how certain about this action
  reason: string;
}

export interface RLConfig {
  learningRate: number; // Alpha
  discountFactor: number; // Gamma
  initialEpsilon: number;
  minEpsilon: number;
  epsilonDecay: number;
  batchSize: number;
  replayBufferSize: number;
  targetUpdateFrequency: number;
}

// ==================== Constants ====================

const DEFAULT_RL_CONFIG: RLConfig = {
  learningRate: 0.1,
  discountFactor: 0.9,
  initialEpsilon: 1.0,
  minEpsilon: 0.1,
  epsilonDecay: 0.995,
  batchSize: 32,
  replayBufferSize: 1000,
  targetUpdateFrequency: 10
};

const ACTION_SPACE: Action[] = [
  { schedulingStrategy: "FCFS", evictionStrategy: "LRU", compressionLevel: "none" },
  { schedulingStrategy: "FCFS", evictionStrategy: "LFU", compressionLevel: "none" },
  { schedulingStrategy: "FCFS", evictionStrategy: "FLOP_AWARE", compressionLevel: "none" },
  { schedulingStrategy: "FCFS", evictionStrategy: "LRU", compressionLevel: "low" },
  { schedulingStrategy: "FCFS", evictionStrategy: "LRU", compressionLevel: "high" },
  { schedulingStrategy: "SJF", evictionStrategy: "LRU", compressionLevel: "none" },
  { schedulingStrategy: "SJF", evictionStrategy: "FLOP_AWARE", compressionLevel: "low" },
  { schedulingStrategy: "SLO_AWARE", evictionStrategy: "LRU", compressionLevel: "none" },
  { schedulingStrategy: "SLO_AWARE", evictionStrategy: "FLOP_AWARE", compressionLevel: "low" },
  { schedulingStrategy: "SLO_AWARE", evictionStrategy: "FLOP_AWARE", compressionLevel: "high" }
];

// State binning for Q-table discretization
const STATE_BINS = {
  gpuMemoryPressure: [0, 0.3, 0.6, 0.9, 1.0],
  concurrentRequests: [0, 2, 5, 10, Infinity],
  avgPromptLength: [0, 500, 1000, 2000, Infinity],
  cacheHitRate: [0, 0.2, 0.4, 0.6, 1.0]
};

// ==================== Helper Functions ====================

function discretizeState(state: SystemState): string {
  const bins = STATE_BINS;
  
  const gpuBin = bins.gpuMemoryPressure.findIndex(
    (b, i) => state.gpuMemoryPressure >= b && 
              (i === bins.gpuMemoryPressure.length - 1 || state.gpuMemoryPressure < bins.gpuMemoryPressure[i + 1])
  );
  
  const concurrentBin = bins.concurrentRequests.findIndex(
    (b, i) => state.concurrentRequests >= b && 
              (i === bins.concurrentRequests.length - 1 || state.concurrentRequests < bins.concurrentRequests[i + 1])
  );
  
  const promptBin = bins.avgPromptLength.findIndex(
    (b, i) => state.avgPromptLength >= b && 
              (i === bins.avgPromptLength.length - 1 || state.avgPromptLength < bins.avgPromptLength[i + 1])
  );
  
  const cacheBin = bins.cacheHitRate.findIndex(
    (b, i) => state.cacheHitRate >= b && 
              (i === bins.cacheHitRate.length - 1 || state.cacheHitRate < bins.cacheHitRate[i + 1])
  );
  
  return `S${gpuBin}_${concurrentBin}_${promptBin}_${cacheBin}`;
}

function actionToKey(action: Action): string {
  return `${action.schedulingStrategy}_${action.evictionStrategy}_${action.compressionLevel}`;
}

function keyToAction(key: string): Action {
  const [schedulingStrategy, evictionStrategy, compressionLevel] = key.split("_");
  return {
    schedulingStrategy: schedulingStrategy as SchedulingStrategy,
    evictionStrategy: evictionStrategy as EvictionStrategy,
    compressionLevel: compressionLevel as CompressionLevel
  };
}

// ==================== RLStrategySelector Class ====================

export class RLStrategySelector {
  private config: RLConfig;
  private qTable: QTable;
  private targetQTable: QTable;
  private replayBuffer: LearningExperience[];
  private epsilon: number;
  private episodeCount: number;
  private totalExperiences: number;
  private rewardHistory: number[];
  private rng: DeterministicRandom;

  constructor(config: Partial<RLConfig> = {}, seed?: number) {
    this.config = this.normalizeConfig(config);
    this.qTable = {};
    this.targetQTable = {};
    this.replayBuffer = [];
    this.epsilon = this.config.initialEpsilon;
    this.episodeCount = 0;
    this.totalExperiences = 0;
    this.rewardHistory = [];
    this.rng = new DeterministicRandom(seed ?? 42);
    
    // Initialize Q-table with action space
    this.initializeQTable();
  }

  private normalizeConfig(config: Partial<RLConfig>): RLConfig {
    return {
      learningRate: config.learningRate ?? DEFAULT_RL_CONFIG.learningRate,
      discountFactor: config.discountFactor ?? DEFAULT_RL_CONFIG.discountFactor,
      initialEpsilon: config.initialEpsilon ?? DEFAULT_RL_CONFIG.initialEpsilon,
      minEpsilon: config.minEpsilon ?? DEFAULT_RL_CONFIG.minEpsilon,
      epsilonDecay: config.epsilonDecay ?? DEFAULT_RL_CONFIG.epsilonDecay,
      batchSize: config.batchSize ?? DEFAULT_RL_CONFIG.batchSize,
      replayBufferSize: config.replayBufferSize ?? DEFAULT_RL_CONFIG.replayBufferSize,
      targetUpdateFrequency: config.targetUpdateFrequency ?? DEFAULT_RL_CONFIG.targetUpdateFrequency
    };
  }

  private initializeQTable(): void {
    // Initialize all state-action pairs with zero values
    // In practice, would initialize based on prior knowledge
    const states = [
      "S0_0_0_0", "S0_0_0_1", "S0_0_0_2", "S0_0_0_3", "S0_0_0_4",
      "S0_0_1_0", "S0_0_1_1", "S0_0_1_2", "S0_0_1_3", "S0_0_1_4",
      "S1_0_0_0", "S1_0_0_1", "S1_0_0_2", "S1_0_0_3", "S1_0_0_4",
      "S2_1_1_1", "S2_1_1_2", "S2_1_1_3",
      "S3_2_2_2", "S3_2_2_3", "S3_2_2_4",
      "S4_3_3_3", "S4_3_3_4"
    ];
    
    for (const state of states) {
      this.qTable[state] = {};
      this.targetQTable[state] = {};
      
      for (const action of ACTION_SPACE) {
        const actionKey = actionToKey(action);
        // Initialize with optimistic values to encourage exploration
        this.qTable[state][actionKey] = 0.5;
        this.targetQTable[state][actionKey] = 0.5;
      }
    }
  }

  /**
   * Select action using epsilon-greedy strategy.
   */
  selectAction(state: SystemState): StrategyDecision {
    const stateKey = discretizeState(state);
    
    // Ensure state exists in Q-table
    if (!this.qTable[stateKey]) {
      this.qTable[stateKey] = {};
      for (const action of ACTION_SPACE) {
        const actionKey = actionToKey(action);
        this.qTable[stateKey][actionKey] = 0.5;
      }
    }
    
    // Exploration: random action
    if (this.rng.random() < this.epsilon) {
      const randomAction = ACTION_SPACE[this.rng.randomInt(0, ACTION_SPACE.length - 1)];
      return {
        action: randomAction,
        exploration: true,
        epsilon: this.epsilon,
        confidence: 0, // No confidence when exploring
        reason: `Exploring (ε=${round(this.epsilon, 3)})`
      };
    }
    
    // Exploitation: best known action
    let bestAction = ACTION_SPACE[0];
    let bestValue = this.qTable[stateKey][actionToKey(bestAction)] ?? -Infinity;
    let totalValue = 0;
    let count = 0;
    
    for (const action of ACTION_SPACE) {
      const actionKey = actionToKey(action);
      const value = this.qTable[stateKey][actionKey] ?? 0;
      totalValue += value;
      count++;
      
      if (value > bestValue) {
        bestValue = value;
        bestAction = action;
      }
    }
    
    // Calculate confidence based on value spread
    const avgValue = totalValue / count;
    const valueVariance = Math.abs(bestValue - avgValue);
    const confidence = Math.min(1, valueVariance * 2);
    
    return {
      action: bestAction,
      exploration: false,
      epsilon: this.epsilon,
      confidence: round(confidence, 3),
      reason: this.generateDecisionReason(bestAction, state, bestValue)
    };
  }

  /**
   * Generate human-readable decision reason.
   */
  private generateDecisionReason(action: Action, state: SystemState, value: number): string {
    const reasons: string[] = [];
    
    if (action.schedulingStrategy === "SLO_AWARE" && state.concurrentRequests > 5) {
      reasons.push("high concurrency → SLO-aware scheduling");
    }
    if (action.schedulingStrategy === "SJF" && state.avgPromptLength < 500) {
      reasons.push("short prompts → SJF for low latency");
    }
    if (action.evictionStrategy === "FLOP_AWARE" && state.cacheHitRate > 0.5) {
      reasons.push("high cache → FLOP-aware eviction");
    }
    if (action.compressionLevel === "high" && state.gpuMemoryPressure > 0.7) {
      reasons.push("memory pressure → aggressive compression");
    }
    if (action.compressionLevel === "none" && state.gpuMemoryPressure < 0.3) {
      reasons.push("low memory → no compression");
    }
    
    if (reasons.length === 0) {
      reasons.push(`optimal strategy selected (Q-value: ${round(value, 3)})`);
    }
    
    return reasons.join("; ");
  }

  /**
   * Store experience in replay buffer.
   */
  storeExperience(experience: LearningExperience): void {
    this.replayBuffer.push(experience);
    
    // Maintain buffer size
    if (this.replayBuffer.length > this.config.replayBufferSize) {
      this.replayBuffer.shift();
    }
    
    this.totalExperiences++;
  }

  /**
   * Calculate reward based on system metrics.
   */
  calculateReward(
    sloMet: boolean,
    avgLatencyMs: number,
    cacheEvictionRate: number,
    resourceWaste: number
  ): number {
    let reward = 0;
    
    // Primary objective: SLO compliance
    if (sloMet) {
      reward += 1.0;
    } else {
      reward -= 2.0;
    }
    
    // Latency penalty
    if (avgLatencyMs > 1000) {
      reward -= 0.5 * Math.log10(avgLatencyMs / 1000);
    }
    
    // Cache eviction penalty
    reward -= cacheEvictionRate * 0.3;
    
    // Resource waste penalty
    reward -= resourceWaste * 0.5;
    
    return round(reward, 3);
  }

  /**
   * Update Q-values using experience replay.
   */
  updateQValues(): void {
    if (this.replayBuffer.length < this.config.batchSize) {
      return;
    }
    
    // Sample random batch
    const batch: LearningExperience[] = [];
    const indices = new Set<number>();
    
    while (indices.size < this.config.batchSize) {
      const idx = this.rng.randomInt(0, this.replayBuffer.length - 1);
      indices.add(idx);
    }
    
    for (const idx of indices) {
      batch.push(this.replayBuffer[idx]);
    }
    
    // Update Q-values
    for (const exp of batch) {
      const stateKey = discretizeState(exp.state);
      const nextStateKey = discretizeState(exp.nextState);
      const actionKey = actionToKey(exp.action);
      
      // Ensure states exist
      if (!this.qTable[nextStateKey]) {
        this.qTable[nextStateKey] = {};
        for (const action of ACTION_SPACE) {
          this.qTable[nextStateKey][actionToKey(action)] = 0.5;
        }
      }
      
      // Calculate max Q-value for next state
      let maxNextQ = -Infinity;
      for (const action of ACTION_SPACE) {
        const key = actionToKey(action);
        const value = this.qTable[nextStateKey][key] ?? 0;
        maxNextQ = Math.max(maxNextQ, value);
      }
      
      // Q-learning update: Q(s,a) ← Q(s,a) + α[r + γ*max(Q(s',a')) - Q(s,a)]
      const currentQ = this.qTable[stateKey][actionKey] ?? 0;
      const target = exp.reward + this.config.discountFactor * maxNextQ;
      const newQ = currentQ + this.config.learningRate * (target - currentQ);
      
      this.qTable[stateKey][actionKey] = round(newQ, 4);
    }
    
    // Update target network periodically
    if (this.episodeCount % this.config.targetUpdateFrequency === 0) {
      this.targetQTable = JSON.parse(JSON.stringify(this.qTable));
    }
  }

  /**
   * End of episode: decay epsilon.
   */
  endEpisode(totalReward: number): void {
    this.episodeCount++;
    this.rewardHistory.push(totalReward);
    
    // Decay epsilon
    this.epsilon = Math.max(
      this.config.minEpsilon,
      this.epsilon * this.config.epsilonDecay
    );
    
    // Update Q-values with replay
    this.updateQValues();
  }

  /**
   * Get statistics about the learning process.
   */
  getStats(): RLStrategyStats {
    const avgReward = this.rewardHistory.length > 0
      ? this.rewardHistory.reduce((a, b) => a + b, 0) / this.rewardHistory.length
      : 0;
    
    // Check convergence (variance of recent rewards)
    const recentWindow = Math.min(10, this.rewardHistory.length);
    const recentRewards = this.rewardHistory.slice(-recentWindow);
    const variance = recentRewards.length > 1
      ? recentRewards.reduce((sum, r) => sum + Math.pow(r - avgReward, 2), 0) / recentRewards.length
      : 0;
    const converged = variance < 0.1 && this.episodeCount > 50;
    
    // Count Q-table size
    let qTableSize = 0;
    for (const state in this.qTable) {
      for (const action in this.qTable[state]) {
        if (this.qTable[state][action] !== 0) {
          qTableSize++;
        }
      }
    }
    
    return {
      episodesCompleted: this.episodeCount,
      totalExperiences: this.totalExperiences,
      avgReward: round(avgReward, 3),
      explorationRate: round(this.epsilon, 3),
      converged,
      qTableSize
    };
  }

  /**
   * Export Q-table for inspection or persistence.
   */
  exportQTable(): QTable {
    return JSON.parse(JSON.stringify(this.qTable));
  }

  /**
   * Import Q-table.
   */
  importQTable(table: QTable): void {
    this.qTable = JSON.parse(JSON.stringify(table));
  }

  /**
   * Get best action for a given state (without exploration).
   */
  getBestAction(state: SystemState): Action {
    const stateKey = discretizeState(state);
    
    if (!this.qTable[stateKey]) {
      return ACTION_SPACE[0];
    }
    
    let bestAction = ACTION_SPACE[0];
    let bestValue = this.qTable[stateKey][actionToKey(bestAction)] ?? -Infinity;
    
    for (const action of ACTION_SPACE) {
      const actionKey = actionToKey(action);
      const value = this.qTable[stateKey][actionKey] ?? 0;
      
      if (value > bestValue) {
        bestValue = value;
        bestAction = action;
      }
    }
    
    return bestAction;
  }

  /**
   * Reset Q-table (start fresh learning).
   */
  reset(): void {
    this.qTable = {};
    this.targetQTable = {};
    this.replayBuffer = [];
    this.epsilon = this.config.initialEpsilon;
    this.episodeCount = 0;
    this.totalExperiences = 0;
    this.rewardHistory = [];
    this.initializeQTable();
  }

  /**
   * Get action space for reference.
   */
  getActionSpace(): Action[] {
    return [...ACTION_SPACE];
  }

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<RLConfig>): void {
    this.config = this.normalizeConfig({ ...this.config, ...config });
  }
}

// ==================== Factory Function ====================

export function createRLStrategySelector(
  config?: Partial<RLConfig>
): RLStrategySelector {
  return new RLStrategySelector(config);
}

// ==================== RL Integration Helper ====================

export interface RLIntegrationCallbacks {
  onDecision: (state: SystemState, action: Action) => void;
  onExperience: (experience: LearningExperience) => void;
  onEpisodeEnd: (totalReward: number) => void;
}

/**
 * Run an RL episode with the given workload.
 */
export async function runRLEpisode(
  selector: RLStrategySelector,
  workload: SystemState[],
  callbacks?: RLIntegrationCallbacks
): Promise<{ totalReward: number; decisions: StrategyDecision[] }> {
  let totalReward = 0;
  const decisions: StrategyDecision[] = [];
  
  for (let i = 0; i < workload.length; i++) {
    const state = workload[i];
    const decision = selector.selectAction(state);
    
    callbacks?.onDecision(state, decision.action);
    decisions.push(decision);
    
    // Simulate reward (in real system, would measure actual metrics)
    const simulatedReward = calculateSimulatedReward(state, decision.action);
    
    // Get next state (simplified: small random change)
    const nextState: SystemState = {
      gpuMemoryPressure: Math.max(0, Math.min(1, state.gpuMemoryPressure + this.rng.randomFloat(-0.05, 0.05))),
      concurrentRequests: Math.max(0, state.concurrentRequests + this.rng.randomInt(-1, 1)),
      avgPromptLength: Math.max(0, state.avgPromptLength + this.rng.randomInt(-50, 50)),
      cacheHitRate: Math.max(0, Math.min(1, state.cacheHitRate + this.rng.randomFloat(-0.05, 0.05)))
    };
    
    const experience: LearningExperience = {
      state,
      action: decision.action,
      reward: simulatedReward,
      nextState,
      timestamp: Date.now()
    };
    
    selector.storeExperience(experience);
    callbacks?.onExperience(experience);
    
    totalReward += simulatedReward;
  }
  
  selector.endEpisode(totalReward);
  callbacks?.onEpisodeEnd(totalReward);
  
  return { totalReward, decisions };
}

function calculateSimulatedReward(state: SystemState, action: Action): number {
  let reward = 0;
  
  // Appropriate strategy selection
  if (action.schedulingStrategy === "SLO_AWARE" && state.concurrentRequests > 5) {
    reward += 0.3;
  }
  if (action.evictionStrategy === "FLOP_AWARE" && state.cacheHitRate > 0.5) {
    reward += 0.2;
  }
  if (action.compressionLevel === "high" && state.gpuMemoryPressure > 0.7) {
    reward += 0.2;
  }
  
  // Penalties for poor choices
  if (action.compressionLevel === "none" && state.gpuMemoryPressure > 0.8) {
    reward -= 0.3;
  }
  if (action.compressionLevel === "high" && state.gpuMemoryPressure < 0.3) {
    reward -= 0.2; // Wasteful compression
  }
  
  return round(reward + deterministicRandomFloat(-0.05, 0.05), 3); // Add noise
}
