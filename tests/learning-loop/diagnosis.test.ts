import test from "node:test";
import assert from "node:assert/strict";
import { LearningDiagnosisAgent } from "../../src/agents/learningAssistant/index.ts";
import { aiThreeElementsContext } from "./fixtures.ts";

test("diagnoses concept confusion from current learning context", () => {
  const agent = new LearningDiagnosisAgent();
  const diagnosis = agent.diagnose({
    query: "我还是不懂数据、算法、算力区别",
    learningContext: aiThreeElementsContext()
  });
  assert.equal(diagnosis.intent, "concept_confusion");
  assert.match(diagnosis.confusionPoints.join(" "), /数据|算法|算力/);
  assert.ok(["analogy", "micro_quiz", "explain"].includes(diagnosis.recommendedIntervention));
});

test("detects misconception when compute is confused with algorithm", () => {
  const agent = new LearningDiagnosisAgent();
  const diagnosis = agent.diagnose({
    query: "算力就是算法更聪明吧？",
    learningContext: aiThreeElementsContext()
  });
  assert.equal(diagnosis.intent, "misconception");
  assert.match(diagnosis.possibleMisconceptions.join(" "), /算力.*算法|算法.*算力/);
});
