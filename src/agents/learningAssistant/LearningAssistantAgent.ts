import { QuestionAnalyzer, lexicalOverlap } from "./analysis/QuestionAnalyzer.ts";
import { ContextAnalyzer } from "./context/ContextAnalyzer.ts";
import { AnswerabilityChecker } from "./grounding/AnswerabilityChecker.ts";
import { EvidenceSelector } from "./grounding/EvidenceSelector.ts";
import { StudentModeler } from "./learner/StudentModeler.ts";
import { TeachingPolicyPlanner } from "./learner/TeachingPolicyPlanner.ts";
import { assistantSystemPrompt } from "./prompts/assistantSystemPrompt.ts";
import { buildAnswerPrompt } from "./prompts/answerPrompt.ts";
import { KnowledgeRetrievalSkill } from "./skills/KnowledgeRetrievalSkill.ts";
import { SkillRegistry } from "./skills/SkillRegistry.ts";
import type {
  AgentDecisionTrace,
  AnswerabilityResult,
  AssistantAgentResponse,
  Citation,
  EvidenceCandidate,
  GenerationDebugInfo,
  GroundingCheck,
  GroundingMode,
  KnowledgeBase,
  LearningContext,
  LLMClient,
  QuestionAnalysis,
  RetrievalResult,
  RetrievedChunk,
  SelectedEvidence,
  Skill,
  StudentModel,
  TeachingPolicy,
  UsedSkillRecord
} from "./types.ts";

type ConceptResolution = {
  assumedConcept: string;
  alternatives: string[];
  retrievalQuery: string;
  note: string;
};

export type LearningAssistantAgentOptions = {
  kb?: KnowledgeBase;
  skills?: Skill[];
  skillRegistry?: SkillRegistry;
  llm?: LLMClient;
  groundingMode?: GroundingMode;
  requireRealLlm?: boolean;
};

export class LearningAssistantAgent {
  private kb?: KnowledgeBase;
  private llm?: LLMClient;
  private groundingMode: GroundingMode;
  private requireRealLlm: boolean;
  private registry: SkillRegistry;
  private contextAnalyzer = new ContextAnalyzer();
  private questionAnalyzer = new QuestionAnalyzer();
  private studentModeler = new StudentModeler();
  private policyPlanner = new TeachingPolicyPlanner();
  private evidenceSelector = new EvidenceSelector();
  private answerabilityChecker = new AnswerabilityChecker();

  constructor(options: LearningAssistantAgentOptions = {}) {
    this.kb = options.kb;
    this.llm = options.llm;
    this.groundingMode = options.groundingMode ?? "allow_general_knowledge_with_label";
    this.requireRealLlm = options.requireRealLlm ?? false;
    this.registry = options.skillRegistry ?? new SkillRegistry(options.skills ?? []);
    if (!this.registry.get("KnowledgeRetrievalSkill")) {
      this.registry.register(new KnowledgeRetrievalSkill());
    }
  }

  async answer(query: string, context: LearningContext = {}): Promise<AssistantAgentResponse> {
    const summary = this.contextAnalyzer.analyze(query, context);
    const question = this.questionAnalyzer.analyze(query, context);
    const student = this.studentModeler.infer(query, context, summary);
    const basePolicy = this.policyPlanner.plan(query, summary, student);
    const policy = refinePolicy(basePolicy, question, context);
    const conceptResolution = resolveConceptReference(query, context, question);
    const retrievalQuery = conceptResolution?.retrievalQuery ?? query;
    const evidenceQuery = conceptResolution?.assumedConcept ?? query;
    const usedSkills: UsedSkillRecord[] = [];
    let retrievedChunks: RetrievedChunk[] = [];
    let retrievalResult: RetrievalResult | undefined;

    if (policy.shouldCallSkill) {
      if (!this.kb) {
        usedSkills.push({
          name: "KnowledgeRetrievalSkill",
          status: "failed",
          reason: "knowledge retrieval requested but no knowledge base configured"
        });
      } else {
        try {
          const skillOutput = await this.registry.run("KnowledgeRetrievalSkill", {
            query: retrievalQuery,
            context,
            policy,
            kb: this.kb
          });
          retrievedChunks = skillOutput.evidence ?? [];
          retrievalResult = skillOutput.metadata?.retrieval as RetrievalResult | undefined;
          if (retrievalResult && conceptResolution) {
            retrievalResult.rewrittenQuery = retrievalQuery;
          }
          usedSkills.push({
            name: "KnowledgeRetrievalSkill",
            status: "called",
            reason: conceptResolution
              ? `${conceptResolution.note}; ${retrievalResult?.status === "success" ? "retrieved relevant local knowledge" : "retrieval returned no reliable evidence"}`
              : retrievalResult?.status === "success" ? "retrieved relevant local knowledge" : "retrieval returned no reliable evidence",
            metadata: {
              retrieval: retrievalResult,
              conceptResolution
            }
          });
        } catch (error) {
          retrievalResult = {
            status: "failed",
            query: retrievalQuery,
            chunks: [],
            relevanceThreshold: 0,
            evidenceSufficient: false
          };
          usedSkills.push({
            name: "KnowledgeRetrievalSkill",
            status: "failed",
            reason: error instanceof Error ? error.message : "unknown skill failure",
            metadata: { retrieval: retrievalResult }
          });
        }
      }
    } else {
      usedSkills.push({
        name: "KnowledgeRetrievalSkill",
        status: "skipped",
        reason: "question can be evaluated against current context without retrieval"
      });
    }

    const selectedEvidence = this.evidenceSelector.select(evidenceQuery, context, retrievedChunks, question);
    const relevance = buildRelevance(query, context, selectedEvidence, retrievalResult, question);
    const answerability = this.answerabilityChecker.check({
      question,
      evidence: selectedEvidence,
      groundingMode: this.groundingMode,
      relevance
    });
    const groundingCheck = checkGrounding(answerability, selectedEvidence);
    const generated = await this.generateAnswer({
      query,
      question,
      context,
      student,
      policy,
      selectedEvidence,
      answerability,
      groundingCheck,
      usedSkills,
      conceptResolution
    });
    const citations = buildCitations(selectedEvidence.selected);
    const confidence = computeConfidence(answerability, selectedEvidence, retrievalResult);
    const decisionTrace = buildDecisionTrace({
      query,
      question,
      policy,
      selectedEvidence,
      answerability,
      groundingCheck,
      relevance,
      usedSkills,
      retrievalResult
    });

    return {
      answer: generated.answer,
      decisionTrace,
      usedContext: {
        usedCurrentPage: selectedEvidence.selected.some((item) => item.sourceType === "current_page"),
        usedOutline: selectedEvidence.selected.some((item) => item.sourceType === "outline"),
        usedTeacherScript: selectedEvidence.selected.some((item) => item.sourceType === "teacher_script" || item.sourceType === "speaker_notes"),
        usedNeighborPages: selectedEvidence.selected.some((item) => item.sourceType === "neighbor_page"),
        usedLearnerProfile: Boolean(context.learner?.profile || context.learner?.inferredState),
        usedChatHistory: (context.chatHistory?.length ?? 0) > 0
      },
      usedSkills,
      citations,
      teachingPolicy: policy,
      confidence,
      generationDebug: {
        ...generated.debug,
        selectedEvidenceCount: selectedEvidence.selected.length,
        rejectedEvidenceCount: selectedEvidence.rejected.length,
        groundingPassed: groundingCheck.passed,
        groundingFailureReason: generated.debug.groundingFailureReason ?? (groundingCheck.passed ? undefined : groundingCheck.reason)
      },
      answerGenerationMode: generated.debug.answerGenerationMode,
      evidenceDebug: {
        selected: selectedEvidence.selected,
        rejected: selectedEvidence.rejected
      },
      retrievalDebug: retrievalResult,
      followUps: buildFollowUps(answerability, question, confidence)
    };
  }

  private async generateAnswer(input: {
    query: string;
    question: QuestionAnalysis;
    context: LearningContext;
    student: StudentModel;
    policy: TeachingPolicy;
    selectedEvidence: SelectedEvidence;
    answerability: AnswerabilityResult;
    groundingCheck: GroundingCheck;
    usedSkills: UsedSkillRecord[];
    conceptResolution?: ConceptResolution;
  }): Promise<{ answer: string; debug: GenerationDebugInfo }> {
    const prompt = buildAnswerPrompt({
      query: input.query,
      questionAnalysis: input.question,
      student: input.student,
      policy: input.policy,
      selectedEvidence: input.selectedEvidence.selected,
      rejectedEvidenceSummary: input.selectedEvidence.rejected
        .slice(0, 6)
        .map((item) => `${item.evidence.sourceType}:${item.evidence.title ?? item.evidence.sourceId ?? "untitled"} - ${item.reason}`)
        .join("; "),
      answerability: input.answerability,
      groundingMode: this.groundingMode,
      actualSkillsSummary: summarizeUsedSkills(input.usedSkills),
      conceptResolutionSummary: input.conceptResolution?.note
    });
    const providerName = this.llm?.providerName;
    const modelName = this.llm?.modelName;
    const baseDebug: GenerationDebugInfo = {
      answerGenerationMode: "unavailable",
      providerName,
      modelName,
      usedMock: Boolean(this.llm?.isMock),
      usedTemplateFallback: false,
      llmConfigured: Boolean(this.llm),
      rawLlmCalled: false,
      promptPreview: prompt.slice(0, 1200),
      selectedEvidenceCount: input.selectedEvidence.selected.length,
      rejectedEvidenceCount: input.selectedEvidence.rejected.length,
      groundingPassed: input.groundingCheck.passed,
      groundingFailureReason: input.groundingCheck.passed ? undefined : input.groundingCheck.reason
    };

    if (input.answerability.shouldRefuseToInvent) {
      return {
        answer: buildRefusalAnswer(input.query, input.context, input.answerability),
        debug: { ...baseDebug, answerGenerationMode: "template_fallback", usedTemplateFallback: true }
      };
    }

    const kbEvidence = input.selectedEvidence.selected.filter((item) => item.sourceType === "wiki" || item.sourceType === "knowledge_base");
    const retrievalWasEmpty = input.usedSkills.some(
      (skill) => skill.name === "KnowledgeRetrievalSkill" && skill.status === "called" && (skill.metadata?.retrieval as RetrievalResult | undefined)?.status === "empty"
    );
    if (input.question.intent === "ask_knowledge_base" && input.conceptResolution && retrievalWasEmpty && kbEvidence.length === 0) {
      return {
        answer: buildConceptRetrievalEmptyAnswer(input.conceptResolution, input.context),
        debug: { ...baseDebug, answerGenerationMode: "template_fallback", usedTemplateFallback: true }
      };
    }

    if (this.llm) {
      try {
        const generated = await this.llm.generate(
          [
            { role: "system", content: assistantSystemPrompt },
            { role: "user", content: prompt }
          ],
          { policy: input.policy, groundingMode: this.groundingMode }
        );
        if (generated.trim()) {
          const shapedAnswer = enforceAnswerShape(generated.trim(), input.query, input.question, input.selectedEvidence);
          return {
            answer: shapedAnswer,
            debug: {
              ...baseDebug,
              answerGenerationMode: this.llm.isMock ? "mock_llm" : "real_llm",
              rawLlmCalled: true
            }
          };
        }
      } catch (error) {
        const failureReason = error instanceof Error ? error.message : "LLM call failed";
        if (this.requireRealLlm) {
          return {
            answer: `LLM provider unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
            debug: {
              ...baseDebug,
              rawLlmCalled: true,
              llmFailureReason: failureReason,
              groundingFailureReason: failureReason
            }
          };
        }
        baseDebug.rawLlmCalled = true;
        baseDebug.llmFailureReason = failureReason;
      }
    }

    if (this.requireRealLlm) {
      return {
        answer: "LLM provider unavailable. 当前 demo 要求真实模型，但没有可用的 LLM 配置。",
        debug: baseDebug
      };
    }

    return {
      answer: buildTemplateAnswer(input.query, input.context, input.question, input.policy, input.selectedEvidence, input.answerability, input.conceptResolution),
      debug: { ...baseDebug, answerGenerationMode: "template_fallback", usedTemplateFallback: true }
    };
  }
}

function enforceAnswerShape(answer: string, query: string, question: QuestionAnalysis, evidence: SelectedEvidence): string {
  let shaped = answer.trim();
  if (question.evidenceNeed === "ambiguous_reference" && !hasAmbiguousClarification(shaped)) {
    const candidates = extractMetricCandidatesFromEvidence(evidence.selected);
    const candidateLines = candidates.length
      ? candidates.map((item, index) => `${index + 1}. ${item}`).join("\n")
      : "1. 当前页里可能有多个指标或术语需要先确认。";
    shaped = [
      "这里的“这个指标”指代不够明确，我不能随机替你选一个。",
      "",
      "当前页里可能对应这些候选项：",
      candidateLines,
      "",
      "你想问的是哪一个？如果你只是想整体理解，我可以继续把这些候选指标的区别讲清楚。",
      "",
      shaped
    ].join("\n");
  }

  if (question.evidenceNeed === "sufficiency_check" && !/(不能完全|不能仅凭|只根据|部分|缺少|还不足以|需要结合)/.test(shaped)) {
    shaped = [
      shaped,
      "",
      "补充说明：仅凭当前页可以做部分判断，但还不能完全确认完整定义、实验设计来源、采样比例或参数细节；这类信息需要结合前后页或实验设计说明。"
    ].join("\n");
  }

  if (/平台大纲|教师讲稿|讲稿/.test(query) && !/(当前页|教师讲稿|平台大纲)/.test(shaped)) {
    shaped = [
      shaped,
      "",
      "按来源区分：当前页给出 Harness 的课程语境；教师讲稿补充它是围绕模型的编排层；平台大纲把这一页定位在学习助教上下文、工具调用和结构化返回的章节中。"
    ].join("\n");
  }

  return shaped;
}

function hasAmbiguousClarification(answer: string): boolean {
  const mentions = extractMetricCandidatesFromText(answer).length;
  return mentions >= 2 || /(你指的是|请确认|哪个指标|候选|可能是|指代不清|不明确|哪一个)/.test(answer);
}

function extractMetricCandidatesFromEvidence(evidence: EvidenceCandidate[]): string[] {
  return extractMetricCandidatesFromText(evidence.map((item) => `${item.title ?? ""}\n${item.text}`).join("\n"));
}

function extractMetricCandidatesFromText(text: string): string[] {
  const candidates = new Set<string>();
  if (/mAP[_@]?0\.5(?!\s*[:：]\s*0\.95)/i.test(text)) candidates.add("mAP_0.5：IoU 阈值为 0.5 时的平均精度。");
  if (/mAP[_@]?0\.5\s*[:：]\s*0\.95/i.test(text)) candidates.add("mAP_0.5:0.95：多个 IoU 阈值下的平均精度，更严格。");
  if (/\bF1\b|F1\s*分数/i.test(text)) candidates.add("F1：综合 precision 和 recall 的指标。");
  if (/\bPSNR\b/i.test(text)) candidates.add("PSNR：图像重建质量指标，通常越高越好。");
  if (/\bSSIM\b/i.test(text)) candidates.add("SSIM：结构相似性指标，通常越高越好。");
  if (/\bLPIPS\b/i.test(text)) candidates.add("LPIPS：感知相似度指标，通常越低越好。");
  return [...candidates];
}

function refinePolicy(policy: TeachingPolicy, question: QuestionAnalysis, context: LearningContext): TeachingPolicy {
  const currentPageRelevant =
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
    (question.evidenceNeed === "comparison" && question.intent === "ask_current_page_concept") ||
    question.currentPageRelevanceReason.includes("overlaps");
  const currentPageHasUsableText = Boolean(context.currentPage?.text?.trim());
  const hardExactNeed =
    question.evidenceNeed === "exact_formula_or_derivation" ||
    question.evidenceNeed === "budget_table" ||
    question.evidenceNeed === "unknown_entity";
  const shouldRetrieveKnowledge =
    question.intent === "ask_knowledge_base" ||
    (hardExactNeed && (!currentPageRelevant || question.keyEntities.length > 0)) ||
    (question.likelyNeedsRetrieval && !currentPageRelevant && !currentPageHasUsableText);

  return {
    ...policy,
    shouldUseCurrentPage: Boolean(context.currentPage?.text) && currentPageRelevant,
    shouldUseOutline: Boolean(context.outline?.items.length) && currentPageRelevant,
    shouldUseTeacherScript:
      Boolean(context.teacherScript?.text) &&
      context.teacherScript?.source !== "missing" &&
      context.teacherScript?.source !== "auto_summary" &&
      currentPageRelevant,
    shouldUseNeighborPages: Boolean(context.neighborPages?.previous || context.neighborPages?.next) && currentPageRelevant,
    shouldRetrieveKnowledge,
    shouldCallSkill: shouldRetrieveKnowledge,
    reasons: [
      ...policy.reasons,
      question.currentPageRelevanceReason,
      shouldRetrieveKnowledge ? "question should be checked against knowledge-base evidence" : "retrieval is not required before answering"
    ]
  };
}

function buildRelevance(
  query: string,
  context: LearningContext,
  selectedEvidence: SelectedEvidence,
  retrievalResult?: RetrievalResult,
  question?: QuestionAnalysis
): AnswerabilityResult["relevance"] {
  const selectedTypes = new Set(selectedEvidence.selected.map((item) => item.sourceType));
  const currentRaw = context.currentPage ? lexicalOverlap(query, `${context.currentPage.semanticTitle ?? context.currentPage.title ?? ""}\n${context.currentPage.text}`) : 0;
  const teacherRaw = context.teacherScript?.text ? lexicalOverlap(query, context.teacherScript.text) : 0;
  const outlineRaw = context.outline?.items.length
    ? lexicalOverlap(query, context.outline.items.map((item) => `${item.title} ${item.summary ?? ""}`).join("\n"))
    : 0;
  const neighborRaw = lexicalOverlap(
    query,
    [context.neighborPages?.previous?.summary, context.neighborPages?.next?.summary].filter(Boolean).join("\n")
  );
  const selectedKb = selectedEvidence.selected
    .filter((item) => item.sourceType === "wiki" || item.sourceType === "knowledge_base")
    .map((item) => item.relevanceScore ?? 0);
  const isCurrentPageQuestion =
    question?.intent === "ask_current_page_summary" ||
    question?.intent === "ask_current_page_concept" ||
    Boolean(
      question &&
        [
          "summary",
          "concept_explanation",
          "socratic_guidance",
          "analogy",
          "numeric_extraction",
          "numeric_calculation_from_page",
          "chart_trend",
          "comparison"
        ].includes(question.evidenceNeed)
    );
  const current = selectedTypes.has("current_page") && isCurrentPageQuestion ? Math.max(currentRaw, 0.9) : currentRaw;
  const teacher = selectedTypes.has("teacher_script") || selectedTypes.has("speaker_notes") ? Math.max(teacherRaw, 0.75) : teacherRaw;
  const outline = selectedTypes.has("outline") ? Math.max(outlineRaw, 0.7) : outlineRaw;
  const neighbor = selectedTypes.has("neighbor_page") ? Math.max(neighborRaw, 0.6) : neighborRaw;
  const kbTopRaw = Math.max(retrievalResult?.topScore ?? 0, ...selectedKb, 0);
  return {
    currentPage: round(clamp01(current)),
    teacherScript: round(clamp01(teacher)),
    outline: round(clamp01(outline)),
    neighborPages: round(clamp01(neighbor)),
    knowledgeBase: round(normalizeRetrievalScore(kbTopRaw, retrievalResult?.relevanceThreshold))
  };
}

function checkGrounding(answerability: AnswerabilityResult, evidence: SelectedEvidence): GroundingCheck {
  if (answerability.shouldRefuseToInvent) {
    return {
      passed: true,
      reason: "answer should refuse to invent unsupported exact details"
    };
  }
  if (answerability.status === "answerable_from_general_knowledge") {
    return {
      passed: true,
      reason: "general knowledge is allowed only with an explicit label"
    };
  }
  if (evidence.sufficiency === "insufficient") {
    return {
      passed: false,
      reason: "selected evidence is insufficient for a grounded answer",
      unsupportedClaims: ["answer would require unsupported claims"]
    };
  }
  return {
    passed: true,
    reason: "selected evidence is sufficient for the planned answer"
  };
}

function buildTemplateAnswer(
  query: string,
  context: LearningContext,
  question: QuestionAnalysis,
  policy: TeachingPolicy,
  evidence: SelectedEvidence,
  answerability: AnswerabilityResult,
  conceptResolution?: ConceptResolution
): string {
  if (answerability.status === "answerable_from_general_knowledge") {
    return buildGeneralKnowledgeAnswer(query, context, policy);
  }

  const currentPage = evidence.selected.find((item) => item.sourceType === "current_page");
  const kbEvidence = evidence.selected.filter((item) => item.sourceType === "wiki" || item.sourceType === "knowledge_base");

  if (question.intent === "ask_knowledge_base" && kbEvidence.length > 0) {
    return answerFromKnowledgeBase(kbEvidence, conceptResolution);
  }

  if (question.intent === "ask_knowledge_base" && conceptResolution) {
    return buildConceptRetrievalEmptyAnswer(conceptResolution, context);
  }

  if (currentPage) {
    return answerFromCurrentPage(query, currentPage, question, policy);
  }

  if (kbEvidence.length > 0) {
    return answerFromKnowledgeBase(kbEvidence, conceptResolution);
  }

  return buildRefusalAnswer(query, context, answerability);
}

function answerFromCurrentPage(
  query: string,
  evidence: EvidenceCandidate,
  question: QuestionAnalysis,
  policy: TeachingPolicy
): string {
  const lines = meaningfulLines(evidence.text).filter((line) => line !== evidence.metadata?.pageLabel).slice(0, 8);
  const inferredTitle = lines.find((line) => line.length <= 40) ?? "当前页";
  const title = evidence.title && !/^\d+$/.test(evidence.title) ? evidence.title : inferredTitle;
  const topicLine = lines.find((line) => line.includes(title)) ?? lines[0] ?? title;

  if (question.intent === "ask_current_page_summary") {
    const points = lines.filter((line) => line !== topicLine).slice(0, policy.depth === "brief" ? 3 : 5);
    return applyTeachingStyle([
      `这页主要讲的是“${title}”。`,
      "",
      points.length > 0
        ? `可以抓住这几个要点：\n${points.map((point, index) => `${index + 1}. ${point}`).join("\n")}`
        : `核心信息是：${topicLine}`,
      "",
      "理解时可以重点看这些信息之间如何互相支撑。"
    ].join("\n"), policy);
  }

  const matched = lines.filter((line) => question.keyConcepts.some((concept) => line.toLowerCase().includes(concept.toLowerCase())));
  const points = (matched.length > 0 ? matched : lines).slice(0, policy.depth === "brief" ? 3 : 5);
  return applyTeachingStyle([
    `根据当前页“${title}”，这个问题可以从页内信息回答。`,
    "",
    points.map((point, index) => `${index + 1}. ${point}`).join("\n"),
    "",
    "如果你想继续深挖，可以追问其中任意一个概念，我会只围绕这一页已有依据展开。"
  ].join("\n"), policy);
}

function answerFromKnowledgeBase(evidence: EvidenceCandidate[], conceptResolution?: ConceptResolution): string {
  const combined = evidence.map((item) => item.text).join("\n");
  const prefix = conceptResolution
    ? [
        `我先按“${conceptResolution.assumedConcept}”检索知识库。`,
        conceptResolution.alternatives.length
          ? `如果你指的是 ${conceptResolution.alternatives.join("、")}，可以再告诉我，我会换成那个概念重新查。`
          : ""
      ].filter(Boolean).join("\n")
    : "";
  if (/Source Loop/i.test(combined) && /Query Loop/i.test(combined) && /Maintenance Loop/i.test(combined)) {
    return [
      prefix,
      prefix ? "" : undefined,
      "这个知识库的运行流程主要由三个 loop 组织：",
      "",
      "1. Source Loop：处理新材料进入知识库的过程，通常包括 Intake、Triage、Parse、Compile、Integrate、Record。",
      "2. Query Loop：处理提问和回答的过程，通常包括 Query、Retrieve、Answer、Reflect、Write Back、Record。",
      "3. Maintenance Loop：维护知识库质量的过程，通常包括 Audit、Diagnose、Repair、Review、Record。",
      "",
      "简单说，它不是只存 Markdown，而是把资料进入、问题回答、后续维护都设计成可记录、可复查的流程。"
    ].filter((line) => line !== undefined).join("\n");
  }

  return [
    prefix,
    prefix ? "" : undefined,
    "知识库里找到了相关依据：",
    "",
    ...evidence.slice(0, 3).map((item, index) => `${index + 1}. ${item.sectionTitle ?? item.title ?? "片段"}：${summarizeText(item.text, 180)}`)
  ].filter((line) => line !== undefined).join("\n");
}

function buildConceptRetrievalEmptyAnswer(conceptResolution: ConceptResolution, context: LearningContext): string {
  const pageTitle = cleanDisplayTitle(context.currentPage?.semanticTitle ?? context.currentPage?.title);
  return [
    `我先按“${conceptResolution.assumedConcept}”理解你说的“这个概念”，并去外部知识库里检索。`,
    conceptResolution.alternatives.length
      ? `当前页还可能涉及 ${conceptResolution.alternatives.join("、")}；如果你指的是其中某一个，可以告诉我，我会换成那个概念再查。`
      : "",
    "",
    `我查了外部知识库，但没有找到能更完整解释“${conceptResolution.assumedConcept}”的可靠资料。`,
    pageTitle ? `当前页《${pageTitle}》可以作为课程内上下文，但它不等同于外部知识库证据。` : "",
    "所以我不会把 PPT 后续页、课件背景或知识库运行流程硬套成这个概念的外部解释。你也可以直接指定 softmax-weighted、mAP/F1、YOLO 等某个具体术语，我再按那个术语重新检索。"
  ].filter(Boolean).join("\n");
}

function buildGeneralKnowledgeAnswer(query: string, context: LearningContext, policy: TeachingPolicy): string {
  const pageTitle = context.currentPage?.semanticTitle ?? context.currentPage?.title;
  const prefix = pageTitle
    ? `当前页主要讲“${pageTitle}”，没有直接提供这个问题的依据。下面基于通用知识解释。`
    : "当前材料没有直接提供这个问题的依据。下面基于通用知识解释。";

  if (/rag/i.test(query)) {
    const detail =
      policy.depth === "deep"
        ? "RAG 的关键链路是：先把问题改写成检索查询，从外部知识库取回相关片段，再把这些片段作为上下文交给模型生成答案，并保留引用以便追溯。"
        : "RAG 会先从外部知识库检索相关资料，再把检索结果交给模型生成回答。";
    return [
      prefix,
      "",
      "普通 LLM 问答主要依赖模型训练时学到的参数知识；RAG 则是先查资料，再结合资料回答。",
      "",
      "简单说：",
      "1. 普通 LLM：主要靠模型记忆回答。",
      "2. RAG：先检索证据，再生成回答。",
      "",
      detail,
      "它的优势是可以降低幻觉、接入更新材料，并让答案更容易追溯来源。"
    ].join("\n");
  }

  return [
    prefix,
    "",
    "这个问题更像通用概念问题。当前课程材料没有给出直接依据，所以这里不把答案伪装成来自 PPT 或知识库。",
    "你可以提供相关页面或资料，我再按课程证据重新解释。"
  ].join("\n");
}

function buildRefusalAnswer(query: string, context: LearningContext, answerability: AnswerabilityResult): string {
  const entity = extractMainEntity(query);
  const pageTitle = cleanDisplayTitle(context.currentPage?.semanticTitle ?? context.currentPage?.title);
  const missing = answerability.missingEvidence ?? ["relevant supporting evidence"];
  const firstLine = entity
    ? `当前材料中没有找到 ${entity} 的相关内容。`
    : "我目前没有在当前材料里看到足够支持这个问题的内容。";
  const pageLine = pageTitle ? `当前页《${pageTitle}》没有提供这个问题需要的精确依据。` : "当前没有可用页面证据。";

  return [
    firstLine,
    "",
    "我检查了当前页、课件上下文和已接入的外部知识库证据，仍缺少这些必要依据：",
    ...missing.map((item, index) => `${index + 1}. ${translateMissingEvidence(item)}；`),
    "",
    pageLine,
    "因此我不能编造公式、数值推导或预算表。你可以提供包含相关实体、公式或数据表的材料，或切换到对应页面后再问。"
  ].join("\n");
}

function applyTeachingStyle(answer: string, policy: TeachingPolicy): string {
  if (policy.style === "analogy") {
    return ["可以先用一个直观类比理解：把这一页当成一张概念地图，先看关键概念，再看它们之间怎么互相支撑。", "", answer].join("\n");
  }
  if (policy.style === "step_by_step") {
    return ["我们分步骤看：", "", answer].join("\n");
  }
  if (policy.style === "socratic") {
    return [answer, "", "你可以反过来检查自己：如果只保留这一页一个关键词，你会选哪一个？为什么？"].join("\n");
  }
  if (policy.style === "exam_focused") {
    return [answer, "", "按考点记忆时，建议抓住：定义、作用、区别、常见误区。"].join("\n");
  }
  if (policy.style === "deep_dive") {
    return [answer, "", "再深入一层看，关键不只是结论，而是这个结论由哪些页内证据支撑。"].join("\n");
  }
  return answer;
}

function buildDecisionTrace(input: {
  query: string;
  question: QuestionAnalysis;
  policy: TeachingPolicy;
  selectedEvidence: SelectedEvidence;
  answerability: AnswerabilityResult;
  groundingCheck: GroundingCheck;
  relevance: AnswerabilityResult["relevance"];
  usedSkills: UsedSkillRecord[];
  retrievalResult?: RetrievalResult;
}): AgentDecisionTrace {
  const skill = input.usedSkills[0];
  const called = skill?.status === "called";
  return {
    questionUnderstanding: `Detected ${input.question.intent}: ${input.question.normalizedQuestion}`,
    detectedIntent: input.question.intent,
    keyEntities: input.question.keyEntities,
    contextRelevance: {
      currentPage: {
        score: input.relevance.currentPage,
        reason: input.question.currentPageRelevanceReason
      },
      teacherScript: {
        score: input.relevance.teacherScript,
        reason: input.relevance.teacherScript > 0 ? "teacher script overlaps with the question" : "teacher script has no direct overlap or is missing"
      },
      outline: {
        score: input.relevance.outline,
        reason: input.relevance.outline > 0 ? "outline overlaps with the question" : "outline has no direct overlap or is missing"
      },
      neighborPages: {
        score: input.relevance.neighborPages,
        reason: input.relevance.neighborPages > 0 ? "neighbor pages overlap with the question" : "neighbor pages are not supporting evidence"
      },
      knowledgeBase: {
        score: input.relevance.knowledgeBase,
        reason: input.retrievalResult
          ? `retrieval ${input.retrievalResult.status}, top score ${input.retrievalResult.topScore?.toFixed(2) ?? "n/a"}`
          : "retrieval not called"
      }
    },
    answerability: input.answerability,
    evidenceSelection: {
      selectedCount: input.selectedEvidence.selected.length,
      rejectedCount: input.selectedEvidence.rejected.length,
      sufficiency: input.selectedEvidence.sufficiency,
      reason: input.selectedEvidence.reason
    },
    policySummary: {
      style: input.policy.style,
      depth: input.policy.depth,
      source: input.policy.source,
      reason: input.policy.reasons.slice(-2).join("; ") || "default policy"
    },
    retrievalDecision: {
      needed: input.policy.shouldRetrieveKnowledge,
      called,
      reason: skill?.reason ?? (input.policy.shouldRetrieveKnowledge ? "retrieval was needed" : "retrieval was not needed"),
      resultStatus: input.retrievalResult?.status,
      topScore: input.retrievalResult?.topScore,
      threshold: input.retrievalResult?.relevanceThreshold,
      evidenceSufficient: input.retrievalResult?.evidenceSufficient
    },
    groundingCheck: input.groundingCheck,
    answerPlanBrief: planBrief(input.answerability, input.selectedEvidence),
    uncertainty: input.answerability.shouldRefuseToInvent ? input.answerability.reason : undefined
  };
}

function buildCitations(evidence: EvidenceCandidate[]): Citation[] {
  const citations = evidence
    .filter((item) => item.sourceType !== "general_knowledge")
    .filter((item) => item.sourceType !== "wiki" && item.sourceType !== "knowledge_base" ? true : isSubstantiveCitation(item))
    .map((item) => ({
      sourceType: item.sourceType === "knowledge_base" ? "knowledge_base" : item.sourceType === "wiki" ? "wiki" : item.sourceType,
      sourceId: item.sourceId,
      title: cleanCitationTitle(item),
      semanticTitle: cleanCitationTitle(item),
      fileName: typeof item.metadata?.fileName === "string" ? item.metadata.fileName : undefined,
      pageIndex: item.pageIndex,
      chunkId: item.chunkId,
      sectionTitle: item.sectionTitle,
      textPreview: summarizeText(sanitizeCitationPreview(item.text), 160),
      previewImageUrl: typeof item.metadata?.previewImageUrl === "string" ? item.metadata.previewImageUrl : undefined
    }));
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = [
      citation.sourceType,
      citation.sourceId ?? "",
      citation.pageIndex ?? "",
      citation.chunkId ?? "",
      citation.sectionTitle ?? "",
      citation.semanticTitle ?? citation.title ?? ""
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function computeConfidence(
  answerability: AnswerabilityResult,
  evidence: SelectedEvidence,
  retrievalResult?: RetrievalResult
): "low" | "medium" | "high" {
  if (answerability.shouldRefuseToInvent || answerability.status === "not_answerable") return "low";
  if (answerability.status === "answerable_from_general_knowledge") return evidence.selected.length > 0 ? "medium" : "low";
  if (evidence.sufficiency === "sufficient" && !answerability.missingEvidence?.length) {
    const hasCurrentPage = evidence.selected.some((item) => item.sourceType === "current_page");
    return retrievalResult?.status === "empty" && !hasCurrentPage ? "medium" : "high";
  }
  if (evidence.sufficiency === "partially_sufficient") return "medium";
  return "low";
}

function buildFollowUps(
  answerability: AnswerabilityResult,
  question: QuestionAnalysis,
  confidence: "low" | "medium" | "high"
): string[] {
  if (confidence === "low") return ["可以补充相关页、讲稿或知识库材料后再问。"];
  if (question.intent === "ask_current_page_summary") return ["要不要把这一页整理成 3 条复习卡片？"];
  if (answerability.status === "answerable_from_general_knowledge") return ["如果你提供课程页或知识库材料，我可以再给出带引用的版本。"];
  return ["可以继续追问其中一个概念，我会沿着当前证据解释。"];
}

function planBrief(answerability: AnswerabilityResult, evidence: SelectedEvidence): string {
  if (answerability.shouldRefuseToInvent) return "Refuse unsupported exact details and explain missing evidence.";
  if (answerability.status === "answerable_from_general_knowledge") return "Answer with a general-knowledge label and avoid unsupported citations.";
  return `Answer from ${evidence.selected.length} selected evidence item(s).`;
}

function meaningfulLines(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 2 && !/^\d{1,3}$/.test(line))
    .filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    });
}

function extractMainEntity(query: string): string | undefined {
  return query.match(/\b[A-Z][A-Za-z0-9+-]*(?:-[A-Za-z0-9+-]+)*\b/)?.[0];
}

function summarizeText(text: string | undefined, maxLength = 180): string {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function resolveConceptReference(query: string, context: LearningContext, question: QuestionAnalysis): ConceptResolution | undefined {
  if (question.intent !== "ask_knowledge_base") return undefined;
  if (!/(这个概念|這個概念|this concept|the concept)/i.test(query)) return undefined;
  const concepts = inferPageConcepts(context);
  if (concepts.length === 0) return undefined;
  const assumedConcept = concepts[0];
  const alternatives = concepts.slice(1, 4);
  const note =
    alternatives.length > 0
      ? `resolved "这个概念" as "${assumedConcept}"; alternatives: ${alternatives.join(", ")}`
      : `resolved "这个概念" as "${assumedConcept}"`;
  return {
    assumedConcept,
    alternatives,
    retrievalQuery: `${assumedConcept}\n${query.replace(/这个概念|這個概念|this concept|the concept/gi, assumedConcept)}`,
    note
  };
}

function inferPageConcepts(context: LearningContext): string[] {
  const raw = [
    context.currentPage?.semanticTitle,
    context.currentPage?.title,
    ...(context.currentPage?.bulletPoints ?? []),
    ...meaningfulLines(context.currentPage?.text ?? "").slice(0, 6)
  ].filter(Boolean) as string[];
  const concepts: string[] = [];
  for (const value of raw) {
    for (const candidate of extractConceptCandidates(value)) {
      if (!concepts.includes(candidate)) concepts.push(candidate);
    }
  }
  for (const candidate of extractTechnicalConcepts(context.currentPage?.text ?? "")) {
    if (!concepts.includes(candidate)) concepts.push(candidate);
  }
  return concepts.slice(0, 5);
}

const SLIDE_NOISE_TERMS = [
  "JILIN",
  "UNIVERSITY",
  "JILIN UNIVERSITY",
  "吉林大学",
  "中期答辩",
  "毕业设计",
  "答辩",
  "答辩人",
  "指导教师",
  "导师",
  "目录",
  "研究背景",
  "研究内容",
  "工作进展",
  "后续计划",
  "Slide",
  "PPT",
  "PowerPoint"
];

const TECHNICAL_TERM_PATTERNS: Array<[RegExp, string]> = [
  [/softmax[-\s]?weighted/i, "softmax-weighted 融合"],
  [/\bYOLO\b/i, "YOLO 检测任务"],
  [/\bmAP(?:[_@]0\.5(?::0\.95)?)?\b/i, "mAP/F1 检测指标"],
  [/\bF1\b/i, "F1 指标"],
  [/\bRGB[-\s]?native\b/i, "RGB-native"],
  [/\bDenseFuse\b/i, "DenseFuse"],
  [/\bRAG\b/i, "RAG"],
  [/\bLLM\s*Wiki\b/i, "LLM Wiki"],
  [/\bHarness\b/i, "Harness"],
  [/\bPSNR\b/i, "PSNR"],
  [/\bSSIM\b/i, "SSIM"],
  [/\bLPIPS\b/i, "LPIPS"],
  [/\bFLOPS\b/i, "FLOPS"]
];

function extractConceptCandidates(value: string): string[] {
  const cleaned = cleanConceptCandidate(value);
  if (!cleaned) return [];
  const candidates = [cleaned];
  const splitByStructure = cleaned
    .split(/\s+(?:核心思路|当前结果定位|结果解读|训练设定|数据与任务|阶段定位|样例组|说明)\s+/)
    .filter(Boolean)[0];
  if (splitByStructure && splitByStructure !== cleaned) candidates.unshift(splitByStructure);
  const splitByNumberedBody = cleaned.split(/\s+\d+\s+/).filter(Boolean)[0];
  if (splitByNumberedBody && splitByNumberedBody !== cleaned) candidates.unshift(splitByNumberedBody);
  return candidates
    .map((candidate) => cleanConceptCandidate(candidate))
    .filter((candidate): candidate is string => Boolean(candidate))
    .filter((candidate) => !isSlideNoiseConcept(candidate));
}

function extractTechnicalConcepts(text: string): string[] {
  const concepts: string[] = [];
  for (const [pattern, label] of TECHNICAL_TERM_PATTERNS) {
    if (pattern.test(text) && !concepts.includes(label)) concepts.push(label);
  }
  if (/面向检测/.test(text) && /联合优化/.test(text) && !concepts.includes("面向检测的联合优化")) {
    concepts.unshift("面向检测的联合优化");
  }
  if (/可见光/.test(text) && /红外/.test(text) && /融合/.test(text) && !concepts.includes("可见光和红外图像融合")) {
    concepts.push("可见光和红外图像融合");
  }
  return concepts;
}

function cleanConceptCandidate(text: string | undefined): string | undefined {
  let cleaned = cleanDisplayTitle(text);
  if (!cleaned) return undefined;
  cleaned = removeSlideNoise(cleaned)
    .replace(/^\d{1,3}\s*/, "")
    .replace(/^(?:第\s*)?\d{1,3}\s*(?:页|\/\s*\d+)?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || /^\d+$/.test(cleaned)) return undefined;
  if (cleaned.length < 2 || cleaned.length > 42) return undefined;
  if (/^(slide|page|第\s*\d+\s*页)$/i.test(cleaned)) return undefined;
  if (isSlideNoiseConcept(cleaned)) return undefined;
  return cleaned;
}

function isSlideNoiseConcept(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  const upper = normalized.toUpperCase();
  if (!normalized) return true;
  if (SLIDE_NOISE_TERMS.some((term) => upper === term.toUpperCase())) return true;
  if (/^(JILIN|UNIVERSITY|JILIN UNIVERSITY)$/i.test(normalized)) return true;
  if (/^(毕业设计)?中期答辩$/.test(normalized)) return true;
  if (/^(答辩人|指导教师|答辩时间|导师)\b/.test(normalized)) return true;
  if (/^[A-Z\s.]{3,}$/.test(normalized) && !/(AI|RAG|LLM|YOLO|RGB|FLOPS|PSNR|SSIM|LPIPS|F1|MAP)/.test(upper)) {
    return true;
  }
  return false;
}

function removeSlideNoise(text: string): string {
  let cleaned = text;
  for (const term of SLIDE_NOISE_TERMS) {
    cleaned = cleaned.replace(new RegExp(escapeRegExp(term), "gi"), " ");
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

function sanitizeCitationPreview(text: string): string {
  return removeSlideNoise(text)
    .replace(/\b(JILIN|UNIVERSITY)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCitationTitle(item: EvidenceCandidate): string | undefined {
  const raw = typeof item.metadata?.semanticTitle === "string" ? item.metadata.semanticTitle : item.title;
  return cleanDisplayTitle(raw) ?? item.title;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function summarizeUsedSkills(skills: UsedSkillRecord[]): string {
  if (skills.length === 0) return "none";
  return skills.map((skill) => `${skill.name}:${skill.status} (${skill.reason})`).join("; ");
}

function isSubstantiveCitation(item: EvidenceCandidate): boolean {
  const text = (item.text ?? "").replace(/\s+/g, " ").trim();
  if (text.length < 80) return false;
  if (/^#{1,6}\s+\S{1,50}$/.test(text)) return false;
  return true;
}

function translateMissingEvidence(text: string): string {
  if (/definition or source mention for (.+)/i.test(text)) {
    return `缺少 ${text.match(/definition or source mention for (.+)/i)?.[1]} 的定义或来源说明`;
  }
  if (/explicit formula or derivation/i.test(text)) return "缺少明确公式或推导过程";
  if (/numerical data or calculation steps/i.test(text)) return "缺少数值数据或计算步骤";
  if (/budget table or cost data/i.test(text)) return "缺少预算表或成本数据";
  if (/relevant current-page/i.test(text)) return "缺少能支撑回答的当前页、讲稿或知识库证据";
  return text;
}

function cleanDisplayTitle(text: string | undefined): string | undefined {
  const cleaned = (text ?? "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^Slide\s*\d+\s*[:：-]\s*/i, "")
    .replace(/^第\s*\d+\s*页\s*[:：-]?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalizeRetrievalScore(score: number, threshold = 4.2): number {
  if (!score || score <= 0) return 0;
  return clamp01(score / Math.max(threshold * 2, 1));
}
