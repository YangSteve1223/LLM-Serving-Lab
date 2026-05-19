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
const outDir = path.join(rootDir, "reports", "kimi-evaluation", "latest");
const screenshotsDir = path.join(outDir, "screenshots");
const wikiPath = process.env.TEST_WIKI_PATH
  ? path.resolve(process.env.TEST_WIKI_PATH)
  : path.join(rootDir, "Education_LLM_Wiki_Operating_Package", "Education_LLM_Wiki_Operating_Package");
const defaultPptPath = path.join(rootDir, "测试集", "测试PPT", "test1.pptx");
const configuredPptDir = process.env.TEST_PPT_DIR
  ? path.resolve(process.env.TEST_PPT_DIR)
  : path.join(rootDir, "测试集", "测试PPT");
const fallbackMarkdownPath = path.join(rootDir, "examples", "learning-assistant-demo", "sample-material.md");
const sampleMaterialPath = process.env.EVAL_MATERIAL_PATH
  ? path.resolve(process.env.EVAL_MATERIAL_PATH)
  : (await exists(defaultPptPath)) ? defaultPptPath : fallbackMarkdownPath;
const apiKey = process.env.KIMI_API_KEY ?? process.env.MOONSHOT_API_KEY;

if (!apiKey?.trim()) {
  throw new Error("KIMI_API_KEY or MOONSHOT_API_KEY is required for this evaluation run.");
}

await fs.mkdir(screenshotsDir, { recursive: true });

const slidePreviewDir = path.join(outDir, "slide-previews");
await fs.mkdir(slidePreviewDir, { recursive: true });
const materialCache = new Map<string, LearningMaterial>();
const contextBuilder = new LearningContextBuilder();
const kb = await MarkdownKnowledgeBase.fromPaths({
  rootDir,
  paths: [path.relative(rootDir, wikiPath)]
});
const llm = new KimiLLMClient({
  apiKey,
  model: process.env.KIMI_MODEL ?? "kimi-k2.5",
  baseUrl: process.env.KIMI_BASE_URL ?? "https://api.moonshot.cn/v1",
  timeoutMs: 90_000,
  maxTokens: Number(process.env.KIMI_MAX_TOKENS ?? process.env.LLM_MAX_TOKENS ?? 2048),
  temperature: Number(process.env.LLM_TEMPERATURE ?? 1)
});

const cases: EvaluationCase[] = [
  {
    id: "01-current-page-summary",
    title: "当前页理解",
    query: "这页主要讲什么？",
    pageIndex: 1,
    learnerLevel: "beginner",
    stylePreference: "auto"
  },
  {
    id: "02-current-page-concept",
    title: "当前页概念解释",
    query: "数据、算法、算力分别起什么作用？",
    pageIndex: 1,
    learnerLevel: "intermediate",
    stylePreference: "step_by_step"
  },
  {
    id: "03-wiki-workflow",
    title: "知识库流程检索",
    query: "这个知识库里的运行流程是什么？请说明 Source Loop、Query Loop、Maintenance Loop。",
    pageIndex: 2,
    learnerLevel: "intermediate",
    stylePreference: "auto"
  },
  {
    id: "04-explicit-kb",
    title: "明确要求查知识库",
    query: "除了当前 PPT，这个概念在知识库里有没有更完整的解释？",
    pageIndex: 1,
    learnerLevel: "intermediate",
    stylePreference: "auto"
  },
  {
    id: "05-rag-general",
    title: "通用知识标注",
    query: "RAG 和普通 LLM 问答有什么区别？",
    pageIndex: 2,
    learnerLevel: "advanced",
    stylePreference: "deep_dive"
  },
  {
    id: "06-no-hallucination",
    title: "无依据拒答压力题",
    query: "请给出 AlphaBetaZeta-927 的具体公式、数值推导和预算表。",
    pageIndex: 2,
    learnerLevel: "advanced",
    stylePreference: "auto"
  },
  {
    id: "07-beginner-analogy",
    title: "初学者类比风格",
    query: "如果我是初学者，怎么直观理解人工智能三要素之间的关系？",
    pageIndex: 1,
    learnerLevel: "beginner",
    stylePreference: "analogy"
  },
  {
    id: "08-socratic",
    title: "苏格拉底式引导",
    query: "不要直接给结论，你引导我判断这页三个要素之间的关系。",
    pageIndex: 1,
    learnerLevel: "intermediate",
    stylePreference: "socratic"
  },
  {
    id: "09-english",
    title: "英文问题",
    query: "What is this page trying to teach about data, algorithms, and computing power?",
    pageIndex: 1,
    learnerLevel: "advanced",
    stylePreference: "auto"
  },
  {
    id: "10-unrelated",
    title: "无关问题边界",
    query: "如果当前页是人工智能三要素，请问火星基地供氧预算表怎么推导？",
    pageIndex: 1,
    learnerLevel: "intermediate",
    stylePreference: "auto"
  },
  ...(await buildCrossPptCases())
];

const results: EvaluationResult[] = [];

for (const item of cases) {
  const caseMaterial = await loadEvaluationMaterial(item.materialPath ?? sampleMaterialPath);
  const context = buildContext(item, caseMaterial);
  const agent = new LearningAssistantAgent({
    kb,
    llm,
    groundingMode: "allow_general_knowledge_with_label"
  });
  const started = Date.now();
  const response = await agent.answer(item.query, context);
  const materialSnapshot = await buildMaterialSnapshot(item, context, caseMaterial);
  results.push({
    ...item,
    material: materialSnapshot,
    durationMs: Date.now() - started,
    response: sanitizeResponse(response)
  });
  console.log(`${item.id}: ${response.answerGenerationMode} / ${response.confidence} / ${response.decisionTrace.answerability.status}`);
}

const summary = buildSummary(results);
await fs.writeFile(path.join(outDir, "evaluation-results.json"), JSON.stringify({ summary, results }, null, 2), "utf8");
await fs.writeFile(path.join(outDir, "evaluation-log.md"), renderMarkdown(summary, results), "utf8");
const htmlPath = path.join(outDir, "evaluation-report.html");
await fs.writeFile(htmlPath, renderHtml(summary, results), "utf8");
await captureScreenshots(htmlPath, results);

console.log(`KIMI evaluation artifacts written to ${outDir}`);

async function loadEvaluationMaterial(filePath: string): Promise<LearningMaterial> {
  const resolved = path.resolve(filePath);
  const cached = materialCache.get(resolved);
  if (cached) return cached;

  const materialType = resolved.toLowerCase().endsWith(".pptx") ? "pptx" : "markdown";
  const materialProvider = createMaterialProvider({ type: materialType, filePath: resolved });
  const material = await materialProvider.load({ type: materialType, filePath: resolved, metadata: { workspaceRoot: rootDir } });
  if (material.type === "pptx" && material.filePath) {
    const previewRenderer = new PowerPointComSlideRenderer({ rootDir });
    const previewManifest = await previewRenderer.renderDeck({
      type: "pptx",
      filePath: material.filePath,
      metadata: { materialId: material.id, pageCount: material.pageCount }
    });
    applySlidePreviewManifest(material, previewManifest);
  }
  materialCache.set(resolved, material);
  return material;
}

async function buildCrossPptCases(): Promise<EvaluationCase[]> {
  const files = await listPptxFiles(configuredPptDir);
  if (files.length === 0) return [];

  const pick = (pattern: RegExp, fallbackIndex: number) => files.find((file) => pattern.test(path.basename(file))) ?? files[fallbackIndex % files.length];
  const selected = [
    {
      id: "11-cross-ai-basic",
      title: "跨 PPT 泛化：AI 基础页",
      materialPath: pick(/test1/i, 0),
      pageIndex: 1
    },
    {
      id: "12-cross-rag-technical",
      title: "跨 PPT 泛化：技术方法页",
      materialPath: pick(/test2/i, 1),
      pageIndex: 3
    },
    {
      id: "13-cross-non-ai-course",
      title: "跨 PPT 泛化：非助教主题课程页",
      materialPath: pick(/赵|最终/i, 2),
      pageIndex: 4
    }
  ];

  return selected.map((item) => ({
    ...item,
    query: "这页主要讲什么？",
    learnerLevel: "intermediate" as const,
    stylePreference: "auto" as const
  }));
}

async function listPptxFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pptx"))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function buildContext(item: EvaluationCase, material: LearningMaterial): LearningContext {
  return contextBuilder.build({
    material,
    pageIndex: Math.min(Math.max(1, item.pageIndex), material.pageCount),
    stylePreference: item.stylePreference,
    learner: {
      id: `eval-${item.id}`,
      profile: {
        level: item.learnerLevel,
        language: item.id === "09-english" ? "en" : "zh",
        stylePreference: item.stylePreference
      },
      progress: { currentPageIndex: item.pageIndex }
    },
    chatHistory: [
      {
        role: "user",
        content: "我希望回答尽量有依据，不要编造。"
      }
    ],
    platformMetadata: {
      source: "kimi-evaluation",
      keyPolicy: "api key supplied only through process environment"
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
          evidenceSufficient: response.retrievalDebug.evidenceSufficient,
          chunks: response.retrievalDebug.chunks?.map((chunk: any) => ({
            chunkId: chunk.chunkId,
            score: chunk.score,
            title: chunk.title,
            sectionTitle: chunk.sectionTitle,
            textPreview: summarize(chunk.text, 180)
          })),
          rejectedChunks: response.retrievalDebug.rejectedChunks?.slice(0, 5).map((item: any) => ({
            reason: item.reason,
            score: item.chunk?.score,
            title: item.chunk?.title,
            sectionTitle: item.chunk?.sectionTitle,
            textPreview: summarize(item.chunk?.text, 140)
          }))
        }
      : undefined,
    evidenceDebug: {
      selected: response.evidenceDebug?.selected?.map((item: any) => ({
        sourceType: item.sourceType,
        title: item.title,
        sectionTitle: item.sectionTitle,
        chunkId: item.chunkId,
        relevanceScore: item.relevanceScore,
        textPreview: summarize(item.text, 220)
      })),
      rejected: response.evidenceDebug?.rejected?.slice(0, 8).map((item: any) => ({
        reason: item.reason,
        sourceType: item.evidence?.sourceType,
        title: item.evidence?.title,
        relevanceScore: item.evidence?.relevanceScore,
        textPreview: summarize(item.evidence?.text, 160)
      }))
    }
  };
}

function buildSummary(results: EvaluationResult[]) {
  return {
    createdAt: new Date().toISOString(),
    model: llm.modelName,
    provider: llm.providerName,
    caseCount: results.length,
    realLlmCount: results.filter((item) => item.response.answerGenerationMode === "real_llm").length,
    templateFallbackCount: results.filter((item) => item.response.answerGenerationMode === "template_fallback").length,
    lowConfidenceCount: results.filter((item) => item.response.confidence === "low").length,
    retrievalCalledCount: results.filter((item) => item.response.usedSkills?.[0]?.status === "called").length,
    refusalCount: results.filter((item) => item.response.decisionTrace?.answerability?.shouldRefuseToInvent).length,
    keySaved: false
  };
}

function renderMarkdown(summary: any, results: EvaluationResult[]): string {
  return [
    "# KIMI Evaluation Log",
    "",
    `- Created at: ${summary.createdAt}`,
    `- Provider: ${summary.provider}`,
    `- Model: ${summary.model}`,
    `- Cases: ${summary.caseCount}`,
    `- real_llm: ${summary.realLlmCount}`,
    `- template_fallback: ${summary.templateFallbackCount}`,
    `- retrieval called: ${summary.retrievalCalledCount}`,
    `- refusals: ${summary.refusalCount}`,
    `- API key saved: ${summary.keySaved}`,
    "",
    "## Cases",
    "",
    ...results.flatMap((item) => [
      `### ${item.id} ${item.title}`,
      "",
      `**Question:** ${item.query}`,
      "",
      `**Mode:** ${item.response.answerGenerationMode}`,
      `**Confidence:** ${item.response.confidence}`,
      `**Answerability:** ${item.response.decisionTrace.answerability.status}`,
      `**Skill:** ${item.response.usedSkills?.[0]?.status ?? "none"}`,
      `**Material:** ${item.material.fileName ?? item.material.id} / page ${item.material.pageIndex} / ${item.material.pageTitle ?? "untitled"}`,
      `**Preview:** ${item.material.previewImageUrl ?? item.material.previewStatus ?? "unavailable"}`,
      "",
      "**Answer:**",
      "",
      item.response.answer,
      "",
      "**Citations:**",
      "",
      ...(item.response.citations.length
        ? item.response.citations.map((citation: any) => `- ${citation.sourceType}: ${citation.title ?? citation.sourceId ?? "untitled"}`)
        : ["- none"]),
      ""
    ])
  ].join("\n");
}

function renderHtml(summary: any, results: EvaluationResult[]): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>KIMI Evaluation Report</title>
  <style>
    :root { --ink:#172033; --muted:#5a6678; --line:#d9e1e8; --paper:#ffffff; --bg:#eef3f6; --blue:#245b82; --green:#267455; --red:#a83d35; --gold:#9a691e; }
    body { margin:0; background:var(--bg); color:var(--ink); font-family:"Microsoft YaHei", "Segoe UI", sans-serif; }
    main { max-width:1280px; margin:0 auto; padding:28px; }
    header, section.case, .summary { background:var(--paper); border:1px solid var(--line); border-radius:10px; padding:22px; margin-bottom:18px; }
    h1 { margin:0 0 8px; font-size:28px; } h2 { margin:0 0 12px; } h3 { margin:0 0 8px; }
    .meta, .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
    .pill, .kv { border:1px solid var(--line); border-radius:8px; background:#f8fafc; padding:10px; }
    .pill strong, .kv strong { display:block; color:var(--muted); font-size:12px; margin-bottom:4px; }
    .answer { white-space:pre-wrap; line-height:1.7; background:#f8fafc; border:1px solid var(--line); border-radius:8px; padding:14px; }
    .slide { margin:12px 0; border:1px solid var(--line); border-radius:8px; background:#f8fafc; padding:12px; }
    .slide img { display:block; max-width:100%; max-height:520px; margin:0 auto; background:white; }
    .slide .fallback { color:var(--red); }
    .question { color:var(--blue); font-weight:700; }
    .low { color:var(--red); } .medium { color:var(--gold); } .high { color:var(--green); }
    ul { line-height:1.6; } code { color:var(--gold); word-break:break-all; }
    .case { page-break-inside:avoid; }
  </style>
</head>
<body>
<main>
  <header>
    <h1>KIMI Evaluation Report</h1>
    <p>真实模型问答、证据门控、知识库检索和拒绝编造测试记录。API key 未写入报告。</p>
  </header>
  <section class="summary">
    <h2>Summary</h2>
    <div class="meta">
      ${Object.entries(summary)
        .map(([key, value]) => `<div class="pill"><strong>${escapeHtml(key)}</strong>${escapeHtml(String(value))}</div>`)
        .join("")}
    </div>
  </section>
  ${results
    .map(
      (item) => `<section class="case" id="${item.id}">
        <h2>${escapeHtml(item.id)} ${escapeHtml(item.title)}</h2>
        <p class="question">${escapeHtml(item.query)}</p>
        <div class="grid">
          <div class="kv"><strong>mode</strong>${escapeHtml(item.response.answerGenerationMode)}</div>
          <div class="kv"><strong>confidence</strong><span class="${item.response.confidence}">${escapeHtml(item.response.confidence)}</span></div>
          <div class="kv"><strong>answerability</strong>${escapeHtml(item.response.decisionTrace.answerability.status)}</div>
          <div class="kv"><strong>skill</strong>${escapeHtml(item.response.usedSkills?.[0]?.status ?? "none")}</div>
        </div>
        <h3>Current PPT Page</h3>
        ${renderMaterialPreviewHtml(item)}
        <h3>Answer</h3>
        <div class="answer">${renderMarkdownHtml(item.response.answer)}</div>
        <h3>Citations</h3>
        <ul>${(item.response.citations.length ? item.response.citations : [{ sourceType: "none", title: "none" }])
          .map((citation: any) => `<li>${escapeHtml(formatCitation(citation))}</li>`)
          .join("")}</ul>
        <h3>Debug</h3>
        <div class="grid">
          <div class="kv"><strong>selected evidence</strong>${item.response.evidenceDebug.selected.length}</div>
          <div class="kv"><strong>rejected evidence</strong>${item.response.evidenceDebug.rejected.length}</div>
          <div class="kv"><strong>retrieval</strong>${escapeHtml(item.response.retrievalDebug?.status ?? "not called")}</div>
          <div class="kv"><strong>duration</strong>${item.durationMs} ms</div>
        </div>
      </section>`
    )
    .join("")}
</main>
</body>
</html>`;
}

function renderMaterialPreviewHtml(item: EvaluationResult, imagePrefix = ""): string {
  const caption = `${item.material.fileName ?? item.material.id} / page ${item.material.pageIndex} / ${item.material.pageTitle ?? "untitled"}`;
  if (item.material.previewImageUrl) {
    return `<div class="slide"><p>${escapeHtml(caption)}</p><img src="${escapeHtml(imagePrefix + item.material.previewImageUrl)}" alt="Slide ${item.material.pageIndex} preview" /></div>`;
  }
  return `<div class="slide"><p>${escapeHtml(caption)}</p><p class="fallback">preview ${escapeHtml(item.material.previewStatus ?? "unavailable")}: ${escapeHtml(item.material.previewError ?? "no slide image available")}</p></div>`;
}

async function captureScreenshots(htmlPath: string, results: EvaluationResult[]) {
  const edge = await findEdge();
  if (!edge) {
    await fs.writeFile(path.join(screenshotsDir, "SCREENSHOT_SKIPPED.txt"), "Microsoft Edge executable was not found.", "utf8");
    return;
  }

  const fileUrl = `file:///${htmlPath.replaceAll("\\", "/")}`;
  await runEdge(edge, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=1440,1800",
    `--screenshot=${path.join(screenshotsDir, "00-full-report.png")}`,
    fileUrl
  ]);

  const captureLog = ["# Screenshot Log", "", `- Full report: screenshots/00-full-report.png`, ""];
  for (const item of results) {
    const screenshotName = `${item.id}.png`;
    const caseHtmlName = `${item.id}.html`;
    const caseHtmlPath = path.join(screenshotsDir, caseHtmlName);
    await fs.writeFile(caseHtmlPath, renderCaseScreenshotHtml(item), "utf8");
    const caseFileUrl = `file:///${caseHtmlPath.replaceAll("\\", "/")}`;
    await runEdge(edge, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--window-size=1440,1400",
      `--screenshot=${path.join(screenshotsDir, screenshotName)}`,
      caseFileUrl
    ]);
    captureLog.push(`- ${item.id}: screenshots/${screenshotName}`);
  }
  await fs.writeFile(path.join(outDir, "screenshot-log.md"), captureLog.join("\n"), "utf8");
}

function renderCaseScreenshotHtml(item: EvaluationResult): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(item.id)}</title>
  <style>
    :root { --ink:#172033; --muted:#5a6678; --line:#d9e1e8; --paper:#ffffff; --bg:#eef3f6; --blue:#245b82; --green:#267455; --red:#a83d35; --gold:#9a691e; }
    body { margin:0; background:var(--bg); color:var(--ink); font-family:"Microsoft YaHei", "Segoe UI", sans-serif; }
    main { max-width:1280px; margin:0 auto; padding:28px; }
    section.case { background:var(--paper); border:1px solid var(--line); border-radius:10px; padding:22px; }
    h1 { margin:0 0 8px; font-size:28px; } h2 { margin:18px 0 10px; }
    .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin:14px 0; }
    .kv { border:1px solid var(--line); border-radius:8px; background:#f8fafc; padding:10px; }
    .kv strong { display:block; color:var(--muted); font-size:12px; margin-bottom:4px; }
    .question { color:var(--blue); font-weight:700; font-size:18px; }
    .answer { line-height:1.7; background:#f8fafc; border:1px solid var(--line); border-radius:8px; padding:14px; }
    .answer p { margin:0 0 10px; }
    .answer ul, .answer ol { margin:0 0 12px 24px; padding:0; }
    .answer table { width:100%; border-collapse:collapse; margin:10px 0 12px; background:white; }
    .answer th, .answer td { border:1px solid var(--line); padding:8px 10px; text-align:left; vertical-align:top; }
    .answer th { background:#edf5fb; }
    .slide { margin:12px 0; border:1px solid var(--line); border-radius:8px; background:#f8fafc; padding:12px; }
    .slide img { display:block; max-width:100%; max-height:440px; margin:0 auto; background:white; }
    .slide .fallback { color:var(--red); }
    .low { color:var(--red); } .medium { color:var(--gold); } .high { color:var(--green); }
    ul { line-height:1.6; }
  </style>
</head>
<body>
<main>
  <section class="case">
    <h1>${escapeHtml(item.id)} ${escapeHtml(item.title)}</h1>
    <p class="question">${escapeHtml(item.query)}</p>
    <div class="grid">
      <div class="kv"><strong>mode</strong>${escapeHtml(item.response.answerGenerationMode)}</div>
      <div class="kv"><strong>confidence</strong><span class="${item.response.confidence}">${escapeHtml(item.response.confidence)}</span></div>
      <div class="kv"><strong>answerability</strong>${escapeHtml(item.response.decisionTrace.answerability.status)}</div>
      <div class="kv"><strong>skill</strong>${escapeHtml(item.response.usedSkills?.[0]?.status ?? "none")}</div>
    </div>
    <h2>Current PPT Page</h2>
    ${renderMaterialPreviewHtml(item, "../")}
    <h2>Answer</h2>
    <div class="answer">${renderMarkdownHtml(item.response.answer)}</div>
    <h2>Citations</h2>
    <ul>${(item.response.citations.length ? item.response.citations : [{ sourceType: "none", title: "none" }])
      .map((citation: any) => `<li>${escapeHtml(formatCitation(citation))}</li>`)
      .join("")}</ul>
    <h2>Debug</h2>
    <div class="grid">
      <div class="kv"><strong>selected evidence</strong>${item.response.evidenceDebug.selected.length}</div>
      <div class="kv"><strong>rejected evidence</strong>${item.response.evidenceDebug.rejected.length}</div>
      <div class="kv"><strong>retrieval</strong>${escapeHtml(item.response.retrievalDebug?.status ?? "not called")}</div>
      <div class="kv"><strong>duration</strong>${item.durationMs} ms</div>
    </div>
  </section>
</main>
</body>
</html>`;
}

async function findEdge(): Promise<string | undefined> {
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

function runEdge(edgePath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(edgePath, args, { stdio: "ignore", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Headless browser exited with code ${code}`));
    });
  });
}

function summarize(text: string | undefined, maxLength: number): string {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
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
  return `${citation.sourceType}: ${citation.title ?? citation.sourceId ?? "untitled"}`;
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

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type EvaluationCase = {
  id: string;
  title: string;
  query: string;
  materialPath?: string;
  pageIndex: number;
  learnerLevel: "beginner" | "intermediate" | "advanced" | "unknown";
  stylePreference: AnswerStylePreference;
};

type EvaluationResult = EvaluationCase & {
  material: {
    id: string;
    fileName?: string;
    pageIndex: number;
    pageTitle?: string;
    previewImagePath?: string;
    previewImageUrl?: string;
    previewStatus?: string;
    previewError?: string;
  };
  durationMs: number;
  response: any;
};
