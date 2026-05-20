import assert from "node:assert/strict";
import test from "node:test";
import { ContextBudgetPlanner, type PromptTokenBreakdown } from "../../src/agents/learningAssistant/serving/index.ts";
import type { QuestionAnalysis, SelectedEvidence } from "../../src/agents/learningAssistant/index.ts";

const highPrefill: PromptTokenBreakdown = {
  systemTokens: 100,
  userPromptTokens: 2500,
  currentPageTokens: 600,
  teacherScriptTokens: 200,
  outlineTokens: 200,
  neighborPageTokens: 200,
  knowledgeBaseTokens: 0,
  selectedEvidenceTokens: 1200,
  estimatedPrefillTokens: 2600,
  estimatedDecodeTokens: 120,
  cacheablePrefixTokens: 1300,
  nonCacheableTokens: 1300
};

const evidence: SelectedEvidence = {
  selected: [{ sourceType: "current_page", text: "Data is the knowledge source of AI.", title: "AI data", pageIndex: 1 }],
  rejected: [],
  sufficiency: "sufficient",
  reason: "current page supports the answer"
};

test("current-page summary questions suggest current_page_only or evidence_top_k", () => {
  const planner = new ContextBudgetPlanner();
  const plan = planner.plan({
    query: "这页主要讲什么？",
    questionAnalysis: { intent: "ask_current_page_summary", evidenceNeed: "summary" } as QuestionAnalysis,
    selectedEvidence: evidence,
    tokenEstimate: highPrefill,
    confidence: "high",
    groundingMode: "allow_general_knowledge_with_label",
    mode: "observe_only"
  });
  assert.ok(["current_page_only", "evidence_top_k"].includes(plan.suggestion.recommendedPolicy));
  assert.equal(plan.applied, false);
});

test("precise formula or budget questions do not suggest aggressive compression", () => {
  const planner = new ContextBudgetPlanner();
  const plan = planner.plan({
    query: "3.5 PFLOPS 等于多少 GFLOPS？请写出公式。",
    questionAnalysis: { intent: "ask_formula_or_derivation", evidenceNeed: "exact_formula_or_derivation" } as QuestionAnalysis,
    selectedEvidence: evidence,
    tokenEstimate: highPrefill,
    confidence: "high",
    groundingMode: "allow_general_knowledge_with_label",
    mode: "observe_only"
  });
  assert.equal(plan.suggestion.recommendedPolicy, "full");
});

test("course-grounded mode does not report low risk for budget reductions", () => {
  const planner = new ContextBudgetPlanner();
  const plan = planner.plan({
    query: "这页主要讲什么？",
    questionAnalysis: { intent: "ask_current_page_summary", evidenceNeed: "summary" } as QuestionAnalysis,
    selectedEvidence: evidence,
    tokenEstimate: highPrefill,
    confidence: "high",
    groundingMode: "course_grounded_only",
    mode: "observe_only"
  });
  assert.notEqual(plan.suggestion.risk, "low");
});
