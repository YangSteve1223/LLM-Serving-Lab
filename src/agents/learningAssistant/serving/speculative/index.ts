/**
 * Speculative Decoding Module
 * 
 * Implements speculative decoding simulation for LLM serving optimization.
 */
export { SpeculativeDecodingSimulator, speculativeDecodingSimulator } from "./SpeculativeDecodingSimulator.ts";
export type {
  SpeculativeDecodingConfig,
  SpeculativeRoundResult,
  SpeculativeResult,
  ComparisonResult,
  SpeculativeWorkloadRequest
} from "./SpeculativeDecodingSimulator.ts";

export { 
  DRAFT_TARGET_PAIRS,
  createDraftTargetPair,
  getRecommendedPair,
  estimateSpeedupRatio,
  estimateAcceptanceRate
} from "./DraftTargetPair.ts";
export type {
  DraftModelType,
  DraftTargetPairConfig
} from "./DraftTargetPair.ts";

export { SpeculativeSchedulingIntegration, speculativeSchedulingIntegration } from "./SpeculativeSchedulingIntegration.ts";
export type {
  SpeculativeDecision,
  SpeculativeSchedulingConfig,
  SpeculativeSchedulingResult,
  WorkloadCharacteristics
} from "./SpeculativeSchedulingIntegration.ts";
