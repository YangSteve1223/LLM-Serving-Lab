/**
 * Draft-Target Model Pair Configuration
 * 
 * Defines configurations for different draft model architectures and
 * estimates draft-target speedup ratios based on model sizes.
 * 
 * References:
 * - Leviathan et al. (2023). "Fast Inference from Transformers via Speculative Decoding". ICML.
 *   Reports 2-3x speedup on T5-XXL using smaller draft models.
 * - SpecInfer (Miao et al., 2024). "SpecInfer: Accelerating Large Language Model Serving with 
 *   Tree-based Speculative Inference". MLSys.
 *   Reports 1.5-3.5x speedup using boost-tuned small models.
 * - Medusa (Cai et al., 2024). "Medusa: Simple LLM Inference Acceleration Framework with 
 *   Multiple Decoding Heads". ICML.
 *   Reports 2.2-3.6x speedup using multi-head prediction.
 */

/**
 * Draft model architecture type.
 */
export type DraftModelType = 
  | 'smaller_model'      // Smaller version of target (e.g., LLaMA-68M for LLaMA-7B)
  | 'distilled'          // Distilled version with alignment training
  | 'medusa_heads'       // Additional prediction heads on target
  | 'eagle_predictor'    // Feature-level predictor (EAGLE-style)
  | 'ngram_lookup';      // N-gram based prediction

/**
 * Configuration for a draft-target model pair.
 */
export interface DraftTargetPairConfig {
  /** Unique identifier for this pair */
  id: string;
  
  /** Target model name */
  targetModel: string;
  /** Target model size in billions of parameters */
  targetSizeB: number;
  
  /** Draft model configuration */
  draftModel: {
    /** Draft model type */
    type: DraftModelType;
    /** Draft model name (if applicable) */
    name?: string;
    /** Draft model size in millions of parameters */
    sizeMB?: number;
    /** Number of extra heads (for medusa_heads type) */
    numHeads?: number;
  };
  
  /** Expected acceptance rate for this pair */
  expectedAcceptanceRate: number;
  
  /** Draft model speedup relative to target (0-1, where 0.1 = 10x faster) */
  speedupRatio: number;
  
  /** Memory overhead for draft model (in GB) */
  memoryOverheadGB: number;
  
  /** Training required for this draft approach */
  trainingRequired: boolean;
  
  /** Notes about this configuration */
  notes?: string;
}

/**
 * Predefined draft-target pairs based on published research.
 */
export const DRAFT_TARGET_PAIRS: Record<string, DraftTargetPairConfig> = {
  // Leviathan-style: T5-XXL (11B) with T5-Small (60M)
  t5_xxl_small: {
    id: 't5_xxl_small',
    targetModel: 'T5-XXL',
    targetSizeB: 11,
    draftModel: {
      type: 'smaller_model',
      name: 'T5-Small',
      sizeMB: 60
    },
    expectedAcceptanceRate: 0.75,
    speedupRatio: 0.15, // ~6.7x faster draft
    memoryOverheadGB: 0.3,
    trainingRequired: false,
    notes: 'From Leviathan et al. (2023): 2-3x end-to-end speedup'
  },

  // SpecInfer: LLaMA-65B with boost-tuned small models
  llama65b_boost: {
    id: 'llama65b_boost',
    targetModel: 'LLaMA-65B',
    targetSizeB: 65,
    draftModel: {
      type: 'distilled',
      name: 'Boost-tuned-LM',
      sizeMB: 2000 // ~2B parameters
    },
    expectedAcceptanceRate: 0.70,
    speedupRatio: 0.12, // ~8x faster draft
    memoryOverheadGB: 8,
    trainingRequired: true,
    notes: 'From SpecInfer (Miao et al., 2024): 2.0-2.4x speedup'
  },

  // Medusa: Vicuna-7B with 5 extra heads
  vicuna7b_medusa: {
    id: 'vicuna7b_medusa',
    targetModel: 'Vicuna-7B',
    targetSizeB: 7,
    draftModel: {
      type: 'medusa_heads',
      name: 'Medusa-5',
      numHeads: 5
    },
    expectedAcceptanceRate: 0.65,
    speedupRatio: 0.25, // Draft shares weights, ~4x faster
    memoryOverheadGB: 0.5, // Just extra heads
    trainingRequired: true,
    notes: 'From Medusa (Cai et al., 2024): 2.2-2.8x speedup'
  },

  // Medusa: Vicuna-13B with 5 extra heads
  vicuna13b_medusa: {
    id: 'vicuna13b_medusa',
    targetModel: 'Vicuna-13B',
    targetSizeB: 13,
    draftModel: {
      type: 'medusa_heads',
      name: 'Medusa-5',
      numHeads: 5
    },
    expectedAcceptanceRate: 0.62,
    speedupRatio: 0.22, // Slightly lower due to larger model
    memoryOverheadGB: 0.8,
    trainingRequired: true,
    notes: 'From Medusa (Cai et al., 2024): 2.3-3.0x speedup'
  },

  // EAGLE: LLaMA-2-70B with feature predictor
  llama2_70b_eagle: {
    id: 'llama2_70b_eagle',
    targetModel: 'LLaMA-2-70B',
    targetSizeB: 70,
    draftModel: {
      type: 'eagle_predictor',
      name: 'EAGLE-Predictor',
      sizeMB: 500 // Feature predictor is small
    },
    expectedAcceptanceRate: 0.72,
    speedupRatio: 0.20, // ~5x faster
    memoryOverheadGB: 2,
    trainingRequired: true,
    notes: 'From EAGLE (Li et al., 2024): 2.7-3.5x speedup on LLaMA-2-70B'
  },

  // EAGLE-2: More aggressive speculation
  llama2_70b_eagle2: {
    id: 'llama2_70b_eagle2',
    targetModel: 'LLaMA-2-70B',
    targetSizeB: 70,
    draftModel: {
      type: 'eagle_predictor',
      name: 'EAGLE-2-Predictor',
      sizeMB: 800
    },
    expectedAcceptanceRate: 0.78,
    speedupRatio: 0.18, // Slightly slower predictor, but better acceptance
    memoryOverheadGB: 3,
    trainingRequired: true,
    notes: 'From EAGLE-2: 3-5x speedup'
  },

  // Chinchilla-70B with Small LM (DeepMind approach)
  chinchilla70b_small: {
    id: 'chinchilla70b_small',
    targetModel: 'Chinchilla-70B',
    targetSizeB: 70,
    draftModel: {
      type: 'smaller_model',
      name: 'Chinchilla-1B',
      sizeMB: 1000
    },
    expectedAcceptanceRate: 0.68,
    speedupRatio: 0.14,
    memoryOverheadGB: 4,
    trainingRequired: false,
    notes: 'From Chen et al. (2023): 2-2.5x speedup'
  },

  // N-gram lookup (prompt-dependent)
  ngram_lookup: {
    id: 'ngram_lookup',
    targetModel: 'generic',
    targetSizeB: 7, // Assumed 7B target
    draftModel: {
      type: 'ngram_lookup',
      name: 'N-gram Lookup Table'
    },
    expectedAcceptanceRate: 0.55, // Lower but no extra memory
    speedupRatio: 0.05, // Very fast lookup
    memoryOverheadGB: 0.1, // Small lookup table
    trainingRequired: false,
    notes: 'Best for repetitive/structured outputs'
  }
};

/**
 * Estimate speedup ratio based on model sizes.
 * 
 * Based on the observation that draft model speed is roughly
 * proportional to its size relative to the target.
 */
export function estimateSpeedupRatio(
  targetSizeB: number,
  draftSizeMB: number,
  sharingRatio: number = 1.0
): number {
  // Draft time is proportional to its size
  const draftSizeB = draftSizeMB / 1000;
  const baseRatio = draftSizeB / targetSizeB;
  
  // Adjust for weight sharing (e.g., Medusa heads share most weights)
  const effectiveRatio = baseRatio * (1 - sharingRatio) + sharingRatio * 0.1;
  
  return Math.min(0.5, Math.max(0.01, effectiveRatio));
}

/**
 * Estimate acceptance rate based on model alignment.
 * 
 * Draft models trained with knowledge distillation have better alignment
 * and thus higher acceptance rates.
 */
export function estimateAcceptanceRate(
  draftType: DraftModelType,
  contentType: 'code' | 'chat' | 'formal' | 'creative' = 'chat'
): number {
  // Base acceptance rates by type
  const baseRates: Record<DraftModelType, number> = {
    'smaller_model': 0.60,
    'distilled': 0.72,
    'medusa_heads': 0.65,
    'eagle_predictor': 0.70,
    'ngram_lookup': 0.50
  };
  
  // Content type adjustments
  const contentAdjustments: Record<string, Record<string, number>> = {
    'smaller_model': { code: -0.05, chat: 0, formal: 0.05, creative: -0.10 },
    'distilled': { code: 0, chat: 0, formal: 0.05, creative: -0.05 },
    'medusa_heads': { code: 0.05, chat: 0, formal: 0.02, creative: -0.08 },
    'eagle_predictor': { code: 0.03, chat: 0, formal: 0.03, creative: -0.05 },
    'ngram_lookup': { code: 0.10, chat: 0, formal: 0.05, creative: -0.15 }
  };
  
  const base = baseRates[draftType] || 0.6;
  const adjustment = contentAdjustments[draftType]?.[contentType] || 0;
  
  return Math.min(0.95, Math.max(0.3, base + adjustment));
}

/**
 * Create a custom draft-target pair configuration.
 */
export function createDraftTargetPair(
  targetModel: string,
  targetSizeB: number,
  draftType: DraftModelType,
  draftSizeMB?: number,
  numHeads?: number
): DraftTargetPairConfig {
  const sharingRatio = draftType === 'medusa_heads' ? 0.9 : 
                       draftType === 'eagle_predictor' ? 0.7 : 0;
  
  const actualDraftSizeMB = draftSizeMB || 
    (draftType === 'medusa_heads' ? 50 : // Just heads
     draftType === 'eagle_predictor' ? 500 :
     draftType === 'ngram_lookup' ? 100 :
     targetSizeB * 100); // Assume 100x smaller
  
  return {
    id: `custom_${targetModel}_${draftType}_${Date.now()}`,
    targetModel,
    targetSizeB,
    draftModel: {
      type: draftType,
      name: draftType === 'medusa_heads' ? `Medusa-${numHeads || 5}` :
            draftType === 'eagle_predictor' ? 'EAGLE-Predictor' :
            draftType === 'ngram_lookup' ? 'N-gram Lookup' : undefined,
      sizeMB: actualDraftSizeMB,
      numHeads
    },
    expectedAcceptanceRate: estimateAcceptanceRate(draftType),
    speedupRatio: estimateSpeedupRatio(targetSizeB, actualDraftSizeMB, sharingRatio),
    memoryOverheadGB: draftType === 'medusa_heads' ? 0.5 :
                      draftType === 'eagle_predictor' ? 2 :
                      draftType === 'ngram_lookup' ? 0.1 :
                      actualDraftSizeMB / 1000 * 2, // Rough estimate
    trainingRequired: draftType !== 'smaller_model' && draftType !== 'ngram_lookup',
    notes: `Custom configuration: ${draftType} draft for ${targetModel}`
  };
}

/**
 * Get recommended draft-target pair for a target model.
 */
export function getRecommendedPair(targetModel: string): DraftTargetPairConfig | null {
  const modelLower = targetModel.toLowerCase();
  
  if (modelLower.includes('llama-2') && modelLower.includes('70b')) {
    return DRAFT_TARGET_PAIRS.llama2_70b_eagle;
  }
  if (modelLower.includes('llama') && modelLower.includes('65b')) {
    return DRAFT_TARGET_PAIRS.llama65b_boost;
  }
  if (modelLower.includes('vicuna') && modelLower.includes('13b')) {
    return DRAFT_TARGET_PAIRS.vicuna13b_medusa;
  }
  if (modelLower.includes('vicuna')) {
    return DRAFT_TARGET_PAIRS.vicuna7b_medusa;
  }
  if (modelLower.includes('t5') && modelLower.includes('xxl')) {
    return DRAFT_TARGET_PAIRS.t5_xxl_small;
  }
  if (modelLower.includes('chinchilla') && modelLower.includes('70b')) {
    return DRAFT_TARGET_PAIRS.chinchilla70b_small;
  }
  
  return null;
}
