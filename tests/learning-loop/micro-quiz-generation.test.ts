import test from "node:test";
import assert from "node:assert/strict";
import { MicroQuizGenerator, QuizGenerationUnavailableError } from "../../src/agents/learningAssistant/index.ts";
import { aiThreeElementsContext, qualityQuizLlm } from "./fixtures.ts";

test("does not generate micro quiz without a real LLM", async () => {
  const generator = new MicroQuizGenerator();
  await assert.rejects(
    () => generator.generate({ learningContext: aiThreeElementsContext(), count: 3 }),
    QuizGenerationUnavailableError
  );
});

test("generates micro quiz from current page evidence", async () => {
  const generator = new MicroQuizGenerator({ llm: qualityQuizLlm() });
  const quiz = await generator.generate({ learningContext: aiThreeElementsContext(), count: 3 });
  assert.equal(quiz.pageTitle, "人工智能三要素");
  assert.ok(quiz.questions.length >= 2);
  assert.ok(quiz.questions.every((question) => question.expectedAnswer.length > 0));
  assert.ok(quiz.questions.every((question) => question.scoringRubric.fullCredit.length > 0));
  assert.ok(quiz.questions.every((question) => question.sourceEvidence.length > 0));
  assert.ok((quiz.quality?.score ?? 0) >= 75);
  assert.doesNotMatch(JSON.stringify(quiz), /AlphaBetaZeta|预算表/);
});
