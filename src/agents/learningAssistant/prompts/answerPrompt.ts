import type {
  AnswerabilityResult,
  EvidenceCandidate,
  GroundingMode,
  QuestionAnalysis,
  StudentModel,
  TeachingPolicy
} from "../types.ts";

export function buildAnswerPrompt(input: {
  query: string;
  questionAnalysis: QuestionAnalysis;
  student: StudentModel;
  policy: TeachingPolicy;
  selectedEvidence: EvidenceCandidate[];
  rejectedEvidenceSummary: string;
  answerability: AnswerabilityResult;
  groundingMode: GroundingMode;
  actualSkillsSummary?: string;
  conceptResolutionSummary?: string;
}): string {
  const evidenceText = input.selectedEvidence
    .map((evidence, index) => {
      return `[${index + 1}] ${evidence.sourceType} / ${evidence.title ?? "untitled"} / ${
        evidence.sectionTitle ?? "section"
      } / ${evidence.chunkId ?? evidence.sourceId ?? ""}\n${evidence.text}`;
    })
    .join("\n\n");

  return [
    `学生问题：${input.query}`,
    `问题分析：${JSON.stringify(input.questionAnalysis, null, 2)}`,
    `教学策略：${JSON.stringify(input.policy, null, 2)}`,
    `学生画像：${JSON.stringify(input.student, null, 2)}`,
    `可回答性：${JSON.stringify(input.answerability, null, 2)}`,
    `groundingMode：${input.groundingMode}`,
    `actualSkillCalls：${input.actualSkillsSummary ?? "none"}`,
    `conceptResolution：${input.conceptResolutionSummary ?? "none"}`,
    `selectedEvidence：\n${evidenceText || "无可用证据"}`,
    `rejectedEvidenceSummary：${input.rejectedEvidenceSummary}`,
    [
      "请生成面向学生的自然回答。",
      "必须基于 selectedEvidence，不要机械拼接 raw context。",
      "如果 answerability.shouldRefuseToInvent 为 true，必须明确说明资料不足，不能编造公式、数值推导、预算表或专有数据。",
      "如果 status 是 answerable_from_general_knowledge，必须说明当前页或知识库没有直接依据，下面基于通用知识解释。",
      "actualSkillCalls 才是本次系统真实调用的 skill。知识库证据里出现的 answer_query_and_writeback、compile_wiki_pages 等名称，只能表述为“资料中提到的 skill”，不能说本次实际调用了它们。",
      "current_page 是当前 PPT 页；outline、neighbor_page 是同一个 PPT/deck 的课件上下文；wiki、knowledge_base 才是外部 markdown 知识库。不要把 PPT 后续页说成“知识库中的延伸内容”。",
      "如果 conceptResolution 不为 none，回答时先说明“我先按 X 检索”；如果有 alternatives，也说明“如果你指的是 Y，请告诉我”。",
      "如果 questionAnalysis.evidenceNeed 是 ambiguous_reference，必须先说明“这个指标/概念指代不清”，列出 selectedEvidence 中可见的候选项，并追问学生想问哪一个；不要直接随机选一个指标当作答案。",
      "如果 questionAnalysis.evidenceNeed 是 sufficiency_check，必须做充分性检查：先说明当前页能部分说明什么，再说明仅凭当前页不能完全确认哪些训练流程、参数来源或证明边界；不要说“完全能说明”或“基本能完全说明”。",
      "如果问题要求结合平台大纲和教师讲稿，回答必须分清：当前页说什么、教师讲稿补充什么、平台大纲如何定位这一页。",
      "不要把页码当作主题，不要说“这页主要围绕 1 展开”，不要引用不能支持答案的来源。",
      "回答要简洁、学习向、贴合问题。"
    ].join("\n")
  ].join("\n\n");
}
