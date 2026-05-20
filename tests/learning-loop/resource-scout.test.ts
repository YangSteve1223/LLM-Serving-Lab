import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ResourceLibraryStore, ResourceScoutAgent } from "../../src/agents/learningAssistant/index.ts";
import { ragContext } from "./fixtures.ts";

test("recommends resources with learning goal and check question", async () => {
  const store = new ResourceLibraryStore({
    rootDir: process.cwd(),
    filePath: path.join(process.cwd(), "tests", "learning-loop", ".tmp-resource-library", "resources.json")
  });
  await store.saveResources([
    {
      id: "teacher-rag-ibm",
      title: "What is retrieval-augmented generation?",
      platform: "school",
      url: "https://www.ibm.com/topics/retrieval-augmented-generation",
      concepts: ["RAG", "检索", "evidence"],
      difficulty: "intermediate",
      type: "article",
      sourceName: "IBM",
      credibility: "high",
      verified: true,
      description: "教师导入的 RAG 概念补充材料。"
    }
  ]);
  const agent = new ResourceScoutAgent({ resourceStore: store });
  const recommendations = await agent.recommend({ learningContext: ragContext(), learnerLevel: "intermediate" });
  assert.ok(recommendations.length > 0);
  assert.match(recommendations[0].resource.concepts.join(" "), /RAG|检索|evidence/i);
  assert.equal(recommendations[0].verified, true);
  assert.ok(recommendations[0].beforeLearningQuestion);
  assert.ok(recommendations[0].afterLearningCheckQuestion);
});
