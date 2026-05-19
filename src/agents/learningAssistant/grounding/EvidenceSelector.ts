import { lexicalOverlap } from "../analysis/QuestionAnalyzer.ts";
import type { EvidenceCandidate, LearningContext, QuestionAnalysis, RetrievedChunk, SelectedEvidence } from "../types.ts";

export type EvidenceSelectorOptions = {
  minCurrentPageScore?: number;
  minContextScore?: number;
  minKnowledgeBaseScore?: number;
};

export class EvidenceSelector {
  select(
    query: string,
    context: LearningContext,
    retrievedChunks: RetrievedChunk[],
    question: QuestionAnalysis,
    options: EvidenceSelectorOptions = {}
  ): SelectedEvidence {
    const minCurrentPageScore = options.minCurrentPageScore ?? 0.08;
    const minContextScore = options.minContextScore ?? 0.18;
    const minKnowledgeBaseScore = options.minKnowledgeBaseScore ?? 3.2;
    const candidates = buildCandidates(context, retrievedChunks);
    const selected: EvidenceCandidate[] = [];
    const rejected: SelectedEvidence["rejected"] = [];

    for (const candidate of candidates) {
      const score = candidate.relevanceScore ?? lexicalOverlap(query, `${candidate.title ?? ""}\n${candidate.text}`);
      const enriched = { ...candidate, relevanceScore: score };
      const requiredScore =
        candidate.sourceType === "current_page"
          ? minCurrentPageScore
          : candidate.sourceType === "wiki" || candidate.sourceType === "knowledge_base"
            ? minKnowledgeBaseScore
            : minContextScore;

      if ((candidate.sourceType === "wiki" || candidate.sourceType === "knowledge_base") && !hasSubstantiveBody(enriched)) {
        rejected.push({ evidence: enriched, reason: "knowledge-base chunk is title-only or too thin to support a concrete answer" });
        continue;
      }

      if (isCurrentPageEvidenceNeed(question) && candidate.sourceType === "current_page") {
        selected.push(enriched);
        continue;
      }

      if (isCurrentPageEvidenceNeed(question) && ["teacher_script", "speaker_notes", "outline"].includes(candidate.sourceType)) {
        selected.push(enriched);
        continue;
      }

      if (question.asksForExactEvidence && !hasExactEvidence(enriched, question)) {
        rejected.push({ evidence: enriched, reason: "does not contain the requested exact entity, formula, number, or table evidence" });
        continue;
      }

      if (score >= requiredScore) {
        selected.push(enriched);
      } else {
        rejected.push({
          evidence: enriched,
          reason: `relevance ${formatScore(score)} below threshold ${formatScore(requiredScore)}`
        });
      }
    }

    if (selected.some((item) => item.sourceType === "current_page") && !question.asksForExactEvidence) {
      for (const candidate of candidates) {
        if (
          ["teacher_script", "speaker_notes", "outline"].includes(candidate.sourceType) &&
          !selected.some((item) => item.sourceType === candidate.sourceType && item.sourceId === candidate.sourceId)
        ) {
          selected.push({
            ...candidate,
            relevanceScore: candidate.relevanceScore ?? lexicalOverlap(query, `${candidate.title ?? ""}\n${candidate.text}`)
          });
        }
      }
    }

    const sufficiency = decideSufficiency(selected, question);
    return {
      selected: selected.slice(0, question.intent === "ask_knowledge_base" ? 5 : 6),
      rejected,
      sufficiency,
      reason: describeSufficiency(sufficiency, selected, rejected, question)
    };
  }
}

function buildCandidates(context: LearningContext, retrievedChunks: RetrievedChunk[]): EvidenceCandidate[] {
  const candidates: EvidenceCandidate[] = [];
  if (context.currentPage?.text?.trim()) {
    candidates.push({
      sourceType: "current_page",
      sourceId: context.currentPage.id,
      title: context.currentPage.semanticTitle ?? context.currentPage.title,
      pageIndex: context.currentPage.pageIndex,
      text: context.currentPage.text,
      metadata: {
        pageLabel: context.currentPage.pageLabel,
        bulletPoints: context.currentPage.bulletPoints,
        semanticTitle: context.currentPage.semanticTitle,
        fileName: basenameFromPath(context.material?.filePath) ?? context.material?.title,
        previewImageUrl: context.currentPage.previewImageUrl ?? context.currentPage.preview?.imageUrl,
        previewStatus: context.currentPage.preview?.status
      }
    });
  }
  if (context.teacherScript?.text?.trim() && context.teacherScript.source !== "missing" && context.teacherScript.source !== "auto_summary") {
    candidates.push({
      sourceType: context.teacherScript.source === "speaker_notes" ? "speaker_notes" : "teacher_script",
      sourceId: context.currentPage?.id,
      title: context.teacherScript.source,
      pageIndex: context.currentPage?.pageIndex,
      text: context.teacherScript.text
    });
  }
  for (const neighbor of [context.neighborPages?.previous, context.neighborPages?.next]) {
    if (neighbor?.summary?.trim()) {
      candidates.push({
        sourceType: "neighbor_page",
        title: neighbor.title,
        pageIndex: neighbor.pageIndex,
        text: neighbor.summary
      });
    }
  }
  if (context.outline?.items.length) {
    candidates.push({
      sourceType: "outline",
      sourceId: context.outline.source,
      title: `${context.outline.source} outline`,
      text: context.outline.items
        .slice(0, 10)
        .map((item) => `${item.title} ${item.summary ?? ""}`)
        .join("\n")
    });
  }
  for (const chunk of retrievedChunks) {
    candidates.push({
      sourceType: chunk.sourceType,
      sourceId: chunk.sourceId,
      title: chunk.title ?? chunk.fileName,
      chunkId: chunk.chunkId,
      sectionTitle: chunk.sectionTitle,
      text: chunk.text,
      relevanceScore: chunk.score,
      metadata: chunk.metadata
    });
  }
  return candidates;
}

function basenameFromPath(filePath: string | undefined): string | undefined {
  return filePath?.split(/[\\/]/).filter(Boolean).at(-1);
}

function hasExactEvidence(candidate: EvidenceCandidate, question: QuestionAnalysis): boolean {
  const text = `${candidate.title ?? ""}\n${candidate.sectionTitle ?? ""}\n${candidate.text}`;
  const hasEntity = question.keyEntities.length === 0 || question.keyEntities.some((entity) => text.toLowerCase().includes(entity.toLowerCase()));
  const hasFormula = !question.asksForFormula || /[=≈≤≥+\-*/^∑√]|公式|推导|equation|formula/i.test(text);
  const hasBudget = !question.asksForBudget || /预算|成本|价格|报价|金额|table|budget|cost|￥|\$|\d+\s*(元|万|%)/i.test(text);
  const hasNumbers = !question.asksForNumbers || /\d/.test(text);
  return hasEntity && hasFormula && hasBudget && hasNumbers;
}

function hasSubstantiveBody(candidate: EvidenceCandidate): boolean {
  const text = (candidate.text ?? "").replace(/\s+/g, " ").trim();
  if (text.length < 80) return false;
  if (/^#{1,6}\s+\S{1,50}$/.test(text)) return false;
  return true;
}

function decideSufficiency(selected: EvidenceCandidate[], question: QuestionAnalysis): SelectedEvidence["sufficiency"] {
  if (selected.length === 0) return "insufficient";
  if (question.evidenceNeed === "exact_formula_or_derivation" || question.evidenceNeed === "budget_table" || question.evidenceNeed === "unknown_entity") {
    return selected.some((evidence) => hasExactEvidence(evidence, question)) ? "sufficient" : "insufficient";
  }
  if (question.evidenceNeed === "ambiguous_reference" || question.evidenceNeed === "sufficiency_check") return "partially_sufficient";
  if (isCurrentPageEvidenceNeed(question)) return "sufficient";
  return selected.length >= 2 ? "sufficient" : "partially_sufficient";
}

function describeSufficiency(
  sufficiency: SelectedEvidence["sufficiency"],
  selected: EvidenceCandidate[],
  rejected: SelectedEvidence["rejected"],
  question: QuestionAnalysis
): string {
  if (sufficiency === "sufficient") return `selected ${selected.length} relevant evidence item(s)`;
  if (question.evidenceNeed === "exact_formula_or_derivation" || question.evidenceNeed === "budget_table" || question.evidenceNeed === "unknown_entity") {
    return "selected evidence does not prove the requested exact formula, numbers, derivation, or budget";
  }
  if (selected.length > 0) return `only partial support found; rejected ${rejected.length} weak candidate(s)`;
  return `no supporting evidence selected; rejected ${rejected.length} weak candidate(s)`;
}

function isCurrentPageEvidenceNeed(question: QuestionAnalysis): boolean {
  const currentPageComparison = question.evidenceNeed === "comparison" && question.intent === "ask_current_page_concept";
  return (
    question.intent === "ask_current_page_summary" ||
    question.intent === "ask_current_page_concept" ||
    [
      "summary",
      "concept_explanation",
      "socratic_guidance",
      "analogy",
      "numeric_extraction",
      "numeric_calculation_from_page",
      "chart_trend",
      "ambiguous_reference",
      "sufficiency_check"
    ].includes(question.evidenceNeed) ||
    currentPageComparison
  );
}

function formatScore(score: number): string {
  return Number(score).toFixed(2);
}
