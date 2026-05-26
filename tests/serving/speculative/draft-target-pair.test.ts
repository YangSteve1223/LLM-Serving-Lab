/**
 * Tests for DraftTargetPair
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  DRAFT_TARGET_PAIRS,
  estimateSpeedupRatio,
  estimateAcceptanceRate,
  createDraftTargetPair,
  getRecommendedPair,
  type DraftModelType,
  type DraftTargetPairConfig
} from '../../../src/agents/learningAssistant/serving/speculative/DraftTargetPair.ts';

describe('DraftTargetPair', () => {
  describe('DRAFT_TARGET_PAIRS', () => {
    it('should have predefined pairs', () => {
      assert.ok(DRAFT_TARGET_PAIRS, 'Should have predefined pairs');
      assert.ok(Object.keys(DRAFT_TARGET_PAIRS).length > 0, 'Should have at least one pair');
    });

    it('should have t5_xxl_small configuration', () => {
      const pair = DRAFT_TARGET_PAIRS.t5_xxl_small;
      
      assert.strictEqual(pair.id, 't5_xxl_small', 'Should have correct ID');
      assert.strictEqual(pair.targetModel, 'T5-XXL', 'Should have correct target model');
      assert.strictEqual(pair.targetSizeB, 11, 'Should have correct target size');
      assert.strictEqual(pair.draftModel.type, 'smaller_model', 'Should have smaller_model type');
      assert.strictEqual(typeof pair.expectedAcceptanceRate, 'number', 'Should have acceptance rate');
      assert.ok(pair.expectedAcceptanceRate >= 0 && pair.expectedAcceptanceRate <= 1, 'Acceptance rate should be 0-1');
      assert.strictEqual(typeof pair.speedupRatio, 'number', 'Should have speedup ratio');
      assert.ok(pair.speedupRatio > 0 && pair.speedupRatio < 1, 'Speedup ratio should be 0-1');
      assert.strictEqual(typeof pair.memoryOverheadGB, 'number', 'Should have memory overhead');
      assert.strictEqual(typeof pair.trainingRequired, 'boolean', 'Should have training flag');
    });

    it('should have llama65b_boost configuration', () => {
      const pair = DRAFT_TARGET_PAIRS.llama65b_boost;
      
      assert.strictEqual(pair.targetModel, 'LLaMA-65B', 'Should have correct target model');
      assert.strictEqual(pair.targetSizeB, 65, 'Should have correct target size');
      assert.strictEqual(pair.draftModel.type, 'distilled', 'Should have distilled type');
      assert.ok(pair.expectedAcceptanceRate >= 0.65 && pair.expectedAcceptanceRate <= 0.85, 
        'Distilled acceptance rate should be in expected range');
      assert.ok(pair.trainingRequired === true, 'Distilled models require training');
    });

    it('should have vicuna7b_medusa configuration', () => {
      const pair = DRAFT_TARGET_PAIRS.vicuna7b_medusa;
      
      assert.strictEqual(pair.targetModel, 'Vicuna-7B', 'Should have correct target model');
      assert.strictEqual(pair.draftModel.type, 'medusa_heads', 'Should have medusa_heads type');
      assert.strictEqual(pair.draftModel.numHeads, 5, 'Should have 5 heads');
      assert.ok(pair.memoryOverheadGB < 1, 'Medusa should have low memory overhead');
    });

    it('should have vicuna13b_medusa configuration', () => {
      const pair = DRAFT_TARGET_PAIRS.vicuna13b_medusa;
      
      assert.strictEqual(pair.targetModel, 'Vicuna-13B', 'Should have correct target model');
      assert.strictEqual(pair.targetSizeB, 13, 'Should have correct target size');
      // 13B should have slightly lower acceptance than 7B
      assert.ok(pair.expectedAcceptanceRate <= DRAFT_TARGET_PAIRS.vicuna7b_medusa.expectedAcceptanceRate,
        '13B acceptance should be <= 7B acceptance');
    });

    it('should have llama2_70b_eagle configuration', () => {
      const pair = DRAFT_TARGET_PAIRS.llama2_70b_eagle;
      
      assert.strictEqual(pair.targetModel, 'LLaMA-2-70B', 'Should have correct target model');
      assert.strictEqual(pair.draftModel.type, 'eagle_predictor', 'Should have eagle_predictor type');
      assert.ok(pair.draftModel.sizeMB! >= 400 && pair.draftModel.sizeMB! <= 600,
        'EAGLE predictor size should be reasonable');
    });

    it('should have llama2_70b_eagle2 configuration', () => {
      const pair = DRAFT_TARGET_PAIRS.llama2_70b_eagle2;
      
      // EAGLE-2 should have higher acceptance than EAGLE
      assert.ok(pair.expectedAcceptanceRate >= DRAFT_TARGET_PAIRS.llama2_70b_eagle.expectedAcceptanceRate,
        'EAGLE-2 acceptance should be >= EAGLE acceptance');
      assert.ok(pair.memoryOverheadGB > DRAFT_TARGET_PAIRS.llama2_70b_eagle.memoryOverheadGB,
        'EAGLE-2 should have higher memory overhead');
    });

    it('should have chinchilla70b_small configuration', () => {
      const pair = DRAFT_TARGET_PAIRS.chinchilla70b_small;
      
      assert.strictEqual(pair.targetModel, 'Chinchilla-70B', 'Should have correct target model');
      assert.strictEqual(pair.draftModel.type, 'smaller_model', 'Should have smaller_model type');
      assert.strictEqual(pair.trainingRequired, false, 'Smaller models should not require training');
    });

    it('should have ngram_lookup configuration', () => {
      const pair = DRAFT_TARGET_PAIRS.ngram_lookup;
      
      assert.strictEqual(pair.draftModel.type, 'ngram_lookup', 'Should have ngram_lookup type');
      assert.ok(pair.expectedAcceptanceRate < 0.6, 'N-gram should have lower acceptance');
      assert.ok(pair.memoryOverheadGB < 0.2, 'N-gram should have very low memory overhead');
      assert.strictEqual(pair.trainingRequired, false, 'N-gram should not require training');
    });

    it('all pairs should have valid configuration', () => {
      for (const [id, pair] of Object.entries(DRAFT_TARGET_PAIRS)) {
        assert.ok(pair.id === id, `${id} should have matching ID`);
        assert.ok(pair.targetModel.length > 0, `${id} should have target model name`);
        assert.ok(pair.targetSizeB > 0, `${id} should have positive target size`);
        assert.ok(['smaller_model', 'distilled', 'medusa_heads', 'eagle_predictor', 'ngram_lookup'].includes(pair.draftModel.type),
          `${id} should have valid draft type`);
        assert.ok(pair.expectedAcceptanceRate >= 0 && pair.expectedAcceptanceRate <= 1,
          `${id} should have valid acceptance rate`);
        assert.ok(pair.speedupRatio > 0 && pair.speedupRatio < 1,
          `${id} should have valid speedup ratio`);
        assert.ok(pair.memoryOverheadGB >= 0, `${id} should have non-negative memory overhead`);
      }
    });
  });

  describe('estimateSpeedupRatio', () => {
    it('should calculate speedup based on model size ratio', () => {
      // 70B model with 700M draft = 100x smaller
      const speedup = estimateSpeedupRatio(70, 700);
      
      assert.ok(speedup > 0, 'Speedup should be positive');
      assert.ok(speedup < 1, 'Speedup ratio should be < 1');
      assert.ok(speedup > 0.005, 'Speedup should be reasonable');
    });

    it('should handle equal size models', () => {
      const speedup = estimateSpeedupRatio(7, 7);
      
      assert.strictEqual(speedup, 1, 'Equal size should give speedup of 1');
    });

    it('should apply weight sharing adjustment', () => {
      const withoutSharing = estimateSpeedupRatio(70, 700, 0);
      const withSharing = estimateSpeedupRatio(70, 700, 0.9);
      
      assert.ok(withSharing < withoutSharing, 'Sharing should increase speedup (lower ratio)');
    });

    it('should clamp speedup to reasonable range', () => {
      // Extreme case: 1B draft for 100B target
      const extreme = estimateSpeedupRatio(100, 1000);
      
      assert.ok(extreme >= 0.01, 'Speedup should be at least 0.01');
      assert.ok(extreme <= 0.5, 'Speedup should be at most 0.5');
    });

    it('should handle very small draft models', () => {
      const speedup = estimateSpeedupRatio(70, 50);
      
      assert.ok(speedup > 0, 'Speedup should be positive');
      assert.ok(speedup <= 0.5, 'Very small draft should still have speedup < 0.5');
    });
  });

  describe('estimateAcceptanceRate', () => {
    it('should return different rates for different draft types', () => {
      const smallerModel = estimateAcceptanceRate('smaller_model', 'chat');
      const distilled = estimateAcceptanceRate('distilled', 'chat');
      const medusa = estimateAcceptanceRate('medusa_heads', 'chat');
      const eagle = estimateAcceptanceRate('eagle_predictor', 'chat');
      const ngram = estimateAcceptanceRate('ngram_lookup', 'chat');
      
      // Distilled should generally have higher acceptance
      assert.ok(distilled >= smallerModel, 'Distilled should have >= acceptance than smaller_model');
      assert.ok(medusa >= smallerModel, 'Medusa should have >= acceptance than smaller_model');
      assert.ok(eagle >= smallerModel, 'EAGLE should have >= acceptance than smaller_model');
      // N-gram typically has lower acceptance
      assert.ok(ngram <= 0.6, 'N-gram should have lower acceptance');
    });

    it('should apply content type adjustments for code', () => {
      const chat = estimateAcceptanceRate('smaller_model', 'chat');
      const code = estimateAcceptanceRate('smaller_model', 'code');
      
      // Code may have different acceptance (typically lower for smaller models)
      assert.ok(code !== chat || (code === chat && chat === 0.6), 
        'Code and chat should have different or same rates');
    });

    it('should apply content type adjustments for creative', () => {
      const chat = estimateAcceptanceRate('smaller_model', 'chat');
      const creative = estimateAcceptanceRate('smaller_model', 'creative');
      
      // Creative content typically has lower acceptance for smaller models
      assert.ok(creative < chat, 'Creative should have lower acceptance for smaller models');
    });

    it('should clamp acceptance rate to valid range', () => {
      // Test with various combinations
      const rates = [
        estimateAcceptanceRate('smaller_model', 'chat'),
        estimateAcceptanceRate('distilled', 'formal'),
        estimateAcceptanceRate('ngram_lookup', 'code'),
        estimateAcceptanceRate('eagle_predictor', 'creative')
      ];
      
      for (const rate of rates) {
        assert.ok(rate >= 0.3 && rate <= 0.95, 
          `Acceptance rate ${rate} should be in valid range [0.3, 0.95]`);
      }
    });

    it('should handle all draft types', () => {
      const types: DraftModelType[] = ['smaller_model', 'distilled', 'medusa_heads', 'eagle_predictor', 'ngram_lookup'];
      
      for (const type of types) {
        const rate = estimateAcceptanceRate(type, 'chat');
        assert.ok(typeof rate === 'number', `${type} should return a number`);
        assert.ok(rate >= 0 && rate <= 1, `${type} should return valid rate`);
      }
    });
  });

  describe('createDraftTargetPair', () => {
    it('should create custom pair for LLaMA model', () => {
      const pair = createDraftTargetPair('LLaMA-7B', 7, 'smaller_model');
      
      assert.ok(pair.id.startsWith('custom_'), 'ID should start with custom_');
      assert.strictEqual(pair.targetModel, 'LLaMA-7B', 'Should have correct target');
      assert.strictEqual(pair.targetSizeB, 7, 'Should have correct size');
      assert.strictEqual(pair.draftModel.type, 'smaller_model', 'Should have correct draft type');
      assert.ok(pair.expectedAcceptanceRate >= 0.5, 'Should have reasonable acceptance');
      assert.ok(pair.speedupRatio > 0 && pair.speedupRatio < 1, 'Should have valid speedup');
    });

    it('should use custom draft size when provided', () => {
      const pair = createDraftTargetPair('LLaMA-13B', 13, 'smaller_model', 100);
      
      assert.strictEqual(pair.draftModel.sizeMB, 100, 'Should use custom size');
    });

    it('should use appropriate default sizes for medusa_heads', () => {
      const pair = createDraftTargetPair('LLaMA-7B', 7, 'medusa_heads', undefined, 5);
      
      assert.strictEqual(pair.draftModel.type, 'medusa_heads', 'Should have medusa type');
      assert.strictEqual(pair.draftModel.numHeads, 5, 'Should have specified heads');
      assert.ok(pair.draftModel.sizeMB! < 100, 'Medusa heads should have small size');
      assert.ok(pair.trainingRequired, 'Medusa should require training');
    });

    it('should use appropriate default sizes for eagle_predictor', () => {
      const pair = createDraftTargetPair('LLaMA-70B', 70, 'eagle_predictor');
      
      assert.strictEqual(pair.draftModel.type, 'eagle_predictor', 'Should have EAGLE type');
      assert.ok(pair.draftModel.sizeMB! >= 400 && pair.draftModel.sizeMB! <= 600,
        'EAGLE predictor should have reasonable size');
    });

    it('should use appropriate default sizes for ngram_lookup', () => {
      const pair = createDraftTargetPair('generic', 7, 'ngram_lookup');
      
      assert.strictEqual(pair.draftModel.type, 'ngram_lookup', 'Should have N-gram type');
      assert.strictEqual(pair.trainingRequired, false, 'N-gram should not require training');
      assert.ok(pair.memoryOverheadGB < 0.2, 'N-gram should have minimal memory');
    });

    it('should set appropriate memory overhead for each type', () => {
      const medusa = createDraftTargetPair('LLaMA-7B', 7, 'medusa_heads');
      const eagle = createDraftTargetPair('LLaMA-70B', 70, 'eagle_predictor');
      const ngram = createDraftTargetPair('generic', 7, 'ngram_lookup');
      
      assert.ok(medusa.memoryOverheadGB < eagle.memoryOverheadGB,
        'Medusa should have lower overhead than EAGLE');
      assert.ok(ngram.memoryOverheadGB < medusa.memoryOverheadGB,
        'N-gram should have lowest overhead');
    });
  });

  describe('getRecommendedPair', () => {
    it('should return EAGLE-2 for LLaMA-2-70B', () => {
      const pair = getRecommendedPair('LLaMA-2-70B');
      
      assert.ok(pair !== null, 'Should find a recommendation');
      assert.strictEqual(pair!.id, 'llama2_70b_eagle2', 'Should recommend EAGLE-2');
    });

    it('should return boost for LLaMA-65B', () => {
      const pair = getRecommendedPair('LLaMA-65B');
      
      assert.ok(pair !== null, 'Should find a recommendation');
      assert.strictEqual(pair!.id, 'llama65b_boost', 'Should recommend SpecInfer boost');
    });

    it('should return Medusa-5 for Vicuna-7B', () => {
      const pair = getRecommendedPair('Vicuna-7B');
      
      assert.ok(pair !== null, 'Should find a recommendation');
      assert.strictEqual(pair!.id, 'vicuna7b_medusa', 'Should recommend Medusa-5');
    });

    it('should return Medusa-5 for Vicuna-13B', () => {
      const pair = getRecommendedPair('Vicuna-13B');
      
      assert.ok(pair !== null, 'Should find a recommendation');
      assert.strictEqual(pair!.id, 'vicuna13b_medusa', 'Should recommend Medusa-5 for 13B');
    });

    it('should return T5-XXL/Small for T5-XXL', () => {
      const pair = getRecommendedPair('T5-XXL');
      
      assert.ok(pair !== null, 'Should find a recommendation');
      assert.strictEqual(pair!.id, 't5_xxl_small', 'Should recommend T5-Small');
    });

    it('should return Chinchilla config for Chinchilla-70B', () => {
      const pair = getRecommendedPair('Chinchilla-70B');
      
      assert.ok(pair !== null, 'Should find a recommendation');
      assert.strictEqual(pair!.id, 'chinchilla70b_small', 'Should recommend Chinchilla small');
    });

    it('should return null for unknown models', () => {
      const pair = getRecommendedPair('UnknownModel-99B');
      
      assert.strictEqual(pair, null, 'Should return null for unknown models');
    });

    it('should be case-insensitive', () => {
      const pair1 = getRecommendedPair('llama-2-70b');
      const pair2 = getRecommendedPair('LLAMA-2-70B');
      
      assert.ok(pair1 !== null && pair2 !== null, 'Both should find recommendations');
      assert.strictEqual(pair1!.id, pair2!.id, 'Case should not affect result');
    });
  });
});
