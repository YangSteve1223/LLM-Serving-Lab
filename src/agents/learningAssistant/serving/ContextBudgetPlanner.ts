/**
 * Observe-first context budget planner.
 *
 * It suggests lower-prefill policies only when grounding risk is acceptable. In
 * course-grounded or exact-evidence cases, preserving citations beats saving
 * tokens. Adaptive behavior must be explicitly enabled.
 */
import type { EvidenceCandidate, GroundingMode, QuestionAnalysis, SelectedEvidence } from "../types.ts";
import type { ContextBudgetSuggestion, PromptTokenBreakdown, ServingOptimizationMode, ServingSLO } from "./ServingTrace.ts";

export type ContextBudgetPlannerInput = {
  query: string;
  questionAnalysis: QuestionAnalysis;
  selectedEvidence: SelectedEvidence;
  tokenEstimate: PromptTokenBreakdown;
  confidence: "low" | "medium" | "high" | number;
  groundingMode: GroundingMode;
  slo?: ServingSLO;
  materialId?: string;
  pageIndex?: number;
  previousRequest?: { materialId?: string; pageIndex?: number };
  mode?: ServingOptimizationMode;
};

export type ContextBudgetPlan = {
  suggestion: ContextBudgetSuggestion;
  selectedEvidence: SelectedEvidence;
  applied: boolean;
};

export class ContextBudgetPlanner {
  plan(input: ContextBudgetPlannerInput): ContextBudgetPlan {
    const mode = input.mode ?? normalizeMode(process.env.SERVING_OPTIMIZATION_MODE);
    const preciseNeed = isPreciseNeed(input.query, input.questionAnalysis);
    const currentPageOnly = isCurrentPageOnly(input.questionAnalysis, input.selectedEvidence);
    const confidence = normalizeConfidence(input.confidence);
    const repeatedPage = Boolean(
      input.materialId &&
        input.pageIndex &&
        input.previousRequest?.materialId === input.materialId &&
        input.previousRequest?.pageIndex === input.pageIndex
    );
    const highPrefill = input.tokenEstimate.estimatedPrefillTokens > 1800 || Boolean(input.slo?.ttftMs && simulatedTTFT(input.tokenEstimate) > input.slo.ttftMs);
    const cacheReduction = repeatedPage ? Math.min(input.tokenEstimate.cacheablePrefixTokens, input.tokenEstimate.estimatedPrefillTokens) : 0;

    let suggestion: ContextBudgetSuggestion;
    if (repeatedPage && cacheReduction > 0) {
      suggestion = {
        mode,
        recommendedPolicy: "cache_first",
        reason: "same material/page prefix is likely reusable across learner turns",
        expectedPrefillTokenReduction: cacheReduction,
        risk: input.groundingMode === "course_grounded_only" ? "medium" : "low"
      };
    } else if (currentPageOnly && highPrefill && !preciseNeed) {
      suggestion = {
        mode,
        recommendedPolicy: "current_page_only",
        reason: "question appears answerable from current page evidence; other context can be omitted in an adaptive run",
        expectedPrefillTokenReduction: Math.max(0, input.tokenEstimate.estimatedPrefillTokens - input.tokenEstimate.currentPageTokens),
        risk: input.groundingMode === "course_grounded_only" ? "medium" : "low"
      };
    } else if (highPrefill && confidence >= 0.7 && !preciseNeed) {
      suggestion = {
        mode,
        recommendedPolicy: "evidence_top_k",
        reason: "prefill estimate is high and selected evidence appears sufficient; keep top evidence before decode",
        expectedPrefillTokenReduction: Math.floor(input.tokenEstimate.selectedEvidenceTokens * 0.35),
        risk: input.groundingMode === "course_grounded_only" ? "medium" : "low"
      };
    } else if (highPrefill && !preciseNeed) {
      suggestion = {
        mode,
        recommendedPolicy: "compressed",
        reason: "prefill estimate is high; lossless-looking line truncation may reduce cost while retaining citation metadata",
        expectedPrefillTokenReduction: Math.floor(input.tokenEstimate.selectedEvidenceTokens * 0.25),
        risk: input.groundingMode === "course_grounded_only" ? "high" : "medium"
      };
    } else {
      suggestion = {
        mode,
        recommendedPolicy: "full",
        reason: preciseNeed ? "precise formula/numeric evidence should not be aggressively compressed" : "prefill estimate is within the default budget",
        expectedPrefillTokenReduction: 0,
        risk: input.groundingMode === "course_grounded_only" ? "medium" : "low"
      };
    }

    if (input.groundingMode === "course_grounded_only" && suggestion.risk === "low") {
      suggestion = { ...suggestion, risk: "medium", reason: `${suggestion.reason}; course-grounded mode must preserve supporting citations` };
    }

    if (mode !== "adaptive" || suggestion.recommendedPolicy === "full" || suggestion.recommendedPolicy === "cache_first") {
      return { suggestion, selectedEvidence: input.selectedEvidence, applied: false };
    }

    return {
      suggestion,
      selectedEvidence: applyConservativeBudget(input.selectedEvidence, suggestion.recommendedPolicy, preciseNeed),
      applied: true
    };
  }
}

function applyConservativeBudget(selectedEvidence: SelectedEvidence, policy: ContextBudgetSuggestion["recommendedPolicy"], preciseNeed: boolean): SelectedEvidence {
  if (preciseNeed) return selectedEvidence;
  if (policy === "current_page_only") {
    const selected = selectedEvidence.selected.filter((item) => item.sourceType === "current_page").slice(0, 2);
    return selected.length > 0 ? { ...selectedEvidence, selected } : selectedEvidence;
  }
  if (policy === "evidence_top_k") {
    return { ...selectedEvidence, selected: selectedEvidence.selected.slice(0, 4) };
  }
  if (policy === "compressed") {
    return {
      ...selectedEvidence,
      selected: selectedEvidence.selected.map((item) => compressEvidence(item))
    };
  }
  return selectedEvidence;
}

export function compressEvidence(evidence: EvidenceCandidate, maxChars = 650): EvidenceCandidate {
  if (evidence.text.length <= maxChars) return evidence;
  const lines = evidence.text
    .split(/\r?\n|(?<=[。.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length > maxChars) break;
    kept.push(line);
    length += line.length;
  }
  return {
    ...evidence,
    text: kept.length > 0 ? kept.join("\n") : evidence.text.slice(0, maxChars),
    metadata: { ...evidence.metadata, compressed: true, originalLength: evidence.text.length }
  };
}

function isCurrentPageOnly(question: QuestionAnalysis, evidence: SelectedEvidence): boolean {
  const hasCurrent = evidence.selected.some((item) => item.sourceType === "current_page");
  const hasKb = evidence.selected.some((item) => item.sourceType === "wiki" || item.sourceType === "knowledge_base");
  return hasCurrent && !hasKb && ["ask_current_page_summary", "ask_current_page_concept"].includes(question.intent);
}

function isPreciseNeed(query: string, question: QuestionAnalysis): boolean {
  return (
    question.evidenceNeed === "exact_formula_or_derivation" ||
    question.evidenceNeed === "budget_table" ||
    question.evidenceNeed === "numeric_calculation_from_page" ||
    /(公式|预算|精确|换算|多少|mAP|F1|FLOPS|PFLOPS|GFLOPS|\d)/i.test(query)
  );
}

function normalizeConfidence(value: "low" | "medium" | "high" | number): number {
  if (typeof value === "number") return value;
  if (value === "high") return 0.9;
  if (value === "medium") return 0.6;
  return 0.3;
}

function simulatedTTFT(tokenEstimate: PromptTokenBreakdown): number {
  const prefillMsPerToken = Number(process.env.SERVING_PREFILL_MS_PER_TOKEN ?? 0.18);
  const kvMsPerToken = Number(process.env.SERVING_KV_MS_PER_TOKEN ?? 0.015);
  return 30 + tokenEstimate.estimatedPrefillTokens * (prefillMsPerToken + kvMsPerToken);
}

function normalizeMode(value: string | undefined): ServingOptimizationMode {
  if (value === "adaptive" || value === "off" || value === "observe_only") return value;
  return "observe_only";
}

export const contextBudgetPlanner = new ContextBudgetPlanner();
