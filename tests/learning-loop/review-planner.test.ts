import test from "node:test";
import assert from "node:assert/strict";
import { ReviewPlanner } from "../../src/agents/learningAssistant/index.ts";

test("plans review based on quiz score and misconception", () => {
  const tasks = new ReviewPlanner().planFromQuizResult({
    quizId: "quiz",
    questionId: "q1",
    concept: "算力",
    studentAnswer: "算力是算法更聪明",
    score: 0,
    mastery: "not_understood",
    feedback: "混淆",
    misconception: "把算力和算法混淆",
    nextAction: "explain_again"
  });
  assert.ok(tasks.some((task) => task.reason === "wrong_answer"));
  assert.ok(tasks.some((task) => task.reason === "misconception" && task.taskType === "explain_back"));
});
