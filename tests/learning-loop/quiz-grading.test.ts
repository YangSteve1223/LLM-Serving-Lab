import test from "node:test";
import assert from "node:assert/strict";
import { MicroQuizGenerator, QuizGrader } from "../../src/agents/learningAssistant/index.ts";
import { aiThreeElementsContext, qualityQuizLlm } from "./fixtures.ts";

test("grades misconception and gives feedback", async () => {
  const context = aiThreeElementsContext();
  const quiz = await new MicroQuizGenerator({ llm: qualityQuizLlm() }).generate({ learningContext: context, targetConcepts: ["算力"], count: 2 });
  const result = new QuizGrader().grade({
    quizQuestion: quiz.questions[0],
    quizId: quiz.id,
    studentAnswer: "算力就是算法更聪明。",
    learningContext: context
  });
  assert.ok(result.score <= 1);
  assert.match(result.misconception ?? result.feedback, /算力|算法/);
  assert.match(result.feedback, /算法决定“怎么做”|算力是支撑训练和推理/);
  assert.equal(result.nextAction, "explain_again");
});
