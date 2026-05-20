import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { LearnerMemoryStore } from "../../src/agents/learningAssistant/index.ts";

test("updates learner memory without storing api keys", async () => {
  const dataDir = path.join(process.cwd(), "tests", "learning-loop", ".tmp-memory");
  const store = new LearnerMemoryStore({ rootDir: process.cwd(), dataDir });
  await store.clearMemory("unit-learner");
  // Intentional fake key fixture for redaction testing; not a real secret.
  const memory = await store.updateMemoryWithQuizResult("unit-learner", {
    quizId: "q",
    questionId: "q1",
    concept: "算力",
    studentAnswer: "算力就是算法更聪明 sk-THISSHOULDNOTBESAVED1234567890",
    score: 0,
    mastery: "not_understood",
    feedback: "混淆算法和算力",
    misconception: "把算力和算法混淆",
    nextAction: "explain_again"
  });
  assert.ok(memory.weakConcepts.includes("算力"));
  assert.equal(memory.misconceptions[0].count, 1);
  const raw = await fs.readFile(path.join(dataDir, "unit-learner.json"), "utf8");
  assert.doesNotMatch(raw, /sk-THISSHOULDNOTBESAVED/);
});
