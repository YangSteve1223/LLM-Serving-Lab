/**
 * Deterministic heuristic token estimator.
 *
 * It is deliberately dependency-free and tokenizer-inexact: good enough for
 * workload shape, prompt accounting, and simulator what-if analysis, but not a
 * replacement for model-specific tokenizers when real engine metrics exist.
 */
import type { EvidenceCandidate, LearningContext } from "../types.ts";
import type { EvidenceTokenSummary, PromptTokenBreakdown } from "./ServingTrace.ts";

const SOURCE_TYPES: EvidenceCandidate["sourceType"][] = [
  "current_page",
  "outline",
  "teacher_script",
  "speaker_notes",
  "neighbor_page",
  "knowledge_base",
  "wiki",
  "general_knowledge"
];

export class TokenEstimator {
  estimateTokens(text: string | undefined): number {
    const value = (text ?? "").trim();
    if (!value) return 0;
    const han = value.match(/[\u3400-\u9fff]/g)?.length ?? 0;
    const latinWords = value.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0;
    const numbers = value.match(/\d+(?:\.\d+)?/g)?.length ?? 0;
    const punctuation = value.match(/[^\sA-Za-z0-9\u3400-\u9fff]/g)?.length ?? 0;
    const mixedSpacing = Math.ceil(value.replace(/[\u3400-\u9fff]/g, "").length / 28);
    return Math.max(1, Math.ceil(han * 0.75 + latinWords * 1.15 + numbers * 1.1 + punctuation * 0.35 + mixedSpacing));
  }

  estimateEvidenceTokens(evidence: EvidenceCandidate[] = []): EvidenceTokenSummary {
    const bySourceType = Object.fromEntries(SOURCE_TYPES.map((sourceType) => [sourceType, 0])) as Record<EvidenceCandidate["sourceType"], number>;
    for (const item of evidence) {
      const tokens = this.estimateTokens([item.title, item.sectionTitle, item.text].filter(Boolean).join("\n"));
      bySourceType[item.sourceType] += tokens;
    }
    return {
      total: Object.values(bySourceType).reduce((sum, value) => sum + value, 0),
      bySourceType
    };
  }

  estimatePromptBreakdown(input: {
    systemPrompt?: string;
    userPrompt?: string;
    selectedEvidence?: EvidenceCandidate[];
    context?: LearningContext;
    estimatedDecodeText?: string;
  }): PromptTokenBreakdown {
    const context = input.context ?? {};
    const selectedEvidence = input.selectedEvidence ?? [];
    const evidenceSummary = this.estimateEvidenceTokens(selectedEvidence);
    const currentPageTokens = this.estimateTokens([context.currentPage?.semanticTitle, context.currentPage?.title, context.currentPage?.text].filter(Boolean).join("\n"));
    const teacherScriptTokens = this.estimateTokens(context.teacherScript?.text);
    const outlineTokens = this.estimateTokens(context.outline?.items.map((item) => `${item.title}\n${item.summary ?? ""}`).join("\n"));
    const neighborPageTokens = this.estimateTokens([context.neighborPages?.previous?.summary, context.neighborPages?.next?.summary].filter(Boolean).join("\n"));
    const knowledgeBaseTokens = (evidenceSummary.bySourceType.wiki ?? 0) + (evidenceSummary.bySourceType.knowledge_base ?? 0);
    const systemTokens = this.estimateTokens(input.systemPrompt);
    const userPromptTokens = this.estimateTokens(input.userPrompt);
    const selectedEvidenceTokens = evidenceSummary.total;
    const estimatedPrefillTokens = systemTokens + userPromptTokens;
    const estimatedDecodeTokens = this.estimateTokens(input.estimatedDecodeText);
    const cacheablePrefixTokens = systemTokens + currentPageTokens + teacherScriptTokens + outlineTokens + neighborPageTokens;
    const nonCacheableTokens = Math.max(0, estimatedPrefillTokens - cacheablePrefixTokens);

    return {
      systemTokens,
      userPromptTokens,
      currentPageTokens,
      teacherScriptTokens,
      outlineTokens,
      neighborPageTokens,
      knowledgeBaseTokens,
      selectedEvidenceTokens,
      estimatedPrefillTokens,
      estimatedDecodeTokens,
      cacheablePrefixTokens,
      nonCacheableTokens
    };
  }
}

export const tokenEstimator = new TokenEstimator();
export function estimateTokens(text: string | undefined): number {
  return tokenEstimator.estimateTokens(text);
}
