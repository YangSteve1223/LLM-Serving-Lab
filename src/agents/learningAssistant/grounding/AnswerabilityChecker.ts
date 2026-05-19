import type {
  AnswerabilityResult,
  GroundingMode,
  QuestionAnalysis,
  SelectedEvidence
} from "../types.ts";

export class AnswerabilityChecker {
  check(input: {
    question: QuestionAnalysis;
    evidence: SelectedEvidence;
    groundingMode: GroundingMode;
    relevance: AnswerabilityResult["relevance"];
  }): AnswerabilityResult {
    const requiredEvidenceType = requiredType(input.question);
    const hasCurrentPage = input.evidence.selected.some((item) => item.sourceType === "current_page");
    const hasContext = input.evidence.selected.some((item) =>
      ["teacher_script", "speaker_notes", "outline", "neighbor_page"].includes(item.sourceType)
    );
    const hasRetrieval = input.evidence.selected.some((item) => item.sourceType === "wiki" || item.sourceType === "knowledge_base");
    const hardRefusalRisk =
      input.question.evidenceNeed === "exact_formula_or_derivation" ||
      input.question.evidenceNeed === "budget_table" ||
      input.question.evidenceNeed === "unknown_entity";

    if (hardRefusalRisk && input.evidence.sufficiency !== "sufficient") {
      return {
        status: "not_answerable",
        relevance: input.relevance,
        requiredEvidenceType,
        missingEvidence: missingEvidence(input.question),
        shouldRefuseToInvent: true,
        reason: "the question asks for exact formula, numbers, derivation, or budget, but selected evidence is insufficient"
      };
    }

    if (hasRetrieval && input.question.intent === "ask_knowledge_base" && input.evidence.sufficiency !== "insufficient") {
      return {
        status: "answerable_from_retrieval",
        relevance: input.relevance,
        requiredEvidenceType,
        shouldRefuseToInvent: false,
        reason: "retrieved knowledge-base evidence is relevant enough to support the answer"
      };
    }

    if (
      (input.question.evidenceNeed === "ambiguous_reference" || input.question.evidenceNeed === "sufficiency_check") &&
      (hasCurrentPage || hasContext) &&
      input.evidence.sufficiency !== "insufficient"
    ) {
      return {
        status: "answerable_from_context",
        relevance: input.relevance,
        requiredEvidenceType,
        shouldRefuseToInvent: false,
        reason:
          input.question.evidenceNeed === "ambiguous_reference"
            ? "the page contains several possible referents, so the answer should clarify candidates before choosing"
            : "the page gives partial evidence, but the question asks whether the page fully explains or proves the point"
      };
    }

    if (hasCurrentPage && hasContext && /平台大纲|教师讲稿|讲稿|teacher|outline/i.test(input.question.normalizedQuestion)) {
      return {
        status: "answerable_from_context",
        relevance: input.relevance,
        requiredEvidenceType,
        shouldRefuseToInvent: false,
        reason: "platform outline or teacher script is part of the requested evidence"
      };
    }

    if (hasCurrentPage && input.evidence.sufficiency !== "insufficient") {
      return {
        status: "answerable_from_current_page",
        relevance: input.relevance,
        requiredEvidenceType,
        shouldRefuseToInvent: false,
        reason: "the active page contains relevant evidence"
      };
    }

    if (hasRetrieval && input.evidence.sufficiency !== "insufficient") {
      return {
        status: "answerable_from_retrieval",
        relevance: input.relevance,
        requiredEvidenceType,
        shouldRefuseToInvent: false,
        reason: "retrieved knowledge-base evidence is relevant enough to support the answer"
      };
    }

    if (hasContext && input.evidence.sufficiency !== "insufficient") {
      return {
        status: "answerable_from_context",
        relevance: input.relevance,
        requiredEvidenceType,
        shouldRefuseToInvent: false,
        reason: "neighboring context, outline, or teacher script contains relevant evidence"
      };
    }

    if (input.groundingMode === "allow_general_knowledge_with_label" && input.question.likelyNeedsGeneralKnowledge && !hardRefusalRisk) {
      return {
        status: "answerable_from_general_knowledge",
        relevance: input.relevance,
        requiredEvidenceType,
        shouldRefuseToInvent: false,
        reason: "course evidence is weak, but the question is a common conceptual question that can be answered as general knowledge with a label"
      };
    }

    return {
      status: "not_answerable",
      relevance: input.relevance,
      requiredEvidenceType,
      missingEvidence: missingEvidence(input.question),
      shouldRefuseToInvent: true,
      reason: "no selected evidence is sufficient for this question"
    };
  }
}

function requiredType(question: QuestionAnalysis): AnswerabilityResult["requiredEvidenceType"] {
  if (question.evidenceNeed === "budget_table") return "budget_table";
  if (question.evidenceNeed === "exact_formula_or_derivation") return "exact_formula";
  if (question.evidenceNeed === "numeric_calculation_from_page" || question.evidenceNeed === "numeric_extraction") return "numerical_derivation";
  if (question.evidenceNeed === "ambiguous_reference") return "unknown";
  switch (question.intent) {
    case "ask_current_page_summary":
      return "summary";
    case "ask_comparison":
      return "comparison";
    case "ask_exercise":
      return "example";
    case "ask_concept":
    case "ask_current_page_concept":
    case "ask_knowledge_base":
      return "definition";
    default:
      return "unknown";
  }
}

function missingEvidence(question: QuestionAnalysis): string[] {
  const missing: string[] = [];
  if (question.keyEntities.length > 0) missing.push(`definition or source mention for ${question.keyEntities.join(", ")}`);
  if (question.asksForFormula || question.evidenceNeed === "exact_formula_or_derivation") missing.push("explicit formula or derivation");
  if (question.evidenceNeed === "numeric_calculation_from_page" || question.evidenceNeed === "numeric_extraction") missing.push("numerical data or calculation steps");
  if (question.asksForBudget || question.evidenceNeed === "budget_table") missing.push("budget table or cost data");
  if (missing.length === 0) missing.push("relevant current-page, teacher-script, or knowledge-base evidence");
  return missing;
}
