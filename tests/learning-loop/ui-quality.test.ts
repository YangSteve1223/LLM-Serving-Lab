import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MicroQuizGenerator } from "../../src/agents/learningAssistant/index.ts";
import { aiThreeElementsContext, qualityQuizLlm } from "./fixtures.ts";

const rootDir = process.cwd();

test("demo quick prompts exclude pressure-test questions and developer block keeps them", async () => {
  const app = await fs.readFile(path.join(rootDir, "examples", "learning-assistant-ui", "public", "app.js"), "utf8");
  const html = await fs.readFile(path.join(rootDir, "examples", "learning-assistant-ui", "public", "index.html"), "utf8");
  const server = await fs.readFile(path.join(rootDir, "examples", "learning-assistant-ui", "server.ts"), "utf8");
  assert.match(html, /data-testid="chat-window"/);
  assert.match(html, /data-testid="quick-prompts-toggle"/);
  assert.match(html, /data-testid="quick-prompts-popover" hidden/);
  assert.match(html, /data-testid="developer-stress-questions"/);
  assert.doesNotMatch(html, /AlphaBetaZeta-927|RAG 和普通 LLM 问答有什么区别|火星基地供氧预算表/);
  assert.match(app, /const demoPrompts = \[/);
  const demoBlock = app.slice(app.indexOf("const demoPrompts = ["), app.indexOf("const developerStressQuestions = ["));
  assert.doesNotMatch(demoBlock, /AlphaBetaZeta-927/);
  assert.doesNotMatch(demoBlock, /RAG 和普通 LLM 问答有什么区别/);
  assert.doesNotMatch(demoBlock, /火星基地供氧预算表/);
  const serverQuestionBlock = server.slice(server.indexOf("const exampleQuestions = ["), server.indexOf("];", server.indexOf("const exampleQuestions = [")));
  assert.doesNotMatch(serverQuestionBlock, /AlphaBetaZeta-927|RAG 和普通 LLM 问答有什么区别|火星基地供氧预算表/);
  assert.match(app, /developerStressQuestions/);
  assert.match(app, /AlphaBetaZeta-927/);
  assert.match(app, /state\.uiMode === "developer"/);
});

test("assistant chat layout has a visible scroll region before learning-loop tools", async () => {
  const css = await fs.readFile(path.join(rootDir, "examples", "learning-assistant-ui", "public", "styles.css"), "utf8");
  const html = await fs.readFile(path.join(rootDir, "examples", "learning-assistant-ui", "public", "index.html"), "utf8");
  assert.match(css, /\.assistant-panel\s*\{[\s\S]*display:\s*flex;[\s\S]*overflow:\s*hidden;/);
  assert.match(css, /\.chat-window\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*min-height:\s*360px;[\s\S]*overflow-y:\s*auto;/);
  assert.match(css, /\.ask-box\s*\{[\s\S]*position:\s*relative;[\s\S]*flex:\s*0 0 auto;/);
  assert.match(css, /\.quick-prompts-popover\s*\{[\s\S]*position:\s*absolute;[\s\S]*bottom:\s*calc\(100% \+ 8px\);/);
  assert.ok(html.indexOf('id="chatWindow"') < html.indexOf('id="askForm"'));
  assert.ok(html.indexOf('id="askForm"') < html.indexOf('class="assistant-tool-strip"'));
  assert.equal(html.includes('class="learning-loop-panel"'), false);
  assert.equal(html.includes("quick-prompts-wrap"), false);
  assert.equal(html.includes("建议提问"), false);
  assert.doesNotMatch(css, /test-prompts|#fff8ed|efd8b8|81500f/);
});

test("settings and page text open as fixed drawers outside the main layout", async () => {
  const css = await fs.readFile(path.join(rootDir, "examples", "learning-assistant-ui", "public", "styles.css"), "utf8");
  const html = await fs.readFile(path.join(rootDir, "examples", "learning-assistant-ui", "public", "index.html"), "utf8");
  const app = await fs.readFile(path.join(rootDir, "examples", "learning-assistant-ui", "public", "app.js"), "utf8");

  assert.match(html, /id="settingsOverlay"/);
  assert.match(html, /id="modelSettingsPanel" class="settings-drawer" data-testid="model-settings-drawer" hidden/);
  assert.match(html, /id="pageTextDrawer" class="page-text-drawer" data-testid="page-text-drawer" hidden/);
  assert.match(html, /id="openPageTextDrawer"/);
  assert.match(css, /\.settings-drawer,[\s\S]*\.page-text-drawer\s*\{[\s\S]*position:\s*fixed;[\s\S]*height:\s*100dvh;[\s\S]*overflow-y:\s*auto;/);
  assert.match(css, /\.settings-overlay\s*\{[\s\S]*position:\s*fixed;[\s\S]*inset:\s*0;/);
  assert.match(css, /\.app-shell\s*\{[\s\S]*min-height:\s*100dvh;[\s\S]*overflow:\s*visible;/);
  assert.match(css, /body\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.match(app, /function openModelSettings\(\)/);
  assert.match(app, /function openPageTextDrawer\(\)/);
  assert.doesNotMatch(html, /class="fold-panel"/);
});

test("learning loop tools render in an independent drawer instead of assistant footer", async () => {
  const css = await fs.readFile(path.join(rootDir, "examples", "learning-assistant-ui", "public", "styles.css"), "utf8");
  const html = await fs.readFile(path.join(rootDir, "examples", "learning-assistant-ui", "public", "index.html"), "utf8");
  const app = await fs.readFile(path.join(rootDir, "examples", "learning-assistant-ui", "public", "app.js"), "utf8");

  assert.match(html, /id="learningToolsToggle"[^>]*data-testid="learning-tools-toggle"/);
  assert.match(html, /id="learningToolsOverlay" class="learning-tools-overlay" hidden/);
  assert.match(html, /id="learningToolsDrawer" class="learning-tools-drawer" data-testid="learning-tools-drawer" hidden/);
  assert.match(html, /id="learningLoopOutput" class="learning-loop-output" data-testid="learning-loop-output"/);
  assert.ok(html.indexOf('id="learningToolsDrawer"') > html.indexOf('class="assistant-panel"'));
  assert.doesNotMatch(html, /class="learning-loop-panel"/);
  assert.match(css, /\.learning-tools-drawer\s*\{[\s\S]*position:\s*fixed;[\s\S]*height:\s*100dvh;[\s\S]*display:\s*flex;[\s\S]*overflow:\s*hidden;/);
  assert.match(css, /\[hidden\]\s*\{[\s\S]*display:\s*none\s*!important;/);
  assert.match(css, /\.learning-loop-output\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*min-height:\s*0;[\s\S]*overflow-y:\s*auto;/);
  assert.match(css, /@media \(max-width:\s*760px\)\s*\{[\s\S]*\.learning-tools-drawer\s*\{[\s\S]*bottom:\s*0;[\s\S]*height:\s*min\(78dvh,\s*720px\);/);
  assert.match(app, /function openLearningToolsDrawer\(/);
  assert.match(app, /function closeLearningToolsDrawer\(/);
  assert.match(app, /function setLearningToolsTab\(/);
  assert.match(app, /\/api\/learning-loop\/generate-quiz/);
  assert.match(app, /\/api\/learning-loop\/memory\/demo-learner/);
  assert.match(app, /\/api\/resources\/tasks/);
  assert.match(app, /\/api\/teacher\/insights/);
});

test("courseware stage contains the full slide without internal cropping rules", async () => {
  const css = await fs.readFile(path.join(rootDir, "examples", "learning-assistant-ui", "public", "styles.css"), "utf8");
  const html = await fs.readFile(path.join(rootDir, "examples", "learning-assistant-ui", "public", "index.html"), "utf8");
  assert.match(html, /data-testid="slide-stage"/);
  assert.match(css, /\.courseware-panel\s*\{[\s\S]*overflow:\s*hidden;/);
  assert.match(css, /\.slide-stage\s*\{[\s\S]*display:\s*flex;[\s\S]*overflow:\s*hidden;/);
  assert.match(css, /\.slide-stage img\s*\{[\s\S]*height:\s*100%;[\s\S]*object-fit:\s*contain;[\s\S]*object-position:\s*center center;/);
});

test("three-element quiz expected answers are concept-specific", async () => {
  const quiz = await new MicroQuizGenerator({ llm: qualityQuizLlm() }).generate({ learningContext: aiThreeElementsContext(), count: 3 });
  const byConcept = new Map(quiz.questions.map((question) => [question.concept, question.expectedAnswer]));
  assert.match(byConcept.get("数据") ?? "", /知识来源|学习对象/);
  assert.match(byConcept.get("算法") ?? "", /智能内核|如何.*学习|有效利用/);
  assert.match(byConcept.get("算力") ?? "", /基础设施|训练和推理|做得动/);
});
