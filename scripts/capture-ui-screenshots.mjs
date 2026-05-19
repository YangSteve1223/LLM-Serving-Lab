import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFile), "..");
const outDir = path.join(rootDir, "reports", "ui-screenshots", "latest");
const port = Number(process.env.PORT ?? 4173);
const url = `http://127.0.0.1:${port}`;

await fs.mkdir(outDir, { recursive: true });

const server = spawn(process.execPath, ["examples/learning-assistant-ui/server.ts"], {
  cwd: rootDir,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

try {
  await waitForServer(`${url}/api/config`);
  const edge = await findEdge();
  if (!edge) {
    await fs.writeFile(path.join(outDir, "SCREENSHOT_SKIPPED.txt"), "Microsoft Edge or Chrome executable was not found.", "utf8");
    console.log(`UI screenshot skipped; browser executable was not found. Artifacts directory: ${outDir}`);
  } else {
    await captureUrl(edge, url, path.join(outDir, "01-loaded-testbench.png"), "1440,1200");

    const config = await getJson(`${url}/api/config`);
    const materialFile = chooseMaterialFile(config.files ?? []);
    if (!materialFile) throw new Error("No PPTX or PPT file is available for UI screenshot scenarios.");
    const materialPayload = await postJson(`${url}/api/load-material`, {
      filePath: materialFile.filePath,
      pageIndex: 1
    });

    const scenarios = [
      {
        file: "02-current-page-summary.png",
        title: "当前页总结",
        query: "这页主要讲什么？",
        style: "auto"
      },
      {
        file: "03-knowledge-base-retrieval.png",
        title: "知识库检索",
        query: "除了当前 PPT，这个概念在知识库里有没有更完整解释？",
        style: "auto"
      },
      {
        file: "04-style-override-deep-dive.png",
        title: "风格覆盖",
        query: "RAG 和普通 LLM 问答有什么区别？",
        style: "deep_dive"
      },
      {
        file: "05-insufficient-context.png",
        title: "无依据拒答",
        query: "请给出 AlphaBetaZeta-927 的具体公式、数值推导和预算表。",
        style: "auto"
      }
    ];

    for (const scenario of scenarios) {
      const answer = await postJson(`${url}/api/ask`, {
        materialId: materialPayload.material.id,
        pageIndex: materialPayload.page.pageIndex,
        query: scenario.query,
        learnerLevel: "intermediate",
        stylePreference: scenario.style,
        groundingMode: "allow_general_knowledge_with_label"
      });
      const caseHtml = renderScenarioHtml({
        ...scenario,
        materialTitle: materialPayload.material.title,
        pageTitle: materialPayload.page.title,
        pageIndex: materialPayload.page.pageIndex,
        previewImageUrl: materialPayload.page.previewImageUrl ? `${url}${materialPayload.page.previewImageUrl}` : undefined,
        previewStatus: materialPayload.page.preview?.status,
        previewError: materialPayload.page.preview?.error,
        response: answer
      });
      const caseHtmlPath = path.join(outDir, scenario.file.replace(/\.png$/i, ".html"));
      await fs.writeFile(caseHtmlPath, caseHtml, "utf8");
      await captureUrl(edge, `file:///${caseHtmlPath.replaceAll("\\", "/")}`, path.join(outDir, scenario.file), "1440,1400");
    }

    await fs.writeFile(
      path.join(outDir, "screenshot-log.md"),
      [
        "# Learning Assistant UI Screenshot Log",
        "",
        `- URL: ${url}`,
        `- Captured at: ${new Date().toISOString()}`,
        `- Material: ${materialPayload.material.title}`,
        `- Page: ${materialPayload.page.pageIndex} ${materialPayload.page.title ?? ""}`,
        "",
        "| File | Query | Style |",
        "|---|---|---|",
        "| 01-loaded-testbench.png | initial material load | auto |",
        ...scenarios.map((item) => `| ${item.file} | ${item.query} | ${item.style} |`),
        ""
      ].join("\n"),
      "utf8"
    );

    console.log(`UI screenshots written to ${outDir}`);
  }
} finally {
  server.kill();
  await fs.writeFile(path.join(outDir, "server-output.log"), serverOutput, "utf8").catch(() => {});
}

async function waitForServer(targetUrl) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      const response = await fetch(targetUrl);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Server did not start: ${targetUrl}`);
}

async function getJson(targetUrl) {
  const response = await fetch(targetUrl);
  if (!response.ok) throw new Error(`${targetUrl} failed with HTTP ${response.status}`);
  return response.json();
}

async function postJson(targetUrl, payload) {
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`${targetUrl} failed with HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

function chooseMaterialFile(files) {
  return files.find((item) => /\.pptx$/i.test(item.filePath ?? "")) ?? files.find((item) => /\.ppt$/i.test(item.filePath ?? ""));
}

async function findEdge() {
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

async function captureUrl(browserPath, targetUrl, screenshotPath, windowSize) {
  await runBrowser(browserPath, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--virtual-time-budget=6000",
    `--window-size=${windowSize}`,
    `--screenshot=${screenshotPath}`,
    targetUrl
  ]);
}

async function runBrowser(browserPath, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(browserPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`Browser screenshot failed with exit ${code}: ${stderr}`));
    });
  });
}

function renderScenarioHtml(item) {
  const response = item.response;
  const retrieval = response.retrievalDebug;
  const hardRejectNotice =
    retrieval?.status === "empty" &&
    typeof retrieval?.topScore === "number" &&
    typeof retrieval?.relevanceThreshold === "number" &&
    retrieval.topScore >= retrieval.relevanceThreshold &&
    (retrieval.rejectedChunks ?? []).some((entry) => /hard relevance rule|core entity|concept/i.test(entry.reason ?? ""))
      ? "检索命中了一些片段，但它们没有覆盖问题中的核心实体 / 概念，因此未作为证据使用。"
      : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(item.title)}</title>
  <style>
    :root { --bg:#eef3f6; --paper:#fff; --ink:#172033; --muted:#5a6678; --line:#d8e0e7; --blue:#245b82; --green:#267455; --red:#a83d35; --gold:#9a691e; }
    body { margin:0; background:var(--bg); color:var(--ink); font-family:"Microsoft YaHei","Segoe UI",sans-serif; }
    main { max-width:1280px; margin:0 auto; padding:28px; }
    .panel { background:var(--paper); border:1px solid var(--line); border-radius:10px; padding:24px; }
    h1 { margin:0 0 6px; font-size:30px; }
    h2 { margin:22px 0 10px; font-size:20px; }
    .muted { color:var(--muted); }
    .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin:16px 0; }
    .kv { border:1px solid var(--line); border-radius:8px; background:#f8fafc; padding:10px; overflow-wrap:anywhere; }
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
    .notice { border:1px solid #e2c86f; background:#fff8df; color:#6f4d00; border-radius:8px; padding:12px; margin-top:12px; }
    .low { color:var(--red); } .medium { color:var(--gold); } .high { color:var(--green); }
    ul { line-height:1.6; }
  </style>
</head>
<body>
<main>
  <section class="panel">
    <h1>${escapeHtml(item.title)}</h1>
    <p class="muted">Material: ${escapeHtml(item.materialTitle ?? "unknown")} | Page: ${escapeHtml(String(item.pageTitle ?? "unknown"))}</p>
    <p class="question">${escapeHtml(item.query)}</p>
    <div class="grid">
      <div class="kv"><strong>answer mode</strong>${escapeHtml(response.answerGenerationMode ?? "unknown")}</div>
      <div class="kv"><strong>confidence</strong><span class="${escapeHtml(response.confidence ?? "")}">${escapeHtml(response.confidence ?? "unknown")}</span></div>
      <div class="kv"><strong>answerability</strong>${escapeHtml(response.decisionTrace?.answerability?.status ?? "unknown")}</div>
      <div class="kv"><strong>skill</strong>${escapeHtml(response.usedSkills?.[0]?.status ?? "none")}</div>
    </div>
    <h2>当前 PPT 页</h2>
    ${renderSlidePreview(item)}
    <h2>回答</h2>
    <div class="answer">${renderMarkdownHtml(response.answer ?? "")}</div>
    ${hardRejectNotice ? `<div class="notice">${escapeHtml(hardRejectNotice)}</div>` : ""}
    <h2>引用来源</h2>
    <ul>${renderCitations(response.citations ?? [])}</ul>
    <h2>调试摘要</h2>
    <div class="grid">
      <div class="kv"><strong>selected evidence</strong>${escapeHtml(String(response.evidenceDebug?.selected?.length ?? 0))}</div>
      <div class="kv"><strong>rejected evidence</strong>${escapeHtml(String(response.evidenceDebug?.rejected?.length ?? 0))}</div>
      <div class="kv"><strong>retrieval</strong>${escapeHtml(retrieval?.status ?? "not called")}</div>
      <div class="kv"><strong>top / threshold</strong>${escapeHtml(formatScore(retrieval?.topScore))} / ${escapeHtml(formatScore(retrieval?.relevanceThreshold))}</div>
    </div>
  </section>
</main>
</body>
</html>`;
}

function renderCitations(citations) {
  if (!citations.length) return "<li>none</li>";
  return citations.map((citation) => `<li>${escapeHtml(formatCitation(citation))}</li>`).join("");
}

function formatCitation(citation) {
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

function renderSlidePreview(item) {
  if (item.previewImageUrl) {
    return `<div class="slide"><p>${escapeHtml(item.materialTitle ?? "material")} / page ${escapeHtml(String(item.pageIndex ?? ""))} / ${escapeHtml(item.pageTitle ?? "untitled")}</p><img src="${escapeHtml(item.previewImageUrl)}" alt="Slide ${escapeHtml(String(item.pageIndex ?? ""))} preview" /></div>`;
  }
  return `<div class="slide"><p class="fallback">预览渲染失败：${escapeHtml(item.previewError ?? item.previewStatus ?? "unavailable")}。已显示解析文本。</p></div>`;
}

function formatScore(value) {
  return typeof value === "number" ? value.toFixed(3) : "n/a";
}

function renderMarkdownHtml(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let listType;
  let tableRows = [];

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

function inlineMarkdownHtml(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
