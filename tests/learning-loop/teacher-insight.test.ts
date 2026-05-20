import test from "node:test";
import assert from "node:assert/strict";
import { TeacherInsightAgent } from "../../src/agents/learningAssistant/index.ts";

test("aggregates class misconceptions without exposing individual detail", () => {
  const report = new TeacherInsightAgent().generateReport({
    courseId: "c",
    lessonId: "l",
    startedAt: new Date().toISOString(),
    students: [
      {
        learnerId: "student-1",
        questions: ["算力和算法有什么区别？"],
        weakConcepts: ["算法与算力的区别"],
        misconceptions: ["把算力理解成算法更聪明"],
        quizResults: []
      },
      {
        learnerId: "student-2",
        questions: ["为什么只有算法不够？"],
        weakConcepts: ["算法与算力的区别"],
        misconceptions: ["混淆算法和算力"],
        quizResults: []
      }
    ]
  });
  assert.ok(report.commonConfusions.some((item) => item.concept.includes("算法")));
  assert.ok(report.suggestedInterventions.length > 0);
  assert.match(report.privacyNote, /隐私|个人/);
});
