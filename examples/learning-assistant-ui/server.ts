import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KimiLLMClient,
  FutureSchoolAgent,
  LearnerMemoryStore,
  LearningAssistantAgent,
  LearningContextBuilder,
  LearningLoopAgent,
  MarkdownKnowledgeBase,
  OpenAICompatibleLLMClient,
  PowerPointComSlideRenderer,
  ResourceLibraryStore,
  ResourceScoutAgent,
  TeacherInsightAgent,
  applySlidePreviewManifest,
  createLLMClientFromEnv,
  createMaterialProvider,
  materialToMarkdown,
  pageToMarkdown,
  type AnswerStylePreference,
  type GroundingMode,
  type LearningContext,
  type LLMClient,
  type LearningMaterial,
  type LearningPage,
  type MicroQuiz,
  type SlidePreview,
  type SlidePreviewManifest
} from "../../src/agents/learningAssistant/index.ts";

const currentFile = fileURLToPath(import.meta.url);
const uiDir = path.dirname(currentFile);
const rootDir = path.resolve(uiDir, "..", "..");
const publicDir = path.join(uiDir, "public");
const port = Number(process.env.PORT ?? 4173);
const configuredPptDir = process.env.TEST_PPT_DIR
  ? path.resolve(process.env.TEST_PPT_DIR)
  : path.join(rootDir, "测试集", "测试PPT");
const wikiPath = process.env.TEST_WIKI_PATH
  ? path.resolve(process.env.TEST_WIKI_PATH)
  : path.join(rootDir, "Education_LLM_Wiki_Operating_Package", "Education_LLM_Wiki_Operating_Package");
const requireRealLlmForDemo = /^true$/i.test(process.env.REQUIRE_REAL_LLM_FOR_DEMO ?? "");

const kb = await MarkdownKnowledgeBase.fromPaths({
  rootDir,
  paths: [path.relative(rootDir, wikiPath)]
});
const envLlm = createLLMClientFromEnv();
const contextBuilder = new LearningContextBuilder();
const materials = new Map<string, LearningMaterial>();
const previewManifests = new Map<string, SlidePreviewManifest>();
const previewRenderer = new PowerPointComSlideRenderer({ rootDir });
const learnerMemoryStore = new LearnerMemoryStore({ rootDir });
const learningLoopAgent = new LearningLoopAgent({ memoryStore: learnerMemoryStore });
const resourceStore = new ResourceLibraryStore({ rootDir });
const resourceScoutAgent = new ResourceScoutAgent({ resourceStore, env: process.env });
const teacherInsightAgent = new TeacherInsightAgent();
const futureSchoolAgent = new FutureSchoolAgent();
const quizzes = new Map<string, MicroQuiz>();

const exampleQuestions = [
  "这页主要讲什么？",
  "这页最重要的概念是什么？",
  "给我一个检查理解的小问题",
  "这里最容易混淆的点是什么？",
  "请用生活类比解释这页",
  "我学完这页应该记住什么？"
];

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);

    if (request.method === "GET" && url.pathname === "/api/config") {
      return sendJson(response, {
        pptDir: configuredPptDir,
        wikiPath,
        llm: {
          enabled: Boolean(envLlm.client),
          provider: envLlm.config?.provider,
          model: envLlm.config?.model,
          baseUrl: envLlm.config?.baseUrl,
          reason: envLlm.reason,
          requireRealLlmForDemo
        },
        files: await listPptFiles(configuredPptDir),
        exampleQuestions
      });
    }

    if (request.method === "POST" && url.pathname === "/api/load-material") {
      const body = await readJson(request);
      const filePath = requireString(body.filePath, "filePath");
      const pageIndex = Number(body.pageIndex ?? 1);
      const material = await loadMaterial(filePath);
      return sendJson(response, buildMaterialPayload(material, pageIndex));
    }

    if (request.method === "POST" && url.pathname === "/api/page") {
      const body = await readJson(request);
      const material = getMaterial(requireString(body.materialId, "materialId"));
      const pageIndex = Number(body.pageIndex ?? 1);
      return sendJson(response, buildMaterialPayload(material, pageIndex));
    }

    const materialPageMatch = url.pathname.match(/^\/api\/material\/([^/]+)\/pages\/(\d+)$/);
    if (request.method === "GET" && materialPageMatch) {
      const material = getMaterial(decodeURIComponent(materialPageMatch[1]));
      const pageIndex = Number(materialPageMatch[2]);
      return sendJson(response, buildPagePayload(material, pageIndex));
    }

    const previewMatch = url.pathname.match(/^\/api\/material\/([^/]+)\/pages\/(\d+)\/preview$/);
    if (request.method === "GET" && previewMatch) {
      const material = getMaterial(decodeURIComponent(previewMatch[1]));
      const pageIndex = Number(previewMatch[2]);
      return servePreview(response, material, pageIndex);
    }

    if (request.method === "POST" && url.pathname === "/api/ask") {
      const body = await readJson(request);
      const material = getMaterial(requireString(body.materialId, "materialId"));
      const query = requireString(body.query, "query").trim();
      const pageIndex = Number(body.pageIndex ?? 1);
      const stylePreference = normalizeStylePreference(body.stylePreference);
      const learnerLevel = normalizeLearnerLevel(body.learnerLevel);
      const groundingMode = normalizeGroundingMode(body.groundingMode);
      const requestLlm = createLLMClientFromRequest(body) ?? envLlm.client;
      const requireRealLlm = Boolean(body.requireRealLlm ?? requireRealLlmForDemo);
      const context = buildContextForAsk(material, pageIndex, learnerLevel, stylePreference);
      const agent = new LearningAssistantAgent({
        kb,
        llm: requestLlm,
        requireRealLlm,
        groundingMode
      });
      const result = await agent.answer(query, context);
      return sendJson(response, result);
    }

    if (request.method === "POST" && url.pathname === "/api/learning-loop/diagnose") {
      const body = await readJson(request);
      const material = getMaterial(requireString(body.materialId, "materialId"));
      const pageIndex = Number(body.pageIndex ?? 1);
      const learnerId = typeof body.learnerId === "string" ? body.learnerId : "demo-learner";
      const context = buildContextForAsk(material, pageIndex, normalizeLearnerLevel(body.learnerLevel), normalizeStylePreference(body.stylePreference));
      const memory = await learnerMemoryStore.getMemory(learnerId);
      const diagnosis = learningLoopAgent.diagnose({
        query: requireString(body.query, "query"),
        assistantAnswer: typeof body.assistantAnswer === "string" ? body.assistantAnswer : undefined,
        learningContext: context,
        learnerMemory: memory,
        chatHistory: Array.isArray(body.chatHistory) ? (body.chatHistory as Array<{ role: string; content: string }>) : undefined
      });
      return sendJson(response, { diagnosis });
    }

    if (request.method === "POST" && url.pathname === "/api/learning-loop/generate-quiz") {
      const body = await readJson(request);
      const material = getMaterial(requireString(body.materialId, "materialId"));
      const pageIndex = Number(body.pageIndex ?? 1);
      const learnerId = typeof body.learnerId === "string" ? body.learnerId : "demo-learner";
      const context = buildContextForAsk(material, pageIndex, normalizeLearnerLevel(body.learnerLevel), "auto");
      const memory = await learnerMemoryStore.getMemory(learnerId);
      const requestLlm = createLLMClientFromRequest(body) ?? envLlm.client;
      if (!requestLlm) {
        return sendJson(
          response,
          {
            error: "生成高质量小测需要连接真实模型。请先在“模型设置”中配置 API Key。",
            code: "REAL_LLM_REQUIRED"
          },
          409
        );
      }
      const quiz = await learningLoopAgent.generateMicroQuiz({
        learningContext: context,
        learnerMemory: memory,
        learnerId,
        difficulty: normalizeDifficulty(body.difficulty),
        count: typeof body.count === "number" ? body.count : 3,
        llm: requestLlm
      });
      quizzes.set(quiz.id, quiz);
      return sendJson(response, { quiz });
    }

    if (request.method === "POST" && url.pathname === "/api/learning-loop/grade") {
      const body = await readJson(request);
      const material = getMaterial(requireString(body.materialId, "materialId"));
      const pageIndex = Number(body.pageIndex ?? 1);
      const learnerId = typeof body.learnerId === "string" ? body.learnerId : "demo-learner";
      const quizId = requireString(body.quizId, "quizId");
      const questionId = requireString(body.questionId, "questionId");
      const quiz = quizzes.get(quizId);
      const question = quiz?.questions.find((item) => item.id === questionId);
      if (!question) throw new Error(`Quiz question not found: ${quizId}/${questionId}`);
      const context = buildContextForAsk(material, pageIndex, normalizeLearnerLevel(body.learnerLevel), "auto");
      const gradingResult = learningLoopAgent.gradeQuizAnswer({
        quizQuestion: question,
        quizId,
        studentAnswer: requireString(body.studentAnswer, "studentAnswer"),
        learningContext: context,
        learnerMemory: await learnerMemoryStore.getMemory(learnerId)
      });
      const reviewTasks = learningLoopAgent.planReview({ gradingResult, learningContext: context });
      const updatedLearnerMemory = await learningLoopAgent.updateLearnerMemory({ learnerId, gradingResult, reviewTasks });
      return sendJson(response, { gradingResult, reviewTasks, updatedLearnerMemory });
    }

    const memoryMatch = url.pathname.match(/^\/api\/learning-loop\/memory\/([^/]+)$/);
    if (request.method === "GET" && memoryMatch) {
      return sendJson(response, { memory: await learnerMemoryStore.getMemory(decodeURIComponent(memoryMatch[1])) });
    }
    if (request.method === "POST" && memoryMatch) {
      return sendJson(response, { memory: await learnerMemoryStore.clearMemory(decodeURIComponent(memoryMatch[1])) });
    }

    const reviewMatch = url.pathname.match(/^\/api\/learning-loop\/review\/([^/]+)$/);
    if (request.method === "GET" && reviewMatch) {
      const memory = await learnerMemoryStore.getMemory(decodeURIComponent(reviewMatch[1]));
      return sendJson(response, { reviewTasks: memory.reviewTasks });
    }

    if (request.method === "POST" && url.pathname === "/api/resources/recommend") {
      const body = await readJson(request);
      const material = getMaterial(requireString(body.materialId, "materialId"));
      const pageIndex = Number(body.pageIndex ?? 1);
      const learnerId = typeof body.learnerId === "string" ? body.learnerId : "demo-learner";
      const context = buildContextForAsk(material, pageIndex, normalizeLearnerLevel(body.learnerLevel), "auto");
      const learnerMemory = await learnerMemoryStore.getMemory(learnerId);
      const requestResourceScoutAgent = createResourceScoutAgentFromRequest(body);
      const result = await requestResourceScoutAgent.recommendWithStatus({
        learningContext: context,
        learnerMemory,
        learnerLevel: normalizeLearnerLevel(body.learnerLevel) === "unknown" ? undefined : normalizeLearnerLevel(body.learnerLevel),
        preferredDurationMinutes: parseNumber(body.preferredDurationMinutes)
      });
      return sendJson(response, result);
    }

    if (request.method === "POST" && url.pathname === "/api/resources/tasks") {
      const body = await readJson(request);
      const material = getMaterial(requireString(body.materialId, "materialId"));
      const pageIndex = Number(body.pageIndex ?? 1);
      const learnerId = typeof body.learnerId === "string" ? body.learnerId : "demo-learner";
      const context = buildContextForAsk(material, pageIndex, normalizeLearnerLevel(body.learnerLevel), "auto");
      const learnerMemory = await learnerMemoryStore.getMemory(learnerId);
      const requestResourceScoutAgent = createResourceScoutAgentFromRequest(body);
      const result = await requestResourceScoutAgent.recommendWithStatus({
        learningContext: context,
        learnerMemory,
        learnerLevel: normalizeLearnerLevel(body.learnerLevel) === "unknown" ? undefined : normalizeLearnerLevel(body.learnerLevel),
        preferredDurationMinutes: parseNumber(body.preferredDurationMinutes)
      });
      return sendJson(response, {
        ...result,
        tasks: futureSchoolAgent.buildResourceTasks({ recommendations: result.recommendations, learnerMemory })
      });
    }

    if (request.method === "POST" && url.pathname === "/api/teacher/insights") {
      const body = await readJson(request);
      const usesMock = !body.session;
      const session = (body.session ?? mockClassSession()) as Parameters<typeof teacherInsightAgent.generateReport>[0];
      const report = teacherInsightAgent.generateReport(session);
      const dashboardReport = teacherInsightAgent.generateDashboardReport({
        session,
        dataSource: usesMock ? "demo_mock_class" : "real_learner_memory",
        lessonTitle: typeof body.lessonTitle === "string" ? body.lessonTitle : session.lessonId,
        pageTitle: typeof body.pageTitle === "string" ? body.pageTitle : undefined,
        config: {
          className: typeof body.className === "string" && body.className.trim() ? body.className.trim() : undefined,
          courseName: typeof body.courseName === "string" && body.courseName.trim() ? body.courseName.trim() : undefined,
          lessonName: typeof body.lessonName === "string" && body.lessonName.trim() ? body.lessonName.trim() : undefined,
          teacherName: typeof body.teacherName === "string" && body.teacherName.trim() ? body.teacherName.trim() : undefined,
          studentCount: typeof body.studentCount === "number" && Number.isFinite(body.studentCount) ? body.studentCount : undefined,
          dataSource:
            body.dataSource === "real_learner_memory" || body.dataSource === "mixed" || body.dataSource === "demo_mock_class"
              ? body.dataSource
              : usesMock
                ? "demo_mock_class"
                : "real_learner_memory"
        }
      });
      return sendJson(response, {
        report,
        dashboardReport,
        dataSource: dashboardReport.dataSource,
        dataSourceNotice: usesMock ? "当前为 Demo 班级数据，仅用于演示。" : "基于当前学习记录生成。",
        markdown: teacherInsightAgent.dashboardToMarkdown(dashboardReport)
      });
    }

    if (request.method === "POST" && url.pathname === "/api/teacher/after-class-report") {
      const body = await readJson(request);
      const session = (body.session ?? mockClassSession()) as Parameters<typeof futureSchoolAgent.buildTeacherAfterClassReport>[0]["session"];
      const report = futureSchoolAgent.buildTeacherAfterClassReport({ session });
      return sendJson(response, { report, markdown: futureSchoolAgent.teacherReportToMarkdown(report) });
    }

    if (request.method === "POST" && url.pathname === "/api/learning-loop/session-report") {
      const body = await readJson(request);
      const material = getMaterial(requireString(body.materialId, "materialId"));
      const pageIndex = Number(body.pageIndex ?? 1);
      const learnerId = typeof body.learnerId === "string" ? body.learnerId : "demo-learner";
      const context = buildContextForAsk(material, pageIndex, normalizeLearnerLevel(body.learnerLevel), "auto");
      const learnerMemory = await learnerMemoryStore.getMemory(learnerId);
      const requestResourceScoutAgent = createResourceScoutAgentFromRequest(body);
      const recommendations = await requestResourceScoutAgent.recommend({ learningContext: context, learnerMemory });
      const report = futureSchoolAgent.buildLearnerSessionReport({
        learnerId,
        learningContext: context,
        learnerMemory,
        questionsAsked: Array.isArray(body.questionsAsked) ? (body.questionsAsked as string[]) : [],
        recommendedResources: recommendations.slice(0, 3)
      });
      return sendJson(response, { report, markdown: futureSchoolAgent.learnerReportToMarkdown(report) });
    }

    if (request.method === "POST" && url.pathname === "/api/learning-loop/concept-map") {
      const body = await readJson(request);
      const material = getMaterial(requireString(body.materialId, "materialId"));
      const pageIndex = Number(body.pageIndex ?? 1);
      const learnerId = typeof body.learnerId === "string" ? body.learnerId : "demo-learner";
      const context = buildContextForAsk(material, pageIndex, normalizeLearnerLevel(body.learnerLevel), "auto");
      return sendJson(response, { conceptMap: futureSchoolAgent.buildConceptMap({ learningContext: context, learnerMemory: await learnerMemoryStore.getMemory(learnerId) }) });
    }

    if (request.method === "POST" && url.pathname === "/api/wiki/writeback-suggestion") {
      const body = await readJson(request);
      const learnerId = typeof body.learnerId === "string" ? body.learnerId : "demo-learner";
      return sendJson(response, {
        suggestion: futureSchoolAgent.suggestWikiWriteback({
          learnerMemory: await learnerMemoryStore.getMemory(learnerId),
          classSession: mockClassSession(),
          retrievalStatus: typeof body.retrievalStatus === "string" ? (body.retrievalStatus as "success" | "empty" | "failed" | "skipped") : undefined,
          query: typeof body.query === "string" ? body.query : undefined
        })
      });
    }

    if (request.method === "GET") {
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname === "/competition" ? "/competition.html" : url.pathname;
      const filePath = path.resolve(publicDir, `.${pathname}`);
      if (!isInside(publicDir, filePath)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      const content = await fs.readFile(filePath);
      response.writeHead(200, { "content-type": contentType(filePath) });
      response.end(content);
      return;
    }

    response.writeHead(405);
    response.end("Method Not Allowed");
  } catch (error) {
    sendJson(response, { error: error instanceof Error ? error.message : "unknown server error" }, 500);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Learning Assistant UI running at http://127.0.0.1:${port}`);
});

async function loadMaterial(filePath: string): Promise<LearningMaterial> {
  const resolved = path.resolve(filePath);
  assertInsideWorkspace(resolved);
  const extension = path.extname(resolved).toLowerCase();
  const type = extension === ".pptx" ? "pptx" : extension === ".md" ? "markdown" : "unknown";
  const provider = createMaterialProvider({ type, filePath: resolved });
  const material = await provider.load({ type, filePath: resolved, metadata: { workspaceRoot: rootDir } });
  await attachSlidePreviews(material);
  materials.set(material.id, material);
  return material;
}

async function attachSlidePreviews(material: LearningMaterial): Promise<void> {
  if (material.type !== "pptx" || !material.filePath) return;
  const manifest = await previewRenderer.renderDeck({
    type: "pptx",
    filePath: material.filePath,
    metadata: {
      materialId: material.id,
      pageCount: material.pageCount
    }
  });
  previewManifests.set(material.id, manifest);
  applySlidePreviewManifest(material, manifest, {
    imageUrlForPage: (pageIndex, preview) =>
      preview.status === "ready" ? `/api/material/${encodeURIComponent(material.id)}/pages/${pageIndex}/preview` : undefined
  });
}

function buildContextForAsk(
  material: LearningMaterial,
  pageIndex: number,
  learnerLevel: "beginner" | "intermediate" | "advanced" | "unknown",
  stylePreference: AnswerStylePreference
): LearningContext {
  return contextBuilder.build({
    material,
    pageIndex,
    stylePreference,
    learner: {
      id: "ui-learner",
      profile: {
        level: learnerLevel,
        language: "zh",
        stylePreference
      },
      progress: { currentPageIndex: pageIndex }
    },
    chatHistory: [],
    platformMetadata: {
      source: "local-ui",
      materialMarkdownAvailable: true
    }
  });
}

function buildMaterialPayload(material: LearningMaterial, pageIndex: number) {
  const boundedPageIndex = Math.min(Math.max(1, pageIndex), material.pageCount);
  const context = contextBuilder.build({ material, pageIndex: boundedPageIndex });
  const publicPage = toPublicPage(context.currentPage);
  return {
    material: {
      id: material.id,
      title: material.title,
      type: material.type,
      fileName: material.filePath ? path.basename(material.filePath) : undefined,
      filePath: material.filePath,
      pageCount: material.pageCount,
      outline: material.outline
    },
    pages: material.pages.map((page) => ({
      pageIndex: page.pageIndex,
      title: page.semanticTitle ?? page.title,
      previewImageUrl: page.previewImageUrl,
      previewStatus: page.preview?.status ?? "unavailable"
    })),
    page: publicPage,
    pageMarkdown: context.currentPage ? pageToMarkdown(context.currentPage) : "",
    deckMarkdownPreview: materialToMarkdown(material).slice(0, 2400),
    previewManifest: toPublicPreviewManifest(material),
    context: {
      ...context,
      currentPage: publicPage
    }
  };
}

function buildPagePayload(material: LearningMaterial, pageIndex: number) {
  const boundedPageIndex = Math.min(Math.max(1, pageIndex), material.pageCount);
  const context = contextBuilder.build({ material, pageIndex: boundedPageIndex });
  return {
    page: toPublicPage(context.currentPage),
    markdown: context.currentPage ? pageToMarkdown(context.currentPage) : "",
    context: {
      ...context,
      currentPage: toPublicPage(context.currentPage)
    }
  };
}

async function listPptFiles(dir: string) {
  try {
    assertInsideWorkspace(path.resolve(dir));
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.(pptx|md)$/i.test(entry.name))
      .map((entry) => {
        const filePath = path.join(dir, entry.name);
        return {
          name: entry.name,
          filePath,
          type: entry.name.toLowerCase().endsWith(".pptx") ? "pptx" : "markdown"
        };
      });
  } catch {
    return [];
  }
}

function createLLMClientFromRequest(body: Record<string, unknown>): LLMClient | undefined {
  const apiKey = typeof body.llmApiKey === "string" ? body.llmApiKey.trim() : "";
  if (!apiKey) return undefined;
  const provider = typeof body.llmProvider === "string" ? body.llmProvider : "kimi";
  const model = typeof body.llmModel === "string" && body.llmModel.trim() ? body.llmModel.trim() : undefined;
  const baseUrl = typeof body.llmBaseUrl === "string" && body.llmBaseUrl.trim() ? body.llmBaseUrl.trim() : undefined;

  if (provider === "openai-compatible") {
    return new OpenAICompatibleLLMClient({
      apiKey,
      model: model ?? "gpt-4o-mini",
      baseUrl: baseUrl ?? "https://api.openai.com/v1",
      temperature: parseNumber(body.llmTemperature),
      maxTokens: parseNumber(body.llmMaxTokens)
    });
  }

  return new KimiLLMClient({
    apiKey,
    model: model ?? "kimi-k2.5",
    baseUrl: baseUrl ?? "https://api.moonshot.cn/v1",
    temperature: parseNumber(body.llmTemperature),
    maxTokens: parseNumber(body.llmMaxTokens)
  });
}

function createResourceScoutAgentFromRequest(body: Record<string, unknown>): ResourceScoutAgent {
  const transientEnv: Record<string, string | undefined> = {
    ...process.env,
    RESOURCE_SEARCH_PROVIDER: typeof body.resourceSearchProvider === "string" ? body.resourceSearchProvider : process.env.RESOURCE_SEARCH_PROVIDER
  };
  const tavilyApiKey = typeof body.tavilyApiKey === "string" ? body.tavilyApiKey.trim() : "";
  const bingSearchApiKey = typeof body.bingSearchApiKey === "string" ? body.bingSearchApiKey.trim() : "";
  const serpApiKey = typeof body.serpApiKey === "string" ? body.serpApiKey.trim() : "";
  if (tavilyApiKey) transientEnv.TAVILY_API_KEY = tavilyApiKey;
  if (bingSearchApiKey) transientEnv.BING_SEARCH_API_KEY = bingSearchApiKey;
  if (serpApiKey) transientEnv.SERPAPI_API_KEY = serpApiKey;
  return new ResourceScoutAgent({ resourceStore, env: transientEnv });
}

function getMaterial(materialId: string): LearningMaterial {
  const material = materials.get(materialId);
  if (!material) throw new Error(`Material not loaded: ${materialId}`);
  return material;
}

function normalizeStylePreference(value: unknown): AnswerStylePreference {
  const allowed = new Set<AnswerStylePreference>([
    "auto",
    "direct",
    "concise",
    "step_by_step",
    "analogy",
    "socratic",
    "exam_focused",
    "deep_dive",
    "beginner_friendly"
  ]);
  return typeof value === "string" && allowed.has(value as AnswerStylePreference) ? (value as AnswerStylePreference) : "auto";
}

function normalizeLearnerLevel(value: unknown): "beginner" | "intermediate" | "advanced" | "unknown" {
  return value === "beginner" || value === "intermediate" || value === "advanced" ? value : "unknown";
}

function normalizeGroundingMode(value: unknown): GroundingMode {
  return value === "course_grounded_only" ? "course_grounded_only" : "allow_general_knowledge_with_label";
}

function normalizeDifficulty(value: unknown): "easy" | "medium" | "hard" {
  return value === "easy" || value === "hard" ? value : "medium";
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function sendJson(response: Parameters<typeof createServer>[0] extends (req: any, res: infer R) => any ? R : never, data: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data, null, 2));
}

async function servePreview(
  response: Parameters<typeof createServer>[0] extends (req: any, res: infer R) => any ? R : never,
  material: LearningMaterial,
  pageIndex: number
): Promise<void> {
  const page = material.pages.find((item) => item.pageIndex === pageIndex);
  const imagePath = page?.preview?.status === "ready" ? page.preview.imagePath : undefined;
  if (!imagePath) return sendJson(response, { error: page?.preview?.error ?? "Slide preview is unavailable." }, 404);
  const resolved = path.resolve(imagePath);
  assertInsideWorkspace(resolved);
  const content = await fs.readFile(resolved);
  response.writeHead(200, {
    "content-type": "image/png",
    "cache-control": "public, max-age=3600"
  });
  response.end(content);
}

function readJson(request: Parameters<typeof createServer>[0] extends (req: infer R, res: any) => any ? R : never): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function assertInsideWorkspace(targetPath: string): void {
  const relative = path.relative(rootDir, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to access path outside workspace: ${targetPath}`);
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function toPublicPage(page: LearningPage | undefined): LearningPage | undefined {
  if (!page) return undefined;
  const publicPreview = toPublicPreview(page.preview, page.previewImageUrl);
  return {
    ...page,
    preview: publicPreview,
    previewImagePath: undefined,
    previewImageUrl: publicPreview?.imageUrl
  };
}

function toPublicPreview(preview: SlidePreview | undefined, imageUrl?: string): SlidePreview | undefined {
  if (!preview) return undefined;
  return {
    materialId: preview.materialId,
    pageIndex: preview.pageIndex,
    imageUrl: imageUrl ?? preview.imageUrl,
    width: preview.width,
    height: preview.height,
    format: preview.format,
    status: preview.status,
    error: preview.error,
    generatedAt: preview.generatedAt
  };
}

function toPublicPreviewManifest(material: LearningMaterial): Omit<SlidePreviewManifest, "filePath" | "cacheDir"> | undefined {
  const manifest = previewManifests.get(material.id);
  if (!manifest) return undefined;
  return {
    materialId: manifest.materialId,
    pageCount: manifest.pageCount,
    rendererName: manifest.rendererName,
    status: manifest.status,
    error: manifest.error,
    generatedAt: manifest.generatedAt,
    sourceFileHash: manifest.sourceFileHash,
    previews: material.pages.map((page) => toPublicPreview(page.preview, page.previewImageUrl)!).filter(Boolean)
  };
}

function mockClassSession() {
  return {
    courseId: "demo-course",
    lessonId: "demo-lesson",
    pageId: "demo-page",
    startedAt: new Date().toISOString(),
    students: [
      {
        learnerId: "student-a",
        questions: ["算力和算法有什么区别？", "为什么只有算法不够？"],
        weakConcepts: ["算法与算力的区别"],
        misconceptions: ["把算力理解成算法更聪明"],
        quizResults: []
      },
      {
        learnerId: "student-b",
        questions: ["FLOPS 怎么换算？", "PFLOPS 和 GFLOPS 什么关系？"],
        weakConcepts: ["算力单位换算"],
        misconceptions: ["不清楚 PFLOPS 到 GFLOPS 的倍率"],
        quizResults: []
      },
      {
        learnerId: "student-c",
        questions: ["RAG 为什么能减少幻觉？"],
        weakConcepts: ["RAG 与证据可靠性"],
        misconceptions: ["认为 RAG 可以彻底消除幻觉"],
        quizResults: []
      }
    ]
  };
}
