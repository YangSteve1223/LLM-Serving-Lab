import type { LearningContext } from "../types.ts";
import { MisconceptionDetector } from "./MisconceptionDetector.ts";
import type { DiagnosisInput, LearningDiagnosis, LearningIntent, LearningIntervention, MasteryEstimate } from "./types.ts";
import { containsLoose, extractConcepts, pageId, sourceText, summarize } from "./learningLoopUtils.ts";

export class LearningDiagnosisAgent {
  private readonly misconceptionDetector = new MisconceptionDetector();

  diagnose(input: DiagnosisInput): LearningDiagnosis {
    const query = input.query.trim();
    const contextText = sourceText(input.learningContext);
    const memory = input.learnerMemory;
    const misconceptions = this.misconceptionDetector.detect({ text: query, context: input.learningContext });
    const concepts = extractConcepts(input.learningContext, 5);
    const confusionPoints = inferConfusionPoints(query, concepts, contextText);
    const intent = inferIntent(query, misconceptions);
    const masteryEstimate = inferMastery(query, intent, misconceptions, memory?.weakConcepts ?? []);
    const prerequisiteGaps = inferPrerequisiteGaps(query, concepts);
    const recommendedIntervention = recommendIntervention(intent, masteryEstimate, misconceptions);

    return {
      intent,
      masteryEstimate,
      confusionPoints,
      prerequisiteGaps,
      possibleMisconceptions: misconceptions,
      recommendedIntervention,
      reason: buildReason(intent, masteryEstimate, confusionPoints, misconceptions),
      evidenceRefs: buildEvidenceRefs(input.learningContext, input.chatHistory)
    };
  }
}

function inferIntent(query: string, misconceptions: string[]): LearningIntent {
  if (/小测|测试|题|练习|检查理解|考我/.test(query)) return "quiz_request";
  if (/资源|视频|推荐|资料|看什么/.test(query)) return "resource_request";
  if (/复习|回顾|记住|忘了/.test(query)) return "review";
  if (/例子|举例|类比|比喻/.test(query)) return "example_needed";
  if (/怎么算|计算|换算|公式|推导/.test(query)) return "calculation_needed";
  if (misconceptions.length > 0 || /是不是|等于|就是/.test(query)) return "misconception";
  if (/不懂|没懂|困惑|混淆|区别|什么意思|是什么/.test(query)) return "concept_confusion";
  if (/拓展|更深入|延伸|课外/.test(query)) return "extension";
  if (/总结|主要讲|核心|概括/.test(query)) return "summary";
  return "unknown";
}

function inferMastery(query: string, intent: LearningIntent, misconceptions: string[], weakConcepts: string[]): MasteryEstimate {
  if (misconceptions.length > 0) return "low";
  if (/完全不懂|一点也不懂|不会/.test(query)) return "low";
  if (intent === "concept_confusion" || intent === "calculation_needed") return "medium";
  if (weakConcepts.some((concept) => containsLoose(query, concept))) return "low";
  if (intent === "summary" || intent === "extension") return "medium";
  return "unknown";
}

function inferConfusionPoints(query: string, concepts: string[], contextText: string): string[] {
  const matched = concepts.filter((concept) => containsLoose(query, concept));
  if (matched.length) return matched.map((concept) => `${concept} 的含义或作用`);
  if (/区别|混淆/.test(query) && concepts.length >= 2) return [`${concepts.slice(0, 3).join("、")} 的区别`];
  if (/不懂|什么意思|是什么/.test(query) && concepts[0]) return [`${concepts[0]} 的概念理解`];
  const firstLine = contextText.split(/\r?\n/).find((line) => line.trim().length > 2);
  return firstLine ? [summarize(firstLine, 40)] : [];
}

function inferPrerequisiteGaps(query: string, concepts: string[]): string[] {
  if (/RAG|检索|证据/.test(query)) return ["检索、证据和生成之间的关系"];
  if (/FLOPS|算力|PFLOPS|GFLOPS/.test(query)) return ["算力单位换算"];
  if (/mAP|F1|PSNR|SSIM|LPIPS/.test(query)) return ["评价指标的基本含义"];
  if (/区别|混淆/.test(query) && concepts.length > 1) return [`${concepts.slice(0, 2).join(" 与 ")} 的前置定义`];
  return [];
}

function recommendIntervention(intent: LearningIntent, mastery: MasteryEstimate, misconceptions: string[]): LearningIntervention {
  if (misconceptions.length > 0) return "worked_example";
  if (intent === "quiz_request") return "micro_quiz";
  if (intent === "resource_request") return "resource_recommendation";
  if (intent === "review") return "review_plan";
  if (intent === "example_needed") return "analogy";
  if (intent === "calculation_needed") return "worked_example";
  if (mastery === "low") return "micro_quiz";
  if (intent === "concept_confusion") return "analogy";
  return "explain";
}

function buildReason(
  intent: LearningIntent,
  mastery: MasteryEstimate,
  confusionPoints: string[],
  misconceptions: string[]
): string {
  if (misconceptions.length) return `学生表述中出现可能误解：${misconceptions.join("；")}`;
  if (confusionPoints.length) return `问题指向 ${confusionPoints.join("、")}，当前掌握度估计为 ${mastery}。`;
  return `根据问题表达，诊断为 ${intent}，掌握度估计为 ${mastery}。`;
}

function buildEvidenceRefs(context: LearningContext, chatHistory: Array<{ role: string; content: string }> | undefined) {
  const refs: LearningDiagnosis["evidenceRefs"] = [];
  if (context.currentPage?.text) {
    refs.push({ sourceType: "current_page", sourceId: pageId(context), textPreview: summarize(context.currentPage.text) });
  }
  if (context.teacherScript?.text && context.teacherScript.source !== "missing") {
    refs.push({ sourceType: "teacher_script", sourceId: context.teacherScript.source, textPreview: summarize(context.teacherScript.text) });
  }
  if (chatHistory?.length) {
    refs.push({ sourceType: "chat_history", textPreview: summarize(chatHistory.slice(-3).map((item) => item.content).join(" / ")) });
  }
  return refs;
}
