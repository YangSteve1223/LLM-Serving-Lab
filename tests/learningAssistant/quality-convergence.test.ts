import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LearningAssistantAgent,
  LearningContextBuilder,
  createMaterialProvider,
  type KnowledgeBase,
  type LearningContext,
  type LearningMaterial,
  type RetrievalResult,
  type RetrievedChunk
} from "../../src/agents/learningAssistant/index.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, "..", "..");

test("summaries vary across non-agent PPT contexts and do not leak wiki operating terms", async (t) => {
  const pptDir = process.env.TEST_PPT_DIR ? path.resolve(process.env.TEST_PPT_DIR) : path.join(rootDir, "测试集", "测试PPT");
  const files = await pptxFiles(pptDir);
  if (files.length < 3) {
    t.skip("Need at least 3 PPTX files under TEST_PPT_DIR for cross-deck generalization.");
    return;
  }

  const contexts: LearningContext[] = [];
  const selected = [
    { file: files.find((file) => path.basename(file).includes("test1")) ?? files[0], page: 1 },
    { file: files.find((file) => path.basename(file).includes("test2")) ?? files[1], page: 3 },
    { file: files.find((file) => path.basename(file).includes("赵")) ?? files[2], page: 4 }
  ];

  for (const item of selected) {
    const material = await loadPptx(item.file);
    contexts.push(new LearningContextBuilder().build({ material, pageIndex: boundedPage(material, item.page) }));
  }

  const agent = new LearningAssistantAgent();
  const responses = await Promise.all(contexts.map((context) => agent.answer("这页主要讲什么？", context)));
  const normalized = responses.map((response) => normalize(response.answer));

  assert.equal(new Set(normalized).size, responses.length);
  for (const response of responses) {
    assert.equal(response.usedContext.usedCurrentPage, true);
    assert.ok(response.decisionTrace.contextRelevance.currentPage.score >= 0.9);
    assert.doesNotMatch(response.answer, /Source Loop|Query Loop|Maintenance Loop|answer_query_and_writeback|compile_wiki_pages/);
  }
});

test("PPTX semantic titles prefer real slide titles over body sentences or page numbers", async () => {
  const pptPath = path.join(rootDir, "测试集", "测试PPT", "test1.pptx");
  const material = await loadPptx(pptPath);

  assert.equal(material.pages[0].semanticTitle, "人工智能三要素");
  assert.equal(material.pages[0].pageLabel, "1");
  assert.equal(material.pages[1].semanticTitle, "人工智能三要素：数据");
  assert.notEqual(material.pages[0].semanticTitle, "数据( Data )是AI的“知识来源”，决定模型的知识边界。");
});

test("concept reference query resolves from current page before retrieval", async () => {
  let capturedQuery = "";
  const kb = fakeKb({
    status: "empty",
    chunks: [],
    rejectedChunks: [
      {
        chunk: chunk("rejected-flow", "AGENTS.md", "Source Loop / Query Loop / Maintenance Loop"),
        reason: "failed hard relevance rule for the query entity/concept"
      }
    ],
    topScore: 9,
    relevanceThreshold: 3.2,
    evidenceSufficient: false
  }, (query) => {
    capturedQuery = query;
  });

  const response = await new LearningAssistantAgent({ kb }).answer(
    "除了当前 PPT，这个概念在知识库里有没有更完整的解释？",
    conceptPageContext()
  );

  assert.match(capturedQuery, /证据驱动回答/);
  assert.equal(response.usedSkills[0].status, "called");
  assert.equal(response.retrievalDebug?.status, "empty");
  assert.match(response.answer, /我先按“证据驱动回答”/);
  assert.doesNotMatch(response.answer, /Source Loop|Query Loop|Maintenance Loop/);
});

test("knowledge-base citations ignore title-only chunks and keep substantive evidence", async () => {
  const thin = chunk("title-only", "answer_query_and_writeback.md", "# answer_query_and_writeback");
  const substantive = chunk(
    "substantive-skill",
    "answer_query_and_writeback.md",
    [
      "# answer_query_and_writeback",
      "Purpose: answer a learner query using retrieved evidence and decide whether a writeback is needed.",
      "Inputs: query, selected evidence, current learning context, and policy.",
      "Steps: retrieve supporting chunks, answer from evidence, reflect on gaps, and record useful feedback."
    ].join("\n")
  );
  const kb = fakeKb({
    status: "success",
    chunks: [thin, substantive],
    topScore: 9,
    relevanceThreshold: 3.2,
    evidenceSufficient: true
  });

  const response = await new LearningAssistantAgent({ kb }).answer(
    "知识库里 answer_query_and_writeback 这个 skill 的 Purpose、Inputs、Steps 是什么？",
    {}
  );

  assert.ok(response.citations.some((citation) => citation.chunkId === "substantive-skill"));
  assert.equal(response.citations.some((citation) => citation.chunkId === "title-only"), false);
  assert.ok(response.evidenceDebug.rejected.some((item) => item.evidence.chunkId === "title-only"));
});

test("current-page summary has normalized high current-page relevance", async () => {
  const response = await new LearningAssistantAgent().answer("这页主要讲什么？", {
    currentPage: {
      id: "math-page",
      pageIndex: 1,
      title: "导数的几何意义",
      semanticTitle: "导数的几何意义",
      text: "导数可以理解为函数图像在某一点的切线斜率。常见公式是 f'(x)=lim(h->0)[f(x+h)-f(x)]/h。"
    }
  });

  assert.equal(response.decisionTrace.answerability.status, "answerable_from_current_page");
  assert.equal(response.confidence, "high");
  assert.ok(response.decisionTrace.contextRelevance.currentPage.score >= 0.9);
  assert.ok(response.decisionTrace.contextRelevance.currentPage.score <= 1);
  assert.ok(response.decisionTrace.contextRelevance.knowledgeBase.score <= 1);
});

test("refusal answer uses Chinese missing evidence and cleans slide markdown title", async () => {
  const response = await new LearningAssistantAgent({ kb: fakeKb({ status: "empty", chunks: [], topScore: 0, relevanceThreshold: 5.8, evidenceSufficient: false }) }).answer(
    "请给出 AlphaBetaZeta-927 的具体公式、数值推导和预算表。",
    {
      currentPage: {
        id: "evidence-page",
        pageIndex: 2,
        title: "## Slide 2: 证据驱动回答",
        semanticTitle: "## Slide 2: 证据驱动回答",
        text: "证据驱动回答要求只使用能支持答案的当前页、讲稿或知识库证据。"
      }
    }
  );

  assert.equal(response.confidence, "low");
  assert.match(response.answer, /缺少明确公式或推导过程/);
  assert.match(response.answer, /缺少预算表或成本数据/);
  assert.match(response.answer, /当前页《证据驱动回答》没有提供/);
  assert.doesNotMatch(response.answer, /requiredEvidence|missingEvidence|not_answerable/);
  assert.doesNotMatch(response.answer, /## Slide 2/);
});

test("mock platform context prioritizes platform outline and teacher script", async () => {
  const response = await new LearningAssistantAgent().answer("这页的平台教师讲稿强调了什么？", {
    outline: {
      source: "platform",
      items: [
        { id: "unit-1", title: "平台传入大纲：证据驱动问答", summary: "来自平台，而不是 PPT 推断。", pageStart: 1, pageEnd: 3 }
      ]
    },
    currentPage: {
      id: "platform-page-2",
      pageIndex: 2,
      title: "证据驱动回答链路",
      semanticTitle: "证据驱动回答链路",
      text: "当前页介绍助教如何结合当前页、平台大纲、教师讲稿和知识库证据回答。"
    },
    teacherScript: {
      source: "platform",
      text: "教师讲稿强调：回答前先判断问题是否和当前页相关，再选择可靠证据，资料不足时不要编造。"
    },
    learner: {
      profile: { level: "beginner", language: "zh", preferences: ["多给例子"] },
      inferredState: { confusionLevel: "medium", likelyIntent: "needs context-first explanation" },
      progress: { currentPageIndex: 2, completedPages: [1] }
    },
    chatHistory: [
      { role: "user", content: "我总是分不清模型知识和课程证据。" },
      { role: "assistant", content: "我们可以先看当前页和讲稿里哪些内容能支持答案。" }
    ],
    platformMetadata: { courseId: "mock-course", source: "platform-context-test" }
  });

  assert.equal(response.usedContext.usedOutline, true);
  assert.equal(response.usedContext.usedTeacherScript, true);
  assert.equal(response.usedContext.usedLearnerProfile, true);
  assert.equal(response.usedContext.usedChatHistory, true);
  assert.ok(response.citations.some((citation) => citation.sourceType === "outline" && citation.sourceId === "platform"));
  assert.ok(response.citations.some((citation) => citation.sourceType === "teacher_script"));
});

test("current page citations include deck file name, semantic title, page index, preview, and text preview", async () => {
  const response = await new LearningAssistantAgent().answer("这页主要讲什么？", {
    material: {
      id: "test1",
      type: "pptx",
      title: "test1",
      filePath: path.join(rootDir, "测试集", "测试PPT", "test1.pptx"),
      pageCount: 17
    },
    currentPage: {
      id: "test1-page-1",
      pageIndex: 1,
      pageLabel: "1",
      title: "人工智能三要素",
      semanticTitle: "人工智能三要素",
      text: "1\n人工智能三要素\n数据、算法、算力是人工智能发展的三个核心要素。",
      previewImageUrl: "/api/material/test1/pages/1/preview"
    }
  });

  const current = response.citations.find((citation) => citation.sourceType === "current_page");
  assert.equal(current?.fileName, "test1.pptx");
  assert.equal(current?.pageIndex, 1);
  assert.equal(current?.semanticTitle, "人工智能三要素");
  assert.equal(current?.previewImageUrl, "/api/material/test1/pages/1/preview");
  assert.match(current?.textPreview ?? "", /数据、算法、算力/);
});

async function pptxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pptx"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

async function loadPptx(filePath: string): Promise<LearningMaterial> {
  const provider = createMaterialProvider({ type: "pptx", filePath, metadata: { workspaceRoot: rootDir } });
  return provider.load({ type: "pptx", filePath, metadata: { workspaceRoot: rootDir } });
}

function boundedPage(material: LearningMaterial, pageIndex: number): number {
  return Math.min(Math.max(1, pageIndex), material.pageCount);
}

function conceptPageContext(): LearningContext {
  return {
    currentPage: {
      id: "concept-page",
      pageIndex: 2,
      title: "证据驱动回答",
      semanticTitle: "证据驱动回答",
      text: "本页说明证据驱动回答：助教先判断问题是否与当前页相关，再检索知识库证据，最后只引用真正支持答案的来源。",
      bulletPoints: ["证据驱动回答", "知识库检索", "引用来源"]
    },
    outline: {
      source: "inferred_from_deck",
      items: [{ id: "concept-page", title: "证据驱动回答", pageStart: 2, pageEnd: 2 }]
    }
  };
}

function fakeKb(result: Partial<RetrievalResult>, onQuery?: (query: string) => void): KnowledgeBase {
  return {
    async retrieve(query) {
      onQuery?.(query);
      return result.chunks ?? [];
    },
    async retrieveWithDiagnostics(query) {
      onQuery?.(query);
      return {
        status: result.status ?? "empty",
        query,
        chunks: result.chunks ?? [],
        rejectedChunks: result.rejectedChunks,
        topScore: result.topScore,
        relevanceThreshold: result.relevanceThreshold ?? 4.2,
        evidenceSufficient: result.evidenceSufficient ?? false
      };
    }
  };
}

function chunk(chunkId: string, fileName: string, text: string): RetrievedChunk {
  return {
    chunkId,
    text,
    score: 9,
    sourceType: "wiki",
    filePath: `wiki/${fileName}`,
    fileName,
    title: fileName,
    sectionTitle: fileName.replace(/\.md$/, "")
  };
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
