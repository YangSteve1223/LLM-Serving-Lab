import type { QuizGradingResult, ReviewTask } from "./types.ts";
import { daysFromNow, stableId } from "./learningLoopUtils.ts";

export class ReviewPlanner {
  planFromQuizResult(result: QuizGradingResult, sourcePageId?: string): ReviewTask[] {
    const tasks: ReviewTask[] = [];
    const hasMisconception = Boolean(result.misconception);
    const days = result.score === 0 ? 1 : result.score === 1 ? 3 : 7;

    tasks.push({
      id: stableId("review", `${result.quizId}-${result.questionId}-${result.concept}-${days}`),
      concept: result.concept,
      reason: result.score === 2 ? "important" : result.score === 1 ? "weak" : "wrong_answer",
      dueAt: daysFromNow(days),
      taskType: result.score === 2 ? "recall" : "quiz",
      sourcePageId,
      status: "pending"
    });

    if (hasMisconception) {
      tasks.push({
        id: stableId("review", `${result.quizId}-${result.questionId}-${result.concept}-misconception`),
        concept: result.concept,
        reason: "misconception",
        dueAt: daysFromNow(1),
        taskType: "explain_back",
        sourcePageId,
        status: "pending"
      });
    }

    return tasks;
  }
}
