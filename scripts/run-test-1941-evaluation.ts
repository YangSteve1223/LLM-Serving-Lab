import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  KimiLLMClient,
  LearningAssistantAgent,
  LearningContextBuilder,
  MarkdownKnowledgeBase,
  PowerPointComSlideRenderer,
  applySlidePreviewManifest,
  createMaterialProvider,
  type AnswerStylePreference,
  type LearningContext,
  type LearningMaterial
} from "../src/agents/learningAssistant/index.ts";

const rootDir = process.cwd();
const outDir = path.join(rootDir, "reports", "TEST-19：41");
const screenshotsDir = path.join(outDir, "screenshots");
const slidePreviewDir = path.join(outDir, "slide-previews");
const caseHtmlDir = path.join(outDir, "case-html");
const pptDir = process.env.TEST_PPT_DIR ? path.resolve(process.env.TEST_PPT_DIR) : path.join(rootDir, "测试集", "测试PPT");
const wikiPath = process.env.TEST_WIKI_PATH
  ? path.resolve(process.env.TEST_WIKI_PATH)
  : path.join(rootDir, "Education_LLM_Wiki_Operating_Package", "Education_LLM_Wiki_Operating_Package");
const apiKey = process.env.KIMI_API_KEY ?? process.env.MOONSHOT_API_KEY;

if (!apiKey?.trim()) {
  throw new Error("KIMI_API_KEY or MOONSHOT_API_KEY is required. The key is read from the process environment only.");
}

await fs.mkdir(screenshotsDir, { recursive: true });
await fs.mkdir(slidePreviewDir, { recursive: true });
await fs.mkdir(caseHtmlDir, { recursive: true });

const contextBuilder = new LearningContextBuilder();
const materialCache = new Map<string, LearningMaterial>();
const kb = await MarkdownKnowledgeBase.fromPaths({
  rootDir,
  paths: [path.relative(rootDir, wikiPath)]
});
const llm = new KimiLLMClient({
  apiKey,
  model: process.env.KIMI_MODEL ?? "kimi-k2.5",
  baseUrl: process.env.KIMI_BASE_URL ?? "https://api.moonshot.cn/v1",
  timeoutMs: 120_000,
  maxTokens: Number(process.env.KIMI_MAX_TOKENS ?? process.env.LLM_MAX_TOKENS ?? 900),
  temperature: Number(process.env.LLM_TEMPERATURE ?? 0.3)
});

const pptFiles = await listPptxFiles(pptDir);
if (pptFiles.length === 0) {
  throw new Error(`No PPTX files found under ${pptDir}`);
}

const cases = await buildCases(pptFiles);
const results: EvaluationResult[] = [];

for (const item of cases) {
  const material = await loadMaterial(item.materialPath);
  const context = buildContext(item, material);
  const agent = new LearningAssistantAgent({
    kb,
    llm,
    groundingMode: "allow_general_knowledge_with_label"
  });
  const started = Date.now();
  const response = await agent.answer(item.query, context);
  const materialSnapshot = await buildMaterialSnapshot(item, context, material);
  results.push({
    ...item,
    material: materialSnapshot,
    durationMs: Date.now() - started,
    response: sanitizeResponse(response)
  });
  console.log(`${item.id}: ${response.answerGenerationMode} / ${response.confidence} / ${materialSnapshot.fileName} / slide ${materialSnapshot.pageIndex}`);
}

const summary = buildSummary(results);
await fs.writeFile(path.join(outDir, "evaluation-results.json"), JSON.stringify({ summary, results }, null, 2), "utf8");
await fs.writeFile(path.join(outDir, "evaluation-log.md"), renderMarkdown(summary, results), "utf8");
await fs.writeFile(path.join(outDir, "summary.csv"), renderCsv(results), "utf8");
const htmlPath = path.join(outDir, "evaluation-report.html");
await fs.writeFile(htmlPath, renderHtml(summary, results), "utf8");
await captureScreenshots(htmlPath, results);
await fs.writeFile(path.join(outDir, "RUN-SUMMARY.txt"), renderRunSummary(summary), "utf8");

console.log(`TEST-19：41 artifacts written to ${outDir}`);

async function buildCases(files: string[]): Promise<EvaluationCase[]> {
  const cases: EvaluationCase[] = [];
  let deckIndex = 0;
  for (const file of files) {
    deckIndex += 1;
    const material = await loadMaterial(file);
    const pageIndexes = pickPages(material.pageCount);
    for (const pageIndex of pageIndexes) {
      const prefix = `d${String(deckIndex).padStart(2, "0")}-p${String(pageIndex).padStart(2, "0")}`;
      cases.push({
        id: `${prefix}-summary`,
        materialPath: file,
        deckName: path.basename(file),
        pageIndex,
        query: "这页主要讲什么？",
        learnerLevel: "intermediate",
        stylePreference: "auto"
      });
      cases.push({
        id: `${prefix}-keywords`,
        materialPath: file,
        deckName: path.basename(file),
        pageIndex,
        query: "这页有哪些关键词？用三到五个词概括。",
        learnerLevel: "beginner",
        stylePreference: "concise"
      });
    }
  }
  return cases;
}

function pickPages(pageCount: number): number[] {
  const candidates = [1, Math.max(1, Math.ceil(pageCount / 3)), Math.max(1, Math.ceil((pageCount * 2) / 3))];
  return [...new Set(candidates.map((page) => Math.min(Math.max(1, page), pageCount)))].slice(0, 3);
}

async function loadMaterial(filePath: string): Promise<LearningMaterial> {
  const resolved = path.resolve(filePath);
  const cached = materialCache.get(resolved);
  if (cached) return cached;

  const provider = createMaterialProvider({ type: "pptx", filePath: resolved });
  const material = await provider.load({ type: "pptx", filePath: resolved, metadata: { workspaceRoot: rootDir } });
  const previewRenderer = new PowerPointComSlideRenderer({ rootDir });
  const previewManifest = await previewRenderer.renderDeck({
    type: "pptx",
    filePath: resolved,
    metadata: { materialId: material.id, pageCount: material.pageCount }
  });
  applySlidePreviewManifest(material, previewManifest);
  materialCache.set(resolved, material);
  return material;
}

function buildContext(item: EvaluationCase, material: LearningMaterial): LearningContext {
  return contextBuilder.build({
    material,
    pageIndex: Math.min(Math.max(1, item.pageIndex), material.pageCount),
    stylePreference: item.stylePreference,
    learner: {
      id: `test-1941-${item.id}`,
      profile: {
        level: item.learnerLevel,
        language: "zh",
        stylePreference: item.stylePreference
      },
      progress: { currentPageIndex: item.pageIndex }
    },
    chatHistory: [
      { role: "user", content: "请用当前页能支持的信息回答，不要编造。" }
    ],
    platformMetadata: {
      source: "TEST-19:41",
      keySaved: false
    }
  });
}

async function buildMaterialSnapshot(item: EvaluationCase, context: LearningContext, material: LearningMaterial) {
  const page = context.currentPage;
  const preview = page?.preview;
  const copiedPreviewPath = preview?.imagePath ? await copyCasePreview(item.id, item.pageIndex, preview.imagePath) : undefined;
  return {
    id: material.id,
    fileName: material.filePath ? path.basename(material.filePath) : material.title,
    pageIndex: item.pageIndex,
    pageTitle: page?.semanticTitle ?? page?.title,
    textPreview: summarize(page?.text, 220),
    previewImagePath: copiedPreviewPath,
    previewImageUrl: copiedPreviewPath ? path.relative(outDir, copiedPreviewPath).replaceAll("\\", "/") : undefined,
    previewStatus: preview?.status ?? "unavailable",
    previewError: preview?.error
  };
}

async function copyCasePreview(caseId: string, pageIndex: number, imagePath: string): Promise<string | undefined> {
  try {
    const target = path.join(slidePreviewDir, `${caseId}-slide-${String(pageIndex).padStart(3, "0")}.png`);
    await fs.copyFile(imagePath, target);
    return target;
  } catch {
    return undefined;
  }
}

function sanitizeResponse(response: any) {
  return {
    answer: response.answer,
    answerGenerationMode: response.answerGenerationMode,
    confidence: response.confidence,
    teachingPolicy: response.teachingPolicy,
    usedContext: response.usedContext,
    usedSkills: response.usedSkills,
    citations: response.citations,
    decisionTrace: response.decisionTrace,
    generationDebug: {
      ...response.generationDebug,
      promptPreview: response.generationDebug?.promptPreview ? "[omitted in saved report]" : undefined
    },
    retrievalDebug: response.retrievalDebug
      ? {
          status: response.retrievalDebug.status,
          topScore: response.retrievalDebug.topScore,
          relevanceThreshold: response.retrievalDebug.relevanceThreshold,
          evidenceSufficient: response.retrievalDebug.evidenceSufficient
        }
      : undefined,
    evidenceDebug: {
      selected: response.evidenceDebug?.selected?.map((item: any) => ({
        sourceType: item.sourceType,
        title: item.title,
        sectionTitle: item.sectionTitle,
        chunkId: item.chunkId,
        relevanceScore: item.relevanceScore,
        textPreview: summarize(item.text, 180)
      })),
      rejected: response.evidenceDebug?.rejected?.slice(0, 6).map((item: any) => ({
        reason: item.reason,
        sourceType: item.evidence?.sourceType,
        title: item.evidence?.title,
        relevanceScore: item.evidence?.relevanceScore,
        textPreview: summarize(item.evidence?.text, 120)
      }))
    }
  };
}

function buildSummary(results: EvaluationResult[]) {
  const decks = [...new Set(results.map((item) => item.material.fileName ?? item.deckName))];
  const pages = [...new Set(results.map((item) => `${item.material.fileName}:${item.material.pageIndex}`))];
  return {
    createdAt: new Date().toISOString(),
    outputDir: outDir,
    provider: llm.providerName,
    model: llm.modelName,
    keySaved: false,
    deckCount: decks.length,
    uniquePageCount: pages.length,
    caseCount: results.length,
    realLlmCount: results.filter((item) => item.response.answerGenerationMode === "real_llm").length,
    lowConfidenceCount: results.filter((item) => item.response.confidence === "low").length,
    retrievalCalledCount: results.filter((item) => item.response.usedSkills?.[0]?.status === "called").length,
    decks
  };
}

function renderMarkdown(summary: any, results: EvaluationResult[]): string {
  return [
    "# TEST-19:41 Learning Assistant Evaluation",
    "",
    `- Created at: ${summary.createdAt}`,
    `- Provider: ${summary.provider}`,
    `- Model: ${summary.model}`,
    `- API key saved: ${summary.keySaved}`,
    `- Decks: ${summary.deckCount}`,
    `- Unique PPT pages: ${summary.uniquePageCount}`,
    `- Cases: ${summary.caseCount}`,
    `- real_llm: ${summary.realLlmCount}`,
    `- retrieval called: ${summary.retrievalCalledCount}`,
    "",
    "## Cases",
    "",
    ...results.flatMap((item) => [
      `### ${item.id}`,
      "",
      `- PPT: ${item.material.fileName}`,
      `- Page: ${item.material.pageIndex} / ${item.material.pageTitle ?? "untitled"}`,
      `- Question: ${item.query}`,
      `- Mode: ${item.response.answerGenerationMode}`,
      `- Confidence: ${item.response.confidence}`,
      `- Answerability: ${item.response.decisionTrace.answerability.status}`,
      `- Screenshot: screenshots/${item.id}.png`,
      "",
      "**Answer:**",
      "",
      item.response.answer,
      "",
      "**Citations:**",
      ...(item.response.citations.length
        ? item.response.citations.map((citation: any) => `- ${formatCitation(citation)}`)
        : ["- none"]),
      ""
    ])
  ].join("\n");
}

function renderCsv(results: EvaluationResult[]): string {
  const rows = [
    [
      "id",
      "deck",
      "pageIndex",
      "pageTitle",
      "question",
      "mode",
      "confidence",
      "answerability",
      "skillStatus",
      "durationMs",
      "screenshot"
    ],
    ...results.map((item) => [
      item.id,
      item.material.fileName ?? "",
      String(item.material.pageIndex),
      item.material.pageTitle ?? "",
      item.query,
      item.response.answerGenerationMode,
      item.response.confidence,
      item.response.decisionTrace.answerability.status,
      item.response.usedSkills?.[0]?.status ?? "none",
      String(item.durationMs),
      `screenshots/${item.id}.png`
    ])
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function renderHtml(summary: any, results: EvaluationResult[]): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TEST-19:41 Learning Assistant Evaluation</title>
  ${styleTag()}
</head>
<body>
<main>
  <header class="panel">
    <h1>TEST-19:41 Learning Assistant Evaluation</h1>
    <p>多 PPT、多页、trivial 问题真实 KIMI2.5 调用记录。API key 未写入任何输出文件。</p>
    <div class="grid">${Object.entries(summary)
      .filter(([key]) => key !== "decks" && key !== "outputDir")
      .map(([key, value]) => `<div class="kv"><strong>${escapeHtml(key)}</strong>${escapeHtml(String(value))}</div>`)
      .join("")}</div>
  </header>
  ${results.map((item) => renderCaseSection(item)).join("")}
</main>
</body>
</html>`;
}

function renderCaseSection(item: EvaluationResult, imagePrefix = ""): string {
  return `<section class="panel case" id="${escapeHtml(item.id)}">
    <h2>${escapeHtml(item.id)}</h2>
    <p class="muted">${escapeHtml(item.material.fileName ?? item.deckName)} / Slide ${item.material.pageIndex}《${escapeHtml(item.material.pageTitle ?? "untitled")}》</p>
    <p class="question">${escapeHtml(item.query)}</p>
    <div class="grid">
      <div class="kv"><strong>answer mode</strong>${escapeHtml(item.response.answerGenerationMode)}</div>
      <div class="kv"><strong>confidence</strong><span class="${escapeHtml(item.response.confidence)}">${escapeHtml(item.response.confidence)}</span></div>
      <div class="kv"><strong>answerability</strong>${escapeHtml(item.response.decisionTrace.answerability.status)}</div>
      <div class="kv"><strong>duration</strong>${item.durationMs} ms</div>
    </div>
    <h3>Current PPT Page</h3>
    ${renderSlidePreview(item, imagePrefix)}
    <h3>Answer</h3>
    <div class="answer">${renderMarkdownHtml(item.response.answer)}</div>
    <h3>Citations</h3>
    <ul>${renderCitations(item.response.citations)}</ul>
    <h3>Debug</h3>
    <div class="grid">
      <div class="kv"><strong>current page score</strong>${escapeHtml(String(item.response.decisionTrace.contextRelevance.currentPage.score))}</div>
      <div class="kv"><strong>selected evidence</strong>${escapeHtml(String(item.response.evidenceDebug.selected?.length ?? 0))}</div>
      <div class="kv"><strong>rejected evidence</strong>${escapeHtml(String(item.response.evidenceDebug.rejected?.length ?? 0))}</div>
      <div class="kv"><strong>retrieval</strong>${escapeHtml(item.response.retrievalDebug?.status ?? "not called")}</div>
    </div>
  </section>`;
}

async function captureScreenshots(htmlPath: string, results: EvaluationResult[]) {
  const browser = await findBrowser();
  if (!browser) {
    await fs.writeFile(path.join(screenshotsDir, "SCREENSHOT_SKIPPED.txt"), "Microsoft Edge or Chrome executable was not found.", "utf8");
    return;
  }

  await runBrowser(browser, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=1440,1800",
    `--screenshot=${path.join(screenshotsDir, "00-full-report.png")}`,
    `file:///${htmlPath.replaceAll("\\", "/")}`
  ]);

  const log = ["# Screenshot Log", "", "- Full report: screenshots/00-full-report.png", ""];
  for (const item of results) {
    const html = renderCaseHtml(item);
    const caseHtmlPath = path.join(caseHtmlDir, `${item.id}.html`);
    await fs.writeFile(caseHtmlPath, html, "utf8");
    const screenshotName = `${item.id}.png`;
    await runBrowser(browser, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--window-size=1440,1400",
      `--screenshot=${path.join(screenshotsDir, screenshotName)}`,
      `file:///${caseHtmlPath.replaceAll("\\", "/")}`
    ]);
    log.push(`- ${item.id}: screenshots/${screenshotName}`);
  }
  await fs.writeFile(path.join(outDir, "screenshot-log.md"), log.join("\n"), "utf8");
}

function renderCaseHtml(item: EvaluationResult): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(item.id)}</title>
  ${styleTag()}
</head>
<body><main>${renderCaseSection(item, "../")}</main></body>
</html>`;
}

function styleTag(): string {
  return `<style>
    :root { --bg:#eef3f6; --paper:#fff; --ink:#172033; --muted:#5a6678; --line:#d8e0e7; --blue:#245b82; --green:#267455; --red:#a83d35; --gold:#9a691e; }
    body { margin:0; background:var(--bg); color:var(--ink); font-family:"Microsoft YaHei","Segoe UI",sans-serif; }
    main { max-width:1320px; margin:0 auto; padding:28px; }
    .panel { background:var(--paper); border:1px solid var(--line); border-radius:10px; padding:24px; margin-bottom:18px; }
    h1 { margin:0 0 8px; font-size:30px; } h2 { margin:0 0 8px; } h3 { margin:22px 0 10px; }
    .muted { color:var(--muted); } .question { color:var(--blue); font-weight:700; font-size:18px; }
    .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin:14px 0; }
    .kv { border:1px solid var(--line); border-radius:8px; background:#f8fafc; padding:10px; overflow-wrap:anywhere; }
    .kv strong { display:block; color:var(--muted); font-size:12px; margin-bottom:4px; }
    .slide { margin:12px 0; border:1px solid var(--line); border-radius:8px; background:#f8fafc; padding:12px; }
    .slide img { display:block; max-width:100%; max-height:460px; margin:0 auto; background:white; }
    .slide .fallback { color:var(--red); }
    .answer { line-height:1.7; background:#f8fafc; border:1px solid var(--line); border-radius:8px; padding:14px; }
    .answer p { margin:0 0 10px; } .answer ul, .answer ol { margin:0 0 12px 24px; padding:0; }
    .answer table { width:100%; border-collapse:collapse; margin:10px 0 12px; background:white; }
    .answer th, .answer td { border:1px solid var(--line); padding:8px 10px; text-align:left; vertical-align:top; }
    .answer th { background:#edf5fb; }
    ul { line-height:1.6; } .low { color:var(--red); } .medium { color:var(--gold); } .high { color:var(--green); }
  </style>`;
}

function renderSlidePreview(item: EvaluationResult, imagePrefix = ""): string {
  const caption = `${item.material.fileName ?? item.deckName} / Slide ${item.material.pageIndex}《${item.material.pageTitle ?? "untitled"}》`;
  if (item.material.previewImageUrl) {
    return `<div class="slide"><p>${escapeHtml(caption)}</p><img src="${escapeHtml(imagePrefix + item.material.previewImageUrl)}" alt="${escapeHtml(caption)}" /></div>`;
  }
  return `<div class="slide"><p>${escapeHtml(caption)}</p><p class="fallback">preview ${escapeHtml(item.material.previewStatus ?? "unavailable")}: ${escapeHtml(item.material.previewError ?? "no slide image available")}</p></div>`;
}

function renderCitations(citations: any[]): string {
  if (!citations.length) return "<li>none</li>";
  return citations.map((citation) => `<li>${escapeHtml(formatCitation(citation))}</li>`).join("");
}

function formatCitation(citation: any): string {
  if (citation.sourceType === "current_page" && citation.pageIndex) {
    const title = citation.semanticTitle ?? citation.title ?? citation.sourceId ?? "untitled";
    const file = citation.fileName ? `${citation.fileName} / ` : "";
    return `current_page: ${file}Slide ${citation.pageIndex}《${title}》`;
  }
  if (citation.sourceType === "outline" || citation.sourceType === "neighbor_page") {
    return `deck_context: ${citation.title ?? citation.sourceId ?? "untitled"}`;
  }
  return `${citation.sourceType}: ${citation.title ?? citation.sourceId ?? citation.sectionTitle ?? "untitled"}`;
}

function renderMarkdownHtml(markdown: string | undefined): string {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let listType: "ul" | "ol" | undefined;
  let tableRows: string[][] = [];

  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = undefined;
  };
  const flushTable = () => {
    if (tableRows.length === 0) return;
    closeList();
    html.push("<table>");
    tableRows.forEach((cells, index) => {
      const tag = index === 0 ? "th" : "td";
      html.push(`<tr>${cells.map((cell) => `<${tag}>${inlineMarkdownHtml(cell)}</${tag}>`).join("")}</tr>`);
    });
    html.push("</table>");
    tableRows = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushTable();
      closeList();
      continue;
    }
    if (/^---+$/.test(line)) {
      flushTable();
      closeList();
      html.push("<hr />");
      continue;
    }
    if (/^\|.+\|$/.test(line)) {
      const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
      if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) tableRows.push(cells);
      continue;
    }
    flushTable();
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length + 2;
      html.push(`<h${level}>${inlineMarkdownHtml(heading[2])}</h${level}>`);
      continue;
    }
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${inlineMarkdownHtml(ordered[1])}</li>`);
      continue;
    }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${inlineMarkdownHtml(unordered[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${inlineMarkdownHtml(line)}</p>`);
  }

  flushTable();
  closeList();
  return html.join("\n");
}

function inlineMarkdownHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

async function listPptxFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pptx"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

async function findBrowser(): Promise<string | undefined> {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

function runBrowser(browserPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(browserPath, args, { stdio: "ignore", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Browser screenshot failed with exit ${code}`));
    });
  });
}

function summarize(text: string | undefined, maxLength: number): string {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderRunSummary(summary: any): string {
  return [
    "TEST-19:41 completed",
    `Created at: ${summary.createdAt}`,
    `Output dir: ${summary.outputDir}`,
    `Provider: ${summary.provider}`,
    `Model: ${summary.model}`,
    `API key saved: ${summary.keySaved}`,
    `Decks: ${summary.deckCount}`,
    `Unique pages: ${summary.uniquePageCount}`,
    `Cases: ${summary.caseCount}`,
    `Real LLM answers: ${summary.realLlmCount}`,
    `Retrieval called: ${summary.retrievalCalledCount}`,
    "",
    "Primary files:",
    "- evaluation-report.html",
    "- evaluation-results.json",
    "- evaluation-log.md",
    "- summary.csv",
    "- screenshots/",
    "- slide-previews/"
  ].join("\n");
}

type EvaluationCase = {
  id: string;
  materialPath: string;
  deckName: string;
  pageIndex: number;
  query: string;
  learnerLevel: "beginner" | "intermediate" | "advanced" | "unknown";
  stylePreference: AnswerStylePreference;
};

type EvaluationResult = EvaluationCase & {
  material: {
    id: string;
    fileName?: string;
    pageIndex: number;
    pageTitle?: string;
    textPreview?: string;
    previewImagePath?: string;
    previewImageUrl?: string;
    previewStatus?: string;
    previewError?: string;
  };
  durationMs: number;
  response: any;
};
