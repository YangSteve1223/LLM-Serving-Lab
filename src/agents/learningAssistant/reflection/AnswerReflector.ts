import type { ContextSummary, RetrievedChunk, TeachingPolicy } from "../types.ts";

export class AnswerReflector {
  assess(input: {
    answer: string;
    summary: ContextSummary;
    evidence: RetrievedChunk[];
    policy: TeachingPolicy;
  }): { confidence: "low" | "medium" | "high"; notes: string[]; uncertainty?: string } {
    const notes: string[] = [];
    const answerStatesInsufficient = /没有足够依据|资料不足|不确定|insufficient|not enough/i.test(input.answer);
    if (answerStatesInsufficient) {
      return {
        confidence: "low",
        notes: ["answer explicitly states insufficient support"],
        uncertainty: "当前页、讲稿或知识库证据不足，已在回答中说明。"
      };
    }

    if (input.policy.shouldUseCurrentPage && input.summary.hasCurrentPage) {
      notes.push("answer can be grounded in current page context");
    }
    if (input.evidence.length > 0) notes.push("answer has retrieved knowledge-base evidence");
    if (input.policy.shouldUseTeacherScript && input.summary.hasTeacherScript) {
      notes.push("answer can use teacher script or speaker notes");
    }

    if (input.evidence.length > 0 && input.summary.hasCurrentPage) return { confidence: "high", notes };
    if (input.summary.hasCurrentPage || input.evidence.length > 0) return { confidence: "medium", notes };
    return {
      confidence: "low",
      notes: ["no strong local context or retrieved evidence"],
      uncertainty: "没有足够本地上下文或检索证据。"
    };
  }
}
