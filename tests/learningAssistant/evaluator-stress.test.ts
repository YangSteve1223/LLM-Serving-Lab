import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LearningAssistantAgent,
  KimiLLMClient,
  MarkdownKnowledgeBase,
  OpenAICompatibleLLMClient,
  createLLMClientFromEnv,
  type LLMClient
} from "../../src/agents/learningAssistant/index.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, "..", "..");

test("current-page summary does not treat page number 1 as the topic", async () => {
  const response = await new LearningAssistantAgent().answer("这页主要讲什么？", aiElementsContext());

  assert.equal(response.decisionTrace.detectedIntent, "ask_current_page_summary");
  assert.equal(response.usedContext.usedCurrentPage, true);
  assert.ok(response.citations.some((citation) => citation.sourceType === "current_page"));
  assert.match(response.answer, /人工智能三要素/);
  assert.doesNotMatch(response.answer, /围绕.?1.?展开/);
  assert.notEqual(response.answerGenerationMode, "real_llm");
  assert.equal(response.generationDebug.usedTemplateFallback, true);
  assert.ok(["medium", "high"].includes(response.confidence));
});

test("unsupported exact formula and budget request refuses to invent", async () => {
  const response = await new LearningAssistantAgent({ kb: await realWikiKb() }).answer(
    "请给出 AlphaBetaZeta-927 的具体公式、数值推导和预算表。",
    aiElementsContext()
  );

  assert.ok(["ask_formula_or_derivation", "ask_budget_or_table"].includes(response.decisionTrace.detectedIntent));
  assert.equal(response.decisionTrace.answerability.status, "not_answerable");
  assert.equal(response.decisionTrace.answerability.shouldRefuseToInvent, true);
  assert.equal(response.confidence, "low");
  assert.equal(response.decisionTrace.groundingCheck.passed, true);
  assert.match(response.answer, /没有找到 AlphaBetaZeta-927|缺少足够依据|不能编造/);
  assert.doesNotMatch(response.answer, /人工智能三要素.*公式/);
  assert.equal(response.citations.some((citation) => citation.sourceType === "current_page"), false);
});

test("RAG comparison does not cite unrelated wiki chunks", async () => {
  const response = await new LearningAssistantAgent({ kb: await realWikiKb() }).answer(
    "RAG 和普通 LLM 问答有什么区别？",
    aiElementsContext()
  );

  assert.equal(response.decisionTrace.detectedIntent, "ask_comparison");
  assert.equal(response.decisionTrace.answerability.status, "answerable_from_general_knowledge");
  assert.match(response.answer, /当前页.*没有直接|通用知识/);
  assert.match(response.answer, /先检索|查资料|外部知识库/);
  assert.equal(response.citations.some((citation) => citation.sourceType === "wiki"), false);
  assert.equal(response.citations.some((citation) => citation.sourceType === "current_page"), false);
});

test("wiki workflow question cites Source Loop, Query Loop, and Maintenance Loop evidence", async () => {
  const response = await new LearningAssistantAgent({ kb: await realWikiKb() }).answer(
    "这个知识库里的运行流程是什么？",
    {}
  );

  assert.equal(response.usedSkills[0].status, "called");
  assert.equal(response.decisionTrace.retrievalDecision.resultStatus, "success");
  assert.ok(response.citations.some((citation) => citation.sourceType === "wiki"));
  assert.match(response.answer, /Source Loop/);
  assert.match(response.answer, /Query Loop/);
  assert.match(response.answer, /Maintenance Loop/);
  assert.ok(["medium", "high"].includes(response.confidence));
});

test("knowledge-base lookup can return empty without fabricating", async () => {
  const response = await new LearningAssistantAgent({ kb: await realWikiKb() }).answer(
    "AlphaBetaZeta-927 在知识库里有什么解释？",
    {}
  );

  assert.equal(response.usedSkills[0].status, "called");
  assert.equal(response.decisionTrace.retrievalDecision.resultStatus, "empty");
  assert.equal(response.decisionTrace.answerability.status, "not_answerable");
  assert.equal(response.confidence, "low");
  assert.match(response.answer, /AlphaBetaZeta-927|缺少足够依据|不能编造/);
  assert.equal(response.citations.length, 0);
});

test("demo mode can require a real LLM and refuse template fallback", async () => {
  const response = await new LearningAssistantAgent({ requireRealLlm: true }).answer("这页主要讲什么？", aiElementsContext());

  assert.equal(response.answerGenerationMode, "unavailable");
  assert.equal(response.generationDebug.llmConfigured, false);
  assert.equal(response.generationDebug.usedTemplateFallback, false);
  assert.match(response.answer, /LLM provider unavailable|真实模型/);
});

test("current-page concept question is answered from page evidence", async () => {
  const response = await new LearningAssistantAgent().answer("数据、算法、算力分别起什么作用？", aiElementsContext());

  assert.equal(response.decisionTrace.detectedIntent, "ask_current_page_concept");
  assert.equal(response.usedContext.usedCurrentPage, true);
  assert.ok(response.citations.some((citation) => citation.sourceType === "current_page"));
  assert.equal(response.usedSkills[0].status, "skipped");
  assert.equal(response.confidence, "high");
  assert.match(response.answer, /数据|算法|算力/);
});

test("manual style override remains visible and changes template fallback wording", async () => {
  const analogy = await new LearningAssistantAgent().answer("数据、算法、算力分别起什么作用？", {
    ...aiElementsContext(),
    learner: { profile: { level: "intermediate", stylePreference: "analogy" } }
  });
  const deep = await new LearningAssistantAgent().answer("数据、算法、算力分别起什么作用？", {
    ...aiElementsContext(),
    learner: { profile: { level: "advanced", stylePreference: "deep_dive" } }
  });

  assert.equal(analogy.teachingPolicy.source, "user_override");
  assert.equal(analogy.teachingPolicy.style, "analogy");
  assert.equal(deep.teachingPolicy.style, "deep_dive");
  assert.match(analogy.answer, /直观类比/);
  assert.match(deep.answer, /深入一层/);
});

test("current-page evidence-chain prompt is handled as a current-page teaching question", async () => {
  const response = await new LearningAssistantAgent().answer("不要直接给结论，你引导我判断这页最关键的证据链是什么。", {
    ...aiElementsContext(),
    learner: { profile: { level: "intermediate", stylePreference: "socratic" } }
  });

  assert.equal(response.decisionTrace.detectedIntent, "ask_current_page_concept");
  assert.notEqual(response.decisionTrace.answerability.status, "not_answerable");
  assert.equal(response.usedContext.usedCurrentPage, true);
  assert.ok(response.citations.some((citation) => citation.sourceType === "current_page"));
});

test("English this-page prompt is treated as current-page context", async () => {
  const response = await new LearningAssistantAgent().answer(
    "What is this page trying to teach about evidence-grounded learning assistants?",
    aiElementsContext()
  );

  assert.equal(response.decisionTrace.detectedIntent, "ask_current_page_concept");
  assert.equal(response.usedContext.usedCurrentPage, true);
  assert.ok(response.citations.some((citation) => citation.sourceType === "current_page"));
});

test("LLM provider injection is explicit in generation debug info", async () => {
  const calls: Array<Array<{ role: string; content: string }>> = [];
  const llm: LLMClient = {
    providerName: "mock-provider",
    modelName: "mock-model",
    isMock: true,
    async generate(messages) {
      calls.push(messages);
      return "mock model answer";
    }
  };

  const response = await new LearningAssistantAgent({ llm }).answer("这页主要讲什么？", aiElementsContext());

  assert.equal(calls.length, 1);
  assert.equal(response.answerGenerationMode, "mock_llm");
  assert.equal(response.generationDebug.providerName, "mock-provider");
  assert.equal(response.generationDebug.modelName, "mock-model");
  assert.equal(response.generationDebug.rawLlmCalled, true);
  assert.match(calls[0][1].content, /selectedEvidence/);
});

test("OpenAI-compatible LLM client builds a chat-completions request and returns model text", async () => {
  const requests: Array<{ url: string; init: RequestInit; body: any }> = [];
  const client = new OpenAICompatibleLLMClient({
    apiKey: "test-key",
    baseUrl: "https://example.test/v1/",
    model: "test-model",
    temperature: 0.2,
    maxTokens: 128,
    fetchFn: async (url, init) => {
      requests.push({
        url: String(url),
        init: init ?? {},
        body: JSON.parse(String(init?.body ?? "{}"))
      });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            choices: [{ message: { content: "model answer" } }]
          });
        }
      } as Response;
    }
  });

  const answer = await client.generate([{ role: "user", content: "hello" }]);

  assert.equal(answer, "model answer");
  assert.equal(requests[0].url, "https://example.test/v1/chat/completions");
  assert.equal(requests[0].body.model, "test-model");
  assert.equal(requests[0].init.headers?.["authorization" as keyof HeadersInit], "Bearer test-key");
});

test("OpenAI-compatible LLM client retries transient overload responses", async () => {
  let calls = 0;
  const client = new OpenAICompatibleLLMClient({
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    retryDelayMs: 1,
    fetchFn: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          async text() {
            return JSON.stringify({ error: { message: "The engine is currently overloaded" } });
          }
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ choices: [{ message: { content: "retry success" } }] });
        }
      } as Response;
    }
  });

  const answer = await client.generate([{ role: "user", content: "hello" }]);

  assert.equal(answer, "retry success");
  assert.equal(calls, 2);
});

test("Kimi k2.5 client omits unsupported temperature and disables thinking by default", async () => {
  const requests: Array<{ body: any }> = [];
  const client = new KimiLLMClient({
    apiKey: "test-key",
    model: "kimi-k2.5",
    temperature: 0.2,
    fetchFn: async (_url, init) => {
      requests.push({ body: JSON.parse(String(init?.body ?? "{}")) });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            choices: [{ message: { content: "kimi answer" } }]
          });
        }
      } as Response;
    }
  });

  const answer = await client.generate([{ role: "user", content: "hello" }]);

  assert.equal(answer, "kimi answer");
  assert.equal(requests[0].body.model, "kimi-k2.5");
  assert.equal(requests[0].body.temperature, undefined);
  assert.deepEqual(requests[0].body.thinking, { type: "disabled" });
});

test("environment factory creates Kimi client without exposing the API key", () => {
  const result = createLLMClientFromEnv({
    KIMI_API_KEY: "secret-key",
    KIMI_MODEL: "kimi-k2.5",
    KIMI_BASE_URL: "https://api.moonshot.cn/v1"
  });

  assert.ok(result.client);
  assert.equal(result.config?.provider, "kimi");
  assert.equal(result.config?.model, "kimi-k2.5");
  assert.doesNotMatch(JSON.stringify(result.config), /secret-key/);
});

function aiElementsContext() {
  return {
    currentPage: {
      id: "ai-elements-page-1",
      pageIndex: 1,
      pageLabel: "1",
      title: "1",
      text: [
        "1",
        "人工智能三要素",
        "人工智能的快速发展依赖于三个核心要素：数据、算法、算力。",
        "数据是知识来源。",
        "算力支撑训练和推理。",
        "算法决定模型能力。"
      ].join("\n"),
      bulletPoints: ["数据是知识来源", "算力支撑训练和推理", "算法决定模型能力"]
    },
    currentPageSummary: {
      source: "auto_summary" as const,
      text: "人工智能三要素：数据、算法、算力。"
    },
    teacherScript: { source: "missing" as const },
    outline: {
      source: "inferred_from_deck" as const,
      items: [{ id: "outline-page-1", title: "人工智能三要素", pageStart: 1, pageEnd: 1 }]
    }
  };
}

async function realWikiKb(): Promise<MarkdownKnowledgeBase> {
  const wikiPath = path.join(rootDir, "Education_LLM_Wiki_Operating_Package", "Education_LLM_Wiki_Operating_Package");
  return MarkdownKnowledgeBase.fromPaths({
    rootDir,
    paths: [path.relative(rootDir, wikiPath)]
  });
}
