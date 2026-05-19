import { MisconceptionDetector } from "./MisconceptionDetector.ts";
import type { GradeQuizInput, QuizGradingResult, QuizScoringRubric } from "./types.ts";
import { normalize, sourceText, summarize } from "./learningLoopUtils.ts";

export class QuizGrader {
  private readonly misconceptionDetector = new MisconceptionDetector();

  grade(input: GradeQuizInput): QuizGradingResult {
    const answer = input.studentAnswer.trim();
    const question = input.quizQuestion;
    const rubric = question.scoringRubric ?? fallbackRubric(question.expectedAnswer);
    const misconceptions = [
      ...this.misconceptionDetector.detect({ text: answer, context: input.learningContext }),
      ...detectRubricMistakes(answer, rubric)
    ];

    const fullHit = maxCriterionHit(answer, rubric.fullCredit);
    const partialHit = maxCriterionHit(answer, rubric.partialCredit);
    const matchedRubricItems = matchedCriteria(answer, [...rubric.fullCredit, ...rubric.partialCredit]);
    const missingRubricItems = rubric.fullCredit.filter((item) => !matchedRubricItems.includes(item));
    const answerToQuestion = lexicalOverlap(answer, `${question.question} ${question.concept} ${question.learningObjective}`);
    const expectedOverlap = lexicalOverlap(answer, question.expectedAnswer);

    let score: 0 | 1 | 2 = 0;
    if (answer && fullHit >= 0.45 && expectedOverlap >= 0.24 && !misconceptions.length) score = 2;
    else if (answer && (partialHit >= 0.3 || expectedOverlap >= 0.16 || fullHit >= 0.25)) score = 1;

    if (misconceptions.length && score > 1) score = 1;
    if (answer && answerToQuestion < 0.08 && expectedOverlap < 0.08 && fullHit < 0.2) score = 0;
    if (!answer) score = 0;

    const mastery = score === 2 ? "understood" : score === 1 ? "partial" : "not_understood";
    const nextAction =
      score === 2 ? "move_on" : misconceptions.length ? "explain_again" : score === 1 ? "ask_followup" : "give_example";

    return {
      quizId: input.quizId ?? "ad-hoc-quiz",
      questionId: question.id,
      concept: question.concept,
      studentAnswer: answer,
      score,
      mastery,
      feedback: buildFeedback({ score, concept: question.concept, expected: question.expectedAnswer, rubric, misconceptions }),
      misconception: misconceptions[0],
      matchedRubricItems,
      missingRubricItems,
      nextAction,
      evidenceUsed: [
        {
          sourceType: "current_page",
          textPreview: summarize(question.sourceEvidence || sourceText(input.learningContext), 240)
        }
      ]
    };
  }
}

function buildFeedback(input: {
  score: 0 | 1 | 2;
  concept: string;
  expected: string;
  rubric: QuizScoringRubric;
  misconceptions: string[];
}): string {
  if (input.misconceptions.length) {
    const computeTip = /算力|算法/.test(input.misconceptions[0])
      ? "算法决定“怎么做”，算力是支撑训练和推理的计算资源，决定“能不能做得动、做得快”。"
      : "";
    return `你这里的主要问题是：${input.misconceptions[0]}${computeTip ? ` ${computeTip}` : ""} 这题的关键要点是：${input.rubric.fullCredit.slice(0, 2).join("；")}。`;
  }
  if (input.score === 2) {
    return `答得不错，你抓住了“${input.concept}”的核心。可以继续尝试把它和当前页其他概念联系起来。`;
  }
  if (input.score === 1) {
    return `你的回答有一部分正确，但还不完整。建议补上这些关键点：${input.rubric.fullCredit.slice(0, 2).join("；")}。`;
  }
  return `这道题还没有答到核心。请先回到当前页找到“${input.concept}”附近的证据，再用自己的话说明。参考要点：${summarize(input.expected, 180)}`;
}

function fallbackRubric(expectedAnswer: string): QuizScoringRubric {
  return {
    fullCredit: [expectedAnswer],
    partialCredit: ["能说出部分关键概念，但缺少关系或限制。"],
    commonMistakes: ["答非所问或把相近概念混为一谈。"]
  };
}

function detectRubricMistakes(answer: string, rubric: QuizScoringRubric): string[] {
  const normalizedAnswer = normalize(answer);
  return rubric.commonMistakes.filter((mistake) => {
    const normalizedMistake = normalize(mistake);
    if (!normalizedMistake) return false;
    if (normalizedAnswer.includes(normalizedMistake)) return true;
    return lexicalOverlap(answer, mistake) >= 0.42;
  });
}

function maxCriterionHit(answer: string, criteria: string[]): number {
  return Math.max(0, ...criteria.map((criterion) => lexicalOverlap(answer, criterion)));
}

function matchedCriteria(answer: string, criteria: string[]): string[] {
  return criteria.filter((criterion) => lexicalOverlap(answer, criterion) >= 0.3);
}

function lexicalOverlap(answer: string, expected: string): number {
  const a = tokenSet(answer);
  const b = tokenSet(expected);
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const token of a) if (b.has(token)) hit += 1;
  return hit / Math.min(a.size, b.size);
}

function tokenSet(text: string): Set<string> {
  const normalized = normalize(text);
  const tokens = normalized.match(/[a-z0-9_]+|[\u4e00-\u9fa5]{2,}/gi) ?? [];
  const expanded = new Set<string>();
  for (const token of tokens) {
    expanded.add(token);
    if (/[\u4e00-\u9fa5]{4,}/.test(token)) {
      for (let index = 0; index < token.length - 1; index += 1) expanded.add(token.slice(index, index + 2));
    }
  }
  return expanded;
}
