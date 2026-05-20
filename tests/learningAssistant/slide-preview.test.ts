import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  LearningAssistantAgent,
  LearningContextBuilder,
  PowerPointComSlideRenderer,
  applySlidePreviewManifest,
  createMaterialProvider
} from "../../src/agents/learningAssistant/index.ts";

const rootDir = process.cwd();
const pptPath = process.env.TEST_PREVIEW_PPT
  ? path.resolve(process.env.TEST_PREVIEW_PPT)
  : path.join(rootDir, "测试集", "测试PPT", "test1.pptx");

test("PPTX loading can generate slide preview images", async () => {
  const renderer = new PowerPointComSlideRenderer({ rootDir });
  const canRender = await renderer.canRender({ type: "pptx", filePath: pptPath });
  if (!canRender) {
    console.log("# SKIP PowerPoint COM is not available on this machine.");
    return;
  }

  const provider = createMaterialProvider({ type: "pptx", filePath: pptPath });
  const material = await provider.load({ type: "pptx", filePath: pptPath, metadata: { workspaceRoot: rootDir } });
  const manifest = await renderer.renderDeck({
    type: "pptx",
    filePath: pptPath,
    metadata: { materialId: material.id, pageCount: material.pageCount }
  });

  assert.ok(material.pageCount > 0);
  assert.match(manifest.status, /ready|partial/);
  assert.equal(manifest.previews[0]?.status, "ready");
  assert.ok(manifest.previews[0]?.imagePath);
  await fs.access(manifest.previews[0].imagePath!);
});

test("page switching keeps preview, text, and agent context on the same page", async () => {
  const renderer = new PowerPointComSlideRenderer({ rootDir });
  const canRender = await renderer.canRender({ type: "pptx", filePath: pptPath });
  if (!canRender) {
    console.log("# SKIP PowerPoint COM is not available on this machine.");
    return;
  }

  const provider = createMaterialProvider({ type: "pptx", filePath: pptPath });
  const material = await provider.load({ type: "pptx", filePath: pptPath, metadata: { workspaceRoot: rootDir } });
  const manifest = await renderer.renderDeck({
    type: "pptx",
    filePath: pptPath,
    metadata: { materialId: material.id, pageCount: material.pageCount }
  });
  applySlidePreviewManifest(material, manifest, {
    imageUrlForPage: (pageIndex) => `/api/material/${encodeURIComponent(material.id)}/pages/${pageIndex}/preview`
  });

  const page1 = material.pages.find((page) => page.pageIndex === 1)!;
  const page2 = material.pages.find((page) => page.pageIndex === 2)!;
  assert.notEqual(page1.previewImageUrl, page2.previewImageUrl);
  assert.notEqual(page1.text, page2.text);

  const context = new LearningContextBuilder().build({ material, pageIndex: 2 });
  const response = await new LearningAssistantAgent().answer("这页主要讲什么？", context);
  assert.equal(response.citations.find((citation) => citation.sourceType === "current_page")?.pageIndex, 2);
  assert.equal(response.citations.find((citation) => citation.sourceType === "current_page")?.previewImageUrl, page2.previewImageUrl);
});

test("UI markup has a real slide preview image and keeps markdown in a debug panel", async () => {
  const html = await fs.readFile(path.join(rootDir, "examples", "learning-assistant-ui", "public", "index.html"), "utf8");
  const app = await fs.readFile(path.join(rootDir, "examples", "learning-assistant-ui", "public", "app.js"), "utf8");
  assert.match(html, /data-testid="slide-preview"/);
  assert.match(html, /id="slidePreview"/);
  assert.match(html, /<summary>页级 Markdown<\/summary>/);
  assert.match(app, /renderMarkdown\(response\.answer/);
  assert.match(app, /current_page: \$\{file\}Slide/);
});

test("evaluation report generator records material preview fields", async () => {
  const source = await fs.readFile(path.join(rootDir, "scripts", "run-kimi-evaluation.ts"), "utf8");
  assert.match(source, /Current PPT Page/);
  assert.match(source, /previewImagePath/);
  assert.match(source, /slide-previews/);
});
