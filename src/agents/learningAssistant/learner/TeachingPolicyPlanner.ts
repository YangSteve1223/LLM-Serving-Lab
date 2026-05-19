import type { ContextSummary, StudentModel, TeachingPolicy } from "../types.ts";

export class TeachingPolicyPlanner {
  plan(query: string, summary: ContextSummary, student: StudentModel): TeachingPolicy {
    const override = student.stylePreference !== "auto";
    const style = override ? styleFromPreference(student.stylePreference) : chooseAutoStyle(query, summary, student);
    const depth = override ? depthFromPreference(student.stylePreference, student) : chooseAutoDepth(query, summary, student);
    const source = override ? "user_override" : "auto";
    const shouldUseCurrentPage =
      summary.hasCurrentPage &&
      ["ask_current_page", "ask_summary", "ask_concept", "ask_beyond_current_page", "ask_exercise", "unknown"].includes(
        summary.detectedIntent
      ) &&
      (summary.queryReferencesCurrentPage || summary.pageQueryOverlapScore > 0 || summary.detectedIntent !== "ask_unrelated");
    const shouldUseOutline = summary.outlinePath.length > 0;
    const shouldUseTeacherScript = summary.hasTeacherScript && shouldUseCurrentPage;
    const shouldUseNeighborPages = summary.hasNeighborPages && shouldUseCurrentPage;
    const currentContextWeak = !summary.hasCurrentPage || summary.usableContextScore < 0.35 || summary.pageQueryOverlapScore < 0.03;
    const asksForDetails = /公式|推导|证明|具体|完整|来源|依据|reference|cite/i.test(query);
    const shouldRetrieveKnowledge =
      summary.queryRequestsKnowledgeBase ||
      summary.detectedIntent === "ask_beyond_current_page" ||
      (summary.detectedIntent === "ask_concept" && (currentContextWeak || asksForDetails)) ||
      summary.detectedIntent === "ask_unrelated";

    const reasons = [...summary.reasons, ...student.reasons];
    if (override) reasons.push(`user selected answer style ${student.stylePreference}`);
    if (shouldUseCurrentPage) reasons.push("current page is relevant enough to ground the answer");
    if (shouldRetrieveKnowledge) reasons.push("knowledge retrieval is useful for evidence or context gap handling");
    if (!shouldRetrieveKnowledge && shouldUseCurrentPage) reasons.push("current page context appears sufficient, retrieval can be skipped");

    return {
      depth,
      style,
      source,
      shouldUseCurrentPage,
      shouldUseOutline,
      shouldUseTeacherScript,
      shouldUseNeighborPages,
      shouldRetrieveKnowledge,
      shouldCallSkill: shouldRetrieveKnowledge,
      answerLanguage: chooseLanguage(query, summary, student),
      reasons
    };
  }
}

function chooseAutoDepth(query: string, summary: ContextSummary, student: StudentModel): TeachingPolicy["depth"] {
  if (student.prefersConciseAnswer || /简单说|一句话|brief|short|概括/i.test(query)) return "brief";
  if (student.level === "advanced" || /深入|原理|机制|完整|系统|deep|derive/i.test(query)) return "deep";
  if (summary.detectedIntent === "ask_summary") return "brief";
  return "normal";
}

function chooseAutoStyle(query: string, summary: ContextSummary, student: StudentModel): TeachingPolicy["style"] {
  if (/考试|考点|题型|得分|exam/i.test(query)) return "exam_focused";
  if (/引导|提示|自己想|socratic/i.test(query)) return "socratic";
  if (student.isLikelyStuck) return "step_by_step";
  if (student.level === "beginner") return "analogy";
  if (/步骤|怎么做|流程|如何|process|step/i.test(query)) return "step_by_step";
  if (/为什么|why/i.test(query)) return "guided";
  if (/深入|原理|机制|deep/i.test(query)) return "deep_dive";
  return "direct";
}

function styleFromPreference(preference: StudentModel["stylePreference"]): TeachingPolicy["style"] {
  switch (preference) {
    case "step_by_step":
      return "step_by_step";
    case "analogy":
    case "beginner_friendly":
      return "analogy";
    case "socratic":
      return "socratic";
    case "exam_focused":
      return "exam_focused";
    case "deep_dive":
      return "deep_dive";
    case "concise":
      return "direct";
    default:
      return "direct";
  }
}

function depthFromPreference(
  preference: StudentModel["stylePreference"],
  student: StudentModel
): TeachingPolicy["depth"] {
  if (preference === "concise") return "brief";
  if (preference === "deep_dive") return "deep";
  if (student.level === "advanced") return "deep";
  return "normal";
}

function chooseLanguage(query: string, summary: ContextSummary, student: StudentModel): "zh" | "en" {
  const language = summary ? undefined : undefined;
  void language;
  if (/^[\x00-\x7F\s.,?!:;'"()/-]+$/.test(query) && /[a-zA-Z]{3,}/.test(query)) return "en";
  return "zh";
}
