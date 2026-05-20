import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LearningAssistantAgent,
  LearningContextBuilder,
  MarkdownKnowledgeBase,
  createMaterialProvider,
  materialToMarkdown,
  pageToMarkdown,
  type LearningMaterial
} from "../../src/agents/learningAssistant/index.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, "..", "..");

test("loads an arbitrary PPTX, extracts page text, and page switching updates current page context", async (t) => {
  const files = await fixturePptxFiles();
  if (files.length === 0) {
    t.skip("Set TEST_PPT_DIR or add PPTX files under the local test fixture directory.");
    return;
  }

  const material = await loadMaterial(files[0]);
  assert.equal(material.type, "pptx");
  assert.ok(material.pageCount >= 1);
  assert.ok(material.pages[0].text.length > 0);

  if (material.pageCount > 1) {
    const builder = new LearningContextBuilder();
    const first = builder.build({ material, pageIndex: 1 });
    const secondIndex = findDifferentPageIndex(material, 1) ?? 2;
    const second = builder.build({ material, pageIndex: secondIndex });

    assert.equal(first.currentPage?.pageIndex, 1);
    assert.equal(second.currentPage?.pageIndex, secondIndex);
    assert.notEqual(first.currentPage?.id, second.currentPage?.id);
    assert.notEqual(normalize(first.currentPage?.text), normalize(second.currentPage?.text));
  }
});

test("free-form current-page question is grounded in active page and returns new decision trace", async (t) => {
  const files = await fixturePptxFiles();
  if (files.length === 0) {
    t.skip("Set TEST_PPT_DIR or add PPTX files under the local test fixture directory.");
    return;
  }

  const material = await loadMaterial(files[0]);
  const context = new LearningContextBuilder().build({
    material,
    pageIndex: firstTextPageIndex(material),
    learner: { profile: { level: "intermediate", language: "zh" } }
  });

  const response = await new LearningAssistantAgent().answer("这页主要讲什么？", context);

  assert.equal(response.usedContext.usedCurrentPage, true);
  assert.equal(response.decisionTrace.detectedIntent, "ask_current_page_summary");
  assert.equal(response.decisionTrace.evidenceSelection.selectedCount > 0, true);
  assert.equal(response.decisionTrace.groundingCheck.passed, true);
  assert.ok(response.citations.some((citation) => citation.sourceType === "current_page"));
  assert.match(response.answer, /这页主要|当前页|主要讲/);
});

test("same question on different pages produces page-specific responses", async (t) => {
  const files = await fixturePptxFiles();
  if (files.length === 0) {
    t.skip("Set TEST_PPT_DIR or add PPTX files under the local test fixture directory.");
    return;
  }

  const material = await loadMaterial(files[0]);
  if (material.pageCount < 2) {
    t.skip("Fixture deck has only one page.");
    return;
  }

  const firstIndex = firstTextPageIndex(material);
  const secondIndex = findDifferentPageIndex(material, firstIndex);
  if (!secondIndex) {
    t.skip("Fixture deck does not have two distinct text pages.");
    return;
  }

  const builder = new LearningContextBuilder();
  const agent = new LearningAssistantAgent();
  const first = await agent.answer("这页的核心内容是什么？", builder.build({ material, pageIndex: firstIndex }));
  const second = await agent.answer("这页的核心内容是什么？", builder.build({ material, pageIndex: secondIndex }));

  assert.notEqual(first.citations[0]?.pageIndex, second.citations[0]?.pageIndex);
  assert.notEqual(normalize(first.answer), normalize(second.answer));
});

test("PPTX can be normalized to Markdown and loaded through the markdown material provider", async (t) => {
  const files = await fixturePptxFiles();
  if (files.length === 0) {
    t.skip("Set TEST_PPT_DIR or add PPTX files under the local test fixture directory.");
    return;
  }

  const material = await loadMaterial(files[0]);
  const markdown = materialToMarkdown(material);

  assert.match(markdown, /#\s+.+/);
  assert.match(markdown, /## Slide 1/m);
  assert.equal(pageToMarkdown(material.pages[0]).includes(material.pages[0].text.slice(0, 12)), true);
});

test("explicit request for knowledge-base support calls retrieval and may reject unrelated chunks", async () => {
  const kb = await realWikiKb();
  const material = markdownMaterialFixture();
  const context = new LearningContextBuilder().build({ material, pageIndex: 1 });
  const response = await new LearningAssistantAgent({ kb }).answer(
    "除了当前 PPT，这个概念在知识库里有没有更完整的解释？",
    context
  );

  assert.equal(response.teachingPolicy.shouldRetrieveKnowledge, true);
  assert.equal(response.usedSkills[0].status, "called");
  assert.equal(response.decisionTrace.retrievalDecision.called, true);
  assert.ok(["success", "empty"].includes(response.decisionTrace.retrievalDecision.resultStatus ?? ""));
  assert.equal(typeof response.decisionTrace.evidenceSelection.rejectedCount, "number");
});

async function loadMaterial(filePath: string): Promise<LearningMaterial> {
  const provider = createMaterialProvider({
    type: "pptx",
    filePath,
    metadata: { workspaceRoot: rootDir }
  });
  return provider.load({
    type: "pptx",
    filePath,
    metadata: { workspaceRoot: rootDir }
  });
}

async function fixturePptxFiles(): Promise<string[]> {
  const configured = process.env.TEST_PPT_DIR
    ? path.resolve(process.env.TEST_PPT_DIR)
    : path.join(rootDir, "测试集", "测试PPT");
  try {
    const entries = await readdir(configured, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pptx"))
      .map((entry) => path.join(configured, entry.name))
      .sort();
  } catch {
    return [];
  }
}

async function realWikiKb(): Promise<MarkdownKnowledgeBase> {
  const wikiPath = path.join(rootDir, "Education_LLM_Wiki_Operating_Package", "Education_LLM_Wiki_Operating_Package");
  return MarkdownKnowledgeBase.fromPaths({
    rootDir,
    paths: [path.relative(rootDir, wikiPath)]
  });
}

function markdownMaterialFixture(): LearningMaterial {
  return {
    id: "retrieval-fixture",
    type: "markdown",
    title: "检索增强问答",
    pageCount: 1,
    pages: [
      {
        id: "retrieval-fixture-page-1",
        pageIndex: 1,
        title: "检索增强问答",
        text: "当前页说明：学习助教可以在回答前检索本地知识库，用引用降低幻觉。"
      }
    ],
    outline: {
      source: "inferred_from_deck",
      items: [{ id: "retrieval-fixture-page-1", title: "检索增强问答", pageStart: 1, pageEnd: 1 }]
    }
  };
}

function firstTextPageIndex(material: LearningMaterial): number {
  return material.pages.find((page) => page.text.trim().length > 0)?.pageIndex ?? 1;
}

function findDifferentPageIndex(material: LearningMaterial, pageIndex: number): number | undefined {
  const base = normalize(material.pages.find((page) => page.pageIndex === pageIndex)?.text);
  return material.pages.find((page) => page.pageIndex !== pageIndex && normalize(page.text) && normalize(page.text) !== base)
    ?.pageIndex;
}

function normalize(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}
