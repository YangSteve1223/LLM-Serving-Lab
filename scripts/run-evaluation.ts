import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LearningAssistantAgent,
  LearningContextBuilder,
  MarkdownKnowledgeBase,
  createMaterialProvider,
  type AssistantAgentResponse,
  type LearningContext,
  type LearningMaterial
} from "../src/agents/learningAssistant/index.ts";

type EvaluationCase = {
  id: string;
  title: string;
  pressure: "normal" | "high" | "extreme";
  query: string;
  context: LearningContext;
  agent: LearningAssistantAgent;
  expected: string[];
  pass: (response: AssistantAgentResponse) => boolean;
};

type EvaluationResult = {
  id: string;
  title: string;
  pressure: EvaluationCase["pressure"];
  query: string;
  expected: string[];
  passed: boolean;
  answerPreview: string;
  confidence: AssistantAgentResponse["confidence"];
  decisionTrace: AssistantAgentResponse["decisionTrace"];
  usedSkills: AssistantAgentResponse["usedSkills"];
  teachingPolicy: AssistantAgentResponse["teachingPolicy"];
  citations: AssistantAgentResponse["citations"];
};

const currentFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFile), "..");
const reportDir = path.join(rootDir, "reports", "evaluation", "latest");
await fs.mkdir(reportDir, { recursive: true });

const kb = await MarkdownKnowledgeBase.fromPaths({
  rootDir,
  paths: [path.join("Education_LLM_Wiki_Operating_Package", "Education_LLM_Wiki_Operating_Package")]
});

const plainAgent = new LearningAssistantAgent();
const kbAgent = new LearningAssistantAgent({ kb });
const builder = new LearningContextBuilder();
const markdownMaterial = await loadDemoMaterial();
const currentPageContext = builder.build({
  material: markdownMaterial,
  pageIndex: 2,
  learner: {
    profile: {
      level: "beginner",
      language: "zh"
    }
  }
});
const platformOutlineContext = builder.build({
  material: markdownMaterial,
  pageIndex: 2,
  platformOutline: {
    source: "platform",
    items: [
      {
        id: "module-qa",
        title: "证据驱动学习问答",
        pageStart: 1,
        pageEnd: 2,
        children: [{ id: "module-qa-2", title: "证据驱动回答", pageStart: 2, pageEnd: 2 }]
      }
    ]
  },
  platformTeacherScript: {
    source: "platform",
    text: "本页强调 skill 检索返回 evidence，平台再展示 citations 和 decisionTrace。"
  },
  learner: {
    profile: {
      level: "intermediate",
      language: "zh"
    }
  },
  chatHistory: [{ role: "user", content: "为什么回答需要引用？" }]
});

const cases: EvaluationCase[] = [
  {
    id: "E01",
    title: "当前页上下文自由问答",
    pressure: "normal",
    query: "这页主要讲什么？",
    context: currentPageContext,
    agent: plainAgent,
    expected: ["使用 current_page citation", "不调用知识库", "返回 decisionTrace"],
    pass: (response) =>
      response.usedContext.usedCurrentPage &&
      response.usedSkills[0].status === "skipped" &&
      response.citations.some((citation) => citation.sourceType === "current_page") &&
      response.decisionTrace.contextUsed.currentPage
  },
  {
    id: "E02",
    title: "显式知识库检索",
    pressure: "high",
    query: "除了当前页，知识库里有没有更完整的运行流程解释？",
    context: currentPageContext,
    agent: kbAgent,
    expected: ["调用 KnowledgeRetrievalSkill", "同时保留当前页和 wiki citation"],
    pass: (response) =>
      response.usedSkills[0].status === "called" &&
      response.teachingPolicy.shouldRetrieveKnowledge &&
      response.citations.some((citation) => citation.sourceType === "current_page") &&
      response.citations.some((citation) => citation.sourceType === "wiki")
  },
  {
    id: "E03",
    title: "平台大纲和讲稿接入",
    pressure: "high",
    query: "结合刚才的问题，这页我应该先抓住什么？",
    context: platformOutlineContext,
    agent: plainAgent,
    expected: ["使用平台大纲", "使用平台讲稿", "使用历史对话"],
    pass: (response) =>
      response.usedContext.usedOutline &&
      response.usedContext.usedTeacherScript &&
      response.usedContext.usedChatHistory &&
      response.decisionTrace.contextUsed.outline
  },
  {
    id: "E04",
    title: "手动风格覆盖",
    pressure: "normal",
    query: "RAG 和普通 LLM 问答有什么区别？",
    context: builder.build({
      material: markdownMaterial,
      pageIndex: 2,
      stylePreference: "deep_dive",
      learner: {
        profile: {
          level: "advanced",
          language: "zh"
        }
      }
    }),
    agent: plainAgent,
    expected: ["policy.source=user_override", "style=deep_dive"],
    pass: (response) => response.teachingPolicy.source === "user_override" && response.teachingPolicy.style === "deep_dive"
  },
  {
    id: "E05",
    title: "资料不足不编造",
    pressure: "extreme",
    query: "请给出 AlphaBetaZeta-927 的具体公式、数值推导和预算表。",
    context: {},
    agent: kbAgent,
    expected: ["confidence=low", "不返回 citation", "说明资料不足"],
    pass: (response) =>
      response.confidence === "low" &&
      response.citations.length === 0 &&
      /没有足够依据|资料不足/.test(response.answer)
  }
];

const pptMaterial = await loadOptionalPptMaterial();
if (pptMaterial) {
  const pageIndex = pptMaterial.pages.find((page) => page.text.trim())?.pageIndex ?? 1;
  cases.push({
    id: "E06",
    title: "本地 PPTX 泛化加载",
    pressure: "high",
    query: "这页的核心内容是什么？",
    context: builder.build({ material: pptMaterial, pageIndex }),
    agent: plainAgent,
    expected: ["读取 PPTX 页文本", "围绕当前页回答", "返回 current_page citation"],
    pass: (response) =>
      response.usedContext.usedCurrentPage &&
      response.citations.some((citation) => citation.sourceType === "current_page") &&
      response.answer.length > 20
  });
}

const results: EvaluationResult[] = [];
for (const item of cases) {
  const response = await item.agent.answer(item.query, item.context);
  results.push({
    id: item.id,
    title: item.title,
    pressure: item.pressure,
    query: item.query,
    expected: item.expected,
    passed: item.pass(response),
    answerPreview: preview(response.answer, 260),
    confidence: response.confidence,
    decisionTrace: response.decisionTrace,
    usedSkills: response.usedSkills,
    teachingPolicy: response.teachingPolicy,
    citations: response.citations
  });
}

const testFiles = [
  "tests/learningAssistant/context-awareness.test.ts",
  "tests/learningAssistant/agent-flow.test.ts",
  "tests/learningAssistant/evaluator-stress.test.ts"
];
const testRun = spawnSync(process.execPath, ["--test", ...testFiles], {
  cwd: rootDir,
  encoding: "utf8"
});

const summary = {
  generatedAt: new Date().toISOString(),
  totalEvaluationCases: results.length,
  passedEvaluationCases: results.filter((result) => result.passed).length,
  failedEvaluationCases: results.filter((result) => !result.passed).length,
  nodeTestExitCode: testRun.status,
  nodeTestPassed: testRun.status === 0,
  pptFixtureUsed: Boolean(pptMaterial),
  externalApiCalls: 0
};

await fs.writeFile(path.join(reportDir, "evaluation-results.json"), JSON.stringify({ summary, results }, null, 2), "utf8");
await fs.writeFile(path.join(reportDir, "evaluation-log.md"), buildMarkdownReport(summary, results, testRun), "utf8");
await fs.writeFile(path.join(reportDir, "evaluation-report.html"), buildHtmlReport(summary, results), "utf8");

console.log(`Evaluation report written to: ${reportDir}`);
console.log(`Evaluation cases: ${summary.passedEvaluationCases}/${summary.totalEvaluationCases} passed`);
console.log(`Node tests exit code: ${summary.nodeTestExitCode}`);
if (summary.failedEvaluationCases > 0 || testRun.status !== 0) process.exitCode = 1;

async function loadDemoMaterial(): Promise<LearningMaterial> {
  const filePath = path.join(rootDir, "examples", "learning-assistant-demo", "sample-material.md");
  const provider = createMaterialProvider({ type: "markdown", filePath });
  return provider.load({ type: "markdown", filePath });
}

async function loadOptionalPptMaterial(): Promise<LearningMaterial | undefined> {
  const pptDir = process.env.TEST_PPT_DIR ? path.resolve(process.env.TEST_PPT_DIR) : path.join(rootDir, "测试集", "测试PPT");
  try {
    const entries = await fs.readdir(pptDir, { withFileTypes: true });
    const pptx = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pptx"));
    if (!pptx) return undefined;
    const filePath = path.join(pptDir, pptx.name);
    const provider = createMaterialProvider({
      type: "pptx",
      filePath,
      metadata: {
        workspaceRoot: rootDir
      }
    });
    return provider.load({
      type: "pptx",
      filePath,
      metadata: {
        workspaceRoot: rootDir
      }
    });
  } catch {
    return undefined;
  }
}

function buildMarkdownReport(
  summary: typeof summary,
  results: EvaluationResult[],
  testRun: ReturnType<typeof spawnSync>
): string {
  const lines: string[] = [];
  lines.push("# Learning Assistant Agent Evaluation Log");
  lines.push("");
  lines.push(`- Generated at: ${summary.generatedAt}`);
  lines.push(`- Evaluation cases: ${summary.passedEvaluationCases}/${summary.totalEvaluationCases} passed`);
  lines.push(`- Node test exit code: ${summary.nodeTestExitCode}`);
  lines.push(`- PPT fixture used: ${summary.pptFixtureUsed}`);
  lines.push(`- External API calls: ${summary.externalApiCalls}`);
  lines.push("");
  lines.push("## Case Summary");
  lines.push("");
  lines.push("| ID | Result | Pressure | Scenario | Confidence | Skill | Citations |");
  lines.push("|---|---|---|---|---|---|---:|");
  for (const result of results) {
    lines.push(
      `| ${result.id} | ${result.passed ? "PASS" : "FAIL"} | ${result.pressure} | ${escapeMd(result.title)} | ${result.confidence} | ${result.usedSkills[0]?.status ?? "none"} | ${result.citations.length} |`
    );
  }
  lines.push("");

  for (const result of results) {
    lines.push(`## ${result.id} ${result.title}`);
    lines.push("");
    lines.push(`- Query: ${result.query}`);
    lines.push(`- Expected: ${result.expected.join("; ")}`);
    lines.push(`- Result: ${result.passed ? "PASS" : "FAIL"}`);
    lines.push(`- Decision trace: \`${JSON.stringify(result.decisionTrace)}\``);
    lines.push(`- Teaching policy: \`${JSON.stringify(result.teachingPolicy)}\``);
    lines.push(`- Used skills: \`${JSON.stringify(result.usedSkills)}\``);
    lines.push(`- Citations: ${result.citations.length}`);
    lines.push("");
    lines.push("Answer preview:");
    lines.push("");
    lines.push("```text");
    lines.push(result.answerPreview);
    lines.push("```");
    lines.push("");
  }

  lines.push("## Node Test Output");
  lines.push("");
  lines.push("```text");
  lines.push(String(testRun.stdout ?? ""));
  if (testRun.stderr) lines.push(String(testRun.stderr));
  lines.push("```");
  return `${lines.join("\n")}\n`;
}

function buildHtmlReport(summary: typeof summary, results: EvaluationResult[]): string {
  const rows = results
    .map(
      (result) => `<tr>
        <td>${result.id}</td>
        <td class="${result.passed ? "pass" : "fail"}">${result.passed ? "PASS" : "FAIL"}</td>
        <td>${result.pressure}</td>
        <td>${escapeHtml(result.title)}</td>
        <td>${result.confidence}</td>
        <td>${result.usedSkills[0]?.status ?? "none"}</td>
        <td>${result.citations.length}</td>
      </tr>`
    )
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Learning Assistant Agent Evaluation</title>
  <style>
    body { font-family: Arial, "Microsoft YaHei", sans-serif; margin: 32px; color: #172033; background: #f7f8fb; }
    main { max-width: 1100px; margin: 0 auto; background: white; border: 1px solid #d9deea; border-radius: 8px; padding: 28px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e6e9f2; padding: 10px; text-align: left; }
    th { background: #eef2f8; }
    .pass { color: #0f7b3a; font-weight: 700; }
    .fail { color: #b42318; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <h1>Learning Assistant Agent Evaluation</h1>
    <p>${summary.passedEvaluationCases}/${summary.totalEvaluationCases} cases passed. Node tests: ${summary.nodeTestPassed ? "PASS" : "FAIL"}. External API calls: 0.</p>
    <table>
      <thead><tr><th>ID</th><th>Result</th><th>Pressure</th><th>Scenario</th><th>Confidence</th><th>Skill</th><th>Citations</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
</body>
</html>`;
}

function preview(text: string, length: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= length ? normalized : `${normalized.slice(0, length)}...`;
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
