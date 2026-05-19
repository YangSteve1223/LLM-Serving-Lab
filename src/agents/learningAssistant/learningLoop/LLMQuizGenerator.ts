import type { ChatMessage, LearningContext, LLMClient } from "../types.ts";
import { LearningObjectiveExtractor } from "./LearningObjectiveExtractor.ts";
import { QuizQualityChecker } from "./QuizQualityChecker.ts";
import type { GenerateMicroQuizInput, GeneratedQuizItem, LearningObjective, MicroQuiz } from "./types.ts";
import { nowIso, pageId, pageTitle, sourceText, stableId, summarize } from "./learningLoopUtils.ts";

export class QuizGenerationUnavailableError extends Error {
  constructor(message = "生成高质量小测需要连接真实模型。请先在“模型设置”中配置 API Key。") {
    super(message);
    this.name = "QuizGenerationUnavailableError";
  }
}

export type LLMQuizGeneratorOptions = {
  llm?: LLMClient;
  objectiveExtractor?: LearningObjectiveExtractor;
  qualityChecker?: QuizQualityChecker;
};

export class LLMQuizGenerator {
  private readonly llm?: LLMClient;
  private readonly objectiveExtractor: LearningObjectiveExtractor;
  private readonly qualityChecker: QuizQualityChecker;

  constructor(options: LLMQuizGeneratorOptions = {}) {
    this.llm = options.llm;
    this.objectiveExtractor = options.objectiveExtractor ?? new LearningObjectiveExtractor();
    this.qualityChecker = options.qualityChecker ?? new QuizQualityChecker();
  }

  async generate(input: GenerateMicroQuizInput): Promise<MicroQuiz> {
    const llm = input.llm ?? this.llm;
    if (!llm) throw new QuizGenerationUnavailableError();

    const objectives = this.objectiveExtractor.extract({
      learningContext: input.learningContext,
      targetConcepts: input.targetConcepts,
      learnerProfile: input.learningContext.learner,
      difficulty: input.difficulty,
      count: input.count
    });
    const count = Math.min(Math.max(input.count ?? 3, 2), 3);

    let quiz = await this.generateOnce(llm, input, objectives, count);
    let quality = this.qualityChecker.check(quiz, input.learningContext);
    quiz = { ...quiz, quality };
    if (!quality.needsRegeneration) return quiz;

    const regenerated = await this.generateOnce(llm, input, objectives, count, quality.issues);
    quality = this.qualityChecker.check(regenerated, input.learningContext);
    quiz = { ...regenerated, quality };
    if (!quality.passed) {
      throw new Error(`当前无法生成足够可靠的小测：${quality.issues.join("；") || "质量检查未通过"}`);
    }
    return quiz;
  }

  private async generateOnce(
    llm: LLMClient,
    input: GenerateMicroQuizInput,
    objectives: LearningObjective[],
    count: number,
    priorIssues: string[] = []
  ): Promise<MicroQuiz> {
    const content = await llm.generate(buildMessages(input.learningContext, objectives, count, priorIssues), {
      temperature: 0.2,
      max_tokens: 1800
    });
    const items = normalizeItems(parseQuizJson(content));
    if (items.length < 2) throw new Error("LLM did not return enough quiz items.");
    const questions = items.slice(0, count).map((item, index) => ({
      ...item,
      id: item.id?.trim() ? item.id : stableId("quiz-q", `${pageId(input.learningContext)}-${item.concept}-${index}`),
      sourcePageId: pageId(input.learningContext)
    }));
    return {
      id: stableId("micro-quiz", `${pageId(input.learningContext)}-${nowIso()}`),
      learnerId: input.learnerId,
      pageId: pageId(input.learningContext),
      pageTitle: pageTitle(input.learningContext),
      concepts: [...new Set(questions.map((item) => item.concept))],
      questions,
      generatedAt: nowIso(),
      learningObjectives: objectives,
      generationMode: "real_llm"
    };
  }
}

function buildMessages(context: LearningContext, objectives: LearningObjective[], count: number, priorIssues: string[]): ChatMessage[] {
  const currentPage = context.currentPage;
  const deckContext = [
    context.neighborPages?.previous ? `上一页：${context.neighborPages.previous.title ?? ""} ${context.neighborPages.previous.summary ?? ""}` : "",
    context.neighborPages?.next ? `下一页：${context.neighborPages.next.title ?? ""} ${context.neighborPages.next.summary ?? ""}` : "",
    context.outline?.items?.length ? `大纲：${context.outline.items.map((item) => `${item.title} ${item.summary ?? ""}`).join(" / ")}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  return [
    {
      role: "system",
      content: [
        "你是嵌入学习平台的测评题生成器。只输出严格 JSON，不要 Markdown。",
        "所有题目必须基于当前 PPT 页、教师讲稿或 deck context 的证据。",
        "不得编造当前页没有的数字、公式、预算、视频片段或外部事实。",
        "题目必须具体、多样，不能批量套用同一句模板。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          task: `生成 ${count} 道本页小测题。至少覆盖两种题型：concept_check, chart_reading, application, calculation, misconception_check, boundary_judgment, explain_back。`,
          outputSchema: {
            items: [
              {
                id: "string",
                type: "concept_check | chart_reading | application | calculation | misconception_check | boundary_judgment | explain_back",
                concept: "string",
                learningObjective: "string",
                question: "string",
                expectedAnswer: "string",
                scoringRubric: {
                  fullCredit: ["string"],
                  partialCredit: ["string"],
                  commonMistakes: ["string"]
                },
                hints: ["string"],
                difficulty: "easy | medium | hard",
                sourceEvidence: "string"
              }
            ]
          },
          currentPage: {
            pageIndex: currentPage?.pageIndex,
            title: pageTitle(context),
            text: currentPage?.text,
            bulletPoints: currentPage?.bulletPoints
          },
          teacherScript: context.teacherScript?.source !== "missing" ? context.teacherScript?.text : undefined,
          deckContext,
          learnerProfile: context.learner?.profile,
          learningObjectives: objectives,
          priorQualityIssues: priorIssues,
          badTemplateExamples: [
            "如果缺少 X，本页所讲的系统或方法可能会受到什么影响？",
            "如果缺少 mAP_0.5，本页所讲的系统或方法可能会受到什么影响？",
            "如果缺少 mAP_0.5:0.95，本页所讲的系统或方法可能会受到什么影响？",
            "请说明 X 的作用。"
          ]
        },
        null,
        2
      )
    }
  ];
}

function parseQuizJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const raw = fenced ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`LLM quiz output was not JSON: ${summarize(content, 220)}`);
  return JSON.parse(raw.slice(start, end + 1));
}

function normalizeItems(value: unknown): GeneratedQuizItem[] {
  const items = Array.isArray(value)
    ? value
    : Array.isArray((value as { items?: unknown[] })?.items)
      ? (value as { items: unknown[] }).items
      : Array.isArray((value as { questions?: unknown[] })?.questions)
        ? (value as { questions: unknown[] }).questions
        : [];
  return items.map((item) => normalizeItem(item)).filter((item): item is GeneratedQuizItem => Boolean(item));
}

function normalizeItem(value: unknown): GeneratedQuizItem | undefined {
  const item = value as Partial<GeneratedQuizItem>;
  if (!item?.question || !item.expectedAnswer || !item.concept || !item.sourceEvidence) return undefined;
  return {
    id: String(item.id ?? ""),
    type: normalizeType(item.type),
    concept: String(item.concept),
    learningObjective: String(item.learningObjective ?? item.concept),
    question: String(item.question),
    expectedAnswer: String(item.expectedAnswer),
    scoringRubric: {
      fullCredit: toStringArray(item.scoringRubric?.fullCredit),
      partialCredit: toStringArray(item.scoringRubric?.partialCredit),
      commonMistakes: toStringArray(item.scoringRubric?.commonMistakes)
    },
    hints: toStringArray(item.hints),
    difficulty: normalizeDifficulty(item.difficulty),
    sourceEvidence: String(item.sourceEvidence)
  };
}

function normalizeType(value: unknown): GeneratedQuizItem["type"] {
  const text = String(value ?? "");
  if (["recall", "concept_check", "application", "calculation", "misconception_check", "boundary_judgment", "explain_back", "chart_reading"].includes(text)) {
    return text as GeneratedQuizItem["type"];
  }
  return "concept_check";
}

function normalizeDifficulty(value: unknown): GeneratedQuizItem["difficulty"] {
  const text = String(value ?? "");
  if (["easy", "medium", "hard"].includes(text)) return text as GeneratedQuizItem["difficulty"];
  return "medium";
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}
