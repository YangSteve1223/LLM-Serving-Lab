import type { AnswerStylePreference, ContextSummary, LearningContext, StudentModel } from "../types.ts";

export class StudentModeler {
  infer(query: string, context: LearningContext = {}, summary?: ContextSummary): StudentModel {
    const profile = context.learner?.profile ?? {};
    const inferredState = context.learner?.inferredState ?? {};
    const combined = `${JSON.stringify(profile)} ${JSON.stringify(inferredState)} ${query}`.toLowerCase();
    const reasons: string[] = [];

    let level: StudentModel["level"] = profile.level ?? "unknown";
    if (!level || level === "unknown") {
      if (containsAny(combined, ["beginner", "novice", "初学", "零基础", "入门", "基础薄弱"])) level = "beginner";
      else if (containsAny(combined, ["advanced", "expert", "进阶", "高阶", "熟悉", "有经验"])) level = "advanced";
      else if (containsAny(combined, ["intermediate", "中级", "了解一些"])) level = "intermediate";
      else level = "unknown";
    }
    if (level !== "unknown") reasons.push(`learner level is ${level}`);

    const isLikelyStuck =
      inferredState.confusionLevel === "high" ||
      containsAny(query, ["不懂", "看不懂", "卡住", "没明白", "什么意思", "怎么理解", "confused", "stuck"]);
    if (isLikelyStuck) reasons.push("query or learner state indicates confusion");

    const prefersConciseAnswer = containsAny(combined, ["简洁", "简单说", "短一点", "concise", "brief"]);
    if (prefersConciseAnswer) reasons.push("learner appears to prefer concise answers");

    const stylePreference = normalizeStylePreference(profile.stylePreference);
    if (stylePreference !== "auto") reasons.push(`style preference is ${stylePreference}`);

    const needsScaffolding =
      level === "beginner" ||
      isLikelyStuck ||
      Boolean(summary?.queryReferencesCurrentPage && summary.usableContextScore > 0.35);
    if (needsScaffolding) reasons.push("answer should scaffold from available learning context");

    return {
      level,
      isLikelyStuck,
      prefersConciseAnswer,
      stylePreference,
      needsScaffolding,
      reasons
    };
  }
}

function normalizeStylePreference(value: unknown): AnswerStylePreference {
  const allowed = new Set<AnswerStylePreference>([
    "auto",
    "direct",
    "concise",
    "step_by_step",
    "analogy",
    "socratic",
    "exam_focused",
    "deep_dive",
    "beginner_friendly"
  ]);
  return typeof value === "string" && allowed.has(value as AnswerStylePreference)
    ? (value as AnswerStylePreference)
    : "auto";
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term.toLowerCase()));
}
