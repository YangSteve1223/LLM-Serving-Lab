import type { LearningContext } from "../types.ts";
import type { MicroQuiz, MicroQuizQuestion, QuizQualityResult } from "./types.ts";
import { containsLoose, normalize, sourceText } from "./learningLoopUtils.ts";

export type QuizQualityCheckerOptions = {
  threshold?: number;
};

export class QuizQualityChecker {
  private readonly threshold: number;

  constructor(options: QuizQualityCheckerOptions = {}) {
    this.threshold = options.threshold ?? 75;
  }

  check(quiz: MicroQuiz, context: LearningContext): QuizQualityResult {
    const issues: string[] = [];
    const pageText = sourceText(context);
    const questions = quiz.questions ?? [];

    if (questions.length < 2 || questions.length > 3) issues.push("小测题目数量应为 2-3 道。");
    if (new Set(questions.map((item) => item.type)).size < Math.min(2, questions.length)) {
      issues.push("题型不够多样。");
    }
    if (questions.some((item) => !isRelevantToPage(item, pageText))) {
      issues.push("存在与当前页证据关联不足的题目。");
    }
    if (hasDuplicateQuestions(questions)) issues.push("题目之间重复度过高。");
    if (questions.some((item) => isGenericExpectedAnswer(item.expectedAnswer))) {
      issues.push("存在过于泛化的 expectedAnswer。");
    }
    if (questions.some((item) => isForbiddenMissingTemplate(item.question))) {
      issues.push("存在“如果缺少 X 会怎样”的机械模板题。");
    }
    if (questions.some((item) => !hasSupportedEvidence(item, pageText))) {
      issues.push("sourceEvidence 未能对应当前页、讲稿或 deck context。");
    }
    if (questions.some((item) => hasUnsupportedNumbers(item, pageText))) {
      issues.push("题目或答案中出现当前证据没有支持的数字、公式或预算。");
    }
    if (looksLikeSingleTemplate(questions)) issues.push("题目像同一句模板批量替换。");
    if (questions.some((item) => !hasRubric(item))) issues.push("缺少明确 scoringRubric。");
    if (questions.some((item) => !isLearnerFriendly(item, context))) issues.push("题目或答案对当前 learnerLevel 不够友好。");

    const score = Math.max(0, 100 - issues.length * 13);
    return {
      passed: score >= this.threshold && issues.length === 0,
      score,
      issues,
      needsRegeneration: score < this.threshold || issues.length > 0
    };
  }
}

function isRelevantToPage(item: MicroQuizQuestion, pageText: string): boolean {
  return containsLoose(pageText, item.concept) || containsLoose(pageText, item.sourceEvidence) || containsLoose(item.sourceEvidence, item.concept);
}

function hasDuplicateQuestions(questions: MicroQuizQuestion[]): boolean {
  for (let i = 0; i < questions.length; i += 1) {
    for (let j = i + 1; j < questions.length; j += 1) {
      if (similarity(questions[i].question, questions[j].question) >= 0.72) return true;
    }
  }
  return false;
}

function isGenericExpectedAnswer(answer: string): boolean {
  const normalized = normalize(answer);
  if (answer.trim().length < 24) return true;
  return [
    "结合本页内容说明",
    "会受到影响",
    "系统或方法可能会",
    "需要进一步学习",
    "有助于理解"
  ].some((phrase) => normalized.includes(normalize(phrase)));
}

function isForbiddenMissingTemplate(question: string): boolean {
  const normalized = normalize(question);
  return (
    /如果缺少.+本页所讲.+影响/.test(question) ||
    /如果没有.+本页所讲.+影响/.test(question) ||
    (normalized.includes(normalize("如果缺少")) && normalized.includes(normalize("会怎样"))) ||
    (normalized.includes("map_0") && normalized.includes(normalize("如果缺少")))
  );
}

function hasSupportedEvidence(item: MicroQuizQuestion, pageText: string): boolean {
  if (!item.sourceEvidence?.trim()) return false;
  const evidence = normalize(item.sourceEvidence);
  const source = normalize(pageText);
  if (source.includes(evidence.slice(0, Math.min(18, evidence.length)))) return true;
  return containsLoose(pageText, item.concept) && similarity(item.sourceEvidence, pageText) > 0.08;
}

function hasUnsupportedNumbers(item: MicroQuizQuestion, pageText: string): boolean {
  const sourceNumbers = new Set(numbers(pageText));
  const generatedNumbers = numbers(`${item.question} ${item.expectedAnswer} ${item.sourceEvidence}`);
  return generatedNumbers.some((num) => !sourceNumbers.has(num) && !isUnitConversionNumber(num, sourceNumbers));
}

function looksLikeSingleTemplate(questions: MicroQuizQuestion[]): boolean {
  if (questions.length < 2) return false;
  const stems = questions.map((item) => normalize(item.question).replace(normalize(item.concept), "{concept}").slice(0, 24));
  return new Set(stems).size === 1 || questions.every((item) => isForbiddenMissingTemplate(item.question));
}

function hasRubric(item: MicroQuizQuestion): boolean {
  return Boolean(
    item.scoringRubric?.fullCredit?.length &&
      item.scoringRubric.partialCredit?.length &&
      item.scoringRubric.commonMistakes?.length
  );
}

function isLearnerFriendly(item: MicroQuizQuestion, context: LearningContext): boolean {
  const level = context.learner?.profile?.level ?? "unknown";
  if (level !== "beginner") return true;
  return item.question.length <= 120 && item.expectedAnswer.length <= 360;
}

function similarity(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const token of left) if (right.has(token)) hits += 1;
  return hits / Math.max(left.size, right.size);
}

function tokenSet(text: string): Set<string> {
  return new Set(normalize(text).match(/[a-z0-9_]+|[\u4e00-\u9fa5]{2}/gi) ?? []);
}

function numbers(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? [];
}

function isUnitConversionNumber(num: string, sourceNumbers: Set<string>): boolean {
  const value = Number(num);
  if (!Number.isFinite(value)) return false;
  return [...sourceNumbers].some((source) => {
    const base = Number(source);
    return Number.isFinite(base) && [base * 1_000, base * 1_000_000, base / 1_000, base / 1_000_000].includes(value);
  });
}
