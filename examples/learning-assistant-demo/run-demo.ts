import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LearningAssistantAgent,
  LearningContextBuilder,
  MarkdownKnowledgeBase,
  createLLMClientFromEnv,
  createMaterialProvider
} from "../../src/agents/learningAssistant/index.ts";

const currentFile = fileURLToPath(import.meta.url);
const demoDir = path.dirname(currentFile);
const rootDir = path.resolve(demoDir, "..", "..");
const sampleMaterialPath = path.join(demoDir, "sample-material.md");
const wikiPath = path.join(rootDir, "Education_LLM_Wiki_Operating_Package", "Education_LLM_Wiki_Operating_Package");

const provider = createMaterialProvider({ type: "markdown", filePath: sampleMaterialPath });
const material = await provider.load({ type: "markdown", filePath: sampleMaterialPath });
const context = new LearningContextBuilder().build({
  material,
  pageIndex: 2,
  learner: {
    profile: {
      level: "beginner",
      language: "zh",
      stylePreference: "auto"
    }
  }
});
const kb = await MarkdownKnowledgeBase.fromPaths({
  rootDir,
  paths: [path.relative(rootDir, wikiPath)]
});
const llm = createLLMClientFromEnv();
const agent = new LearningAssistantAgent({
  kb,
  llm: llm.client,
  requireRealLlm: /^true$/i.test(process.env.REQUIRE_REAL_LLM_FOR_DEMO ?? "")
});

console.log(
  llm.client
    ? `LLM provider enabled: ${llm.config?.provider} / ${llm.config?.model}`
    : `LLM provider disabled: ${llm.reason}`
);

const questions = [
  "这页主要讲什么？",
  "这个知识库里的运行流程是什么？",
  "请给出 AlphaBetaZeta-927 的具体公式、数值推导和预算表。",
  "RAG 和普通 LLM 问答有什么区别？"
];

for (const query of questions) {
  const response = await agent.answer(query, context);
  console.log(`\n## Q: ${query}`);
  console.log(response.answer);
  console.log(
    JSON.stringify(
      {
        intent: response.decisionTrace.detectedIntent,
        answerability: response.decisionTrace.answerability.status,
        style: response.teachingPolicy.style,
        skill: response.usedSkills[0],
        confidence: response.confidence,
        answerGenerationMode: response.answerGenerationMode,
        citations: response.citations.map((citation) => ({
          sourceType: citation.sourceType,
          title: citation.title,
          chunkId: citation.chunkId
        }))
      },
      null,
      2
    )
  );
}
