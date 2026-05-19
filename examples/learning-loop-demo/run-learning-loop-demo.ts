import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LearnerMemoryStore,
  LearningLoopAgent,
  ResourceLibraryStore,
  ResourceScoutAgent,
  TeacherInsightAgent,
  createMaterialProvider,
  type ChatMessage,
  type LearningContext,
  type LLMClient,
  type LearningMaterial
} from "../../src/agents/learningAssistant/index.ts";

const currentFile = fileURLToPath(import.meta.url);
const demoDir = path.dirname(currentFile);
const rootDir = path.resolve(demoDir, "..", "..");
const outputDir = path.join(demoDir, "output");
const outputFile = path.join(outputDir, "demo-report.md");

const context = await loadDemoContext();
const memoryStore = new LearnerMemoryStore({ rootDir, dataDir: path.join(outputDir, "learner-memory") });
await memoryStore.clearMemory("demo-learner");
const loopAgent = new LearningLoopAgent({ memoryStore, llm: demoQuizLlm() });
const resourceAgent = new ResourceScoutAgent({ resourceStore: new ResourceLibraryStore({ rootDir }), env: {} });
const teacherAgent = new TeacherInsightAgent();

const studentQuestion = "我还是不懂数据、算法、算力区别";
const assistantAnswer = "可以把数据看成原料，算法看成做菜的方法，算力看成厨房设备和火力。只有方法但没有原料和设备，AI 也很难真正训练和推理。";
const loop = await loopAgent.runPostAnswerLoop({
  query: studentQuestion,
  assistantAnswer,
  learningContext: context,
  learnerId: "demo-learner"
});
const quiz =
  loop.microQuiz ??
  await loopAgent.generateMicroQuiz({ learningContext: context, learnerId: "demo-learner", targetConcepts: ["数据", "算法", "算力"], count: 3 });
const studentAnswer = "算力就是算法更聪明。";
const grading = loopAgent.gradeQuizAnswer({
  quizId: quiz.id,
  quizQuestion: quiz.questions.find((item) => item.concept.includes("算力")) ?? quiz.questions[0],
  studentAnswer,
  learningContext: context
});
const reviewTasks = loopAgent.planReview({ gradingResult: grading, learningContext: context });
const updatedMemory = await loopAgent.updateLearnerMemory({ learnerId: "demo-learner", gradingResult: grading, reviewTasks });
const resources = await resourceAgent.recommend({ learningContext: context, learnerMemory: updatedMemory, learnerLevel: "beginner" });
const mockClass = JSON.parse(await fs.readFile(path.join(demoDir, "mock-class-session.json"), "utf8"));
const teacherReport = teacherAgent.generateReport(mockClass);

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(
  outputFile,
  [
    "# Learning Loop Demo Report",
    "",
    `## 学生问题`,
    studentQuestion,
    "",
    "## 助教回答",
    assistantAnswer,
    "",
    "## 诊断结果",
    `- intent: ${loop.diagnosis.intent}`,
    `- mastery: ${loop.diagnosis.masteryEstimate}`,
    `- confusion: ${loop.diagnosis.confusionPoints.join("、") || "暂无"}`,
    `- suggested action: ${loop.suggestedAction}`,
    "",
    "## 小测题目",
    ...quiz.questions.map((item, index) => `${index + 1}. ${item.question}\n   - expected: ${item.expectedAnswer}`),
    "",
    "## 学生作答与批改",
    `- student answer: ${studentAnswer}`,
    `- score: ${grading.score}/2`,
    `- feedback: ${grading.feedback}`,
    `- misconception: ${grading.misconception ?? "none"}`,
    "",
    "## 学习记忆变化",
    `- weak concepts: ${updatedMemory?.weakConcepts.join("、") ?? ""}`,
    `- misconceptions: ${(updatedMemory?.misconceptions ?? []).map((item) => `${item.concept}:${item.count}`).join("、")}`,
    "",
    "## 复习任务",
    ...reviewTasks.map((item) => `- ${item.concept}: ${item.taskType}, due ${item.dueAt}`),
    "",
    "## 推荐资源",
    ...(resources.length
      ? resources.slice(0, 3).map((item) => `- ${item.resource.title}: ${item.matchReason}\n  - check: ${item.afterLearningCheckQuestion ?? item.afterWatchingCheckQuestion}`)
      : ["- 未配置搜索服务或教师资源库，本 demo 不伪造推荐资源。"]),
    "",
    "## 教师洞察",
    teacherAgent.toMarkdown(teacherReport)
  ].join("\n"),
  "utf8"
);

console.log(`Learning loop demo report written to ${outputFile}`);

async function loadDemoContext(): Promise<LearningContext> {
  const pptPath = path.join(rootDir, "测试集", "测试PPT", "test1.pptx");
  try {
    const provider = createMaterialProvider({ type: "pptx", filePath: pptPath });
    const material: LearningMaterial = await provider.load({ type: "pptx", filePath: pptPath, metadata: { workspaceRoot: rootDir } });
    const page =
      material.pages.find((item) => /数据/.test(item.text) && /算法/.test(item.text) && /算力/.test(item.text)) ??
      material.pages[0];
    if (!/数据|算法|算力/.test(page.text)) throw new Error("Demo PPT does not contain the AI three elements page.");
    return {
      material: { id: material.id, type: material.type, title: material.title, pageCount: material.pageCount },
      outline: material.outline,
      currentPage: page,
      teacherScript: {
        source: page.speakerNotes ? "speaker_notes" : "platform",
        text:
          page.speakerNotes ??
          "这一页强调数据、算法和算力不是孤立的。数据提供材料，算法提供方法，算力提供执行能力。"
      },
      learner: { id: "demo-learner", profile: { level: "beginner", language: "zh", stylePreference: "auto" } }
    };
  } catch {
    return {
      material: { id: "mock", type: "pptx", title: "AI 基础", pageCount: 1 },
      currentPage: {
        id: "mock-page-1",
        pageIndex: 1,
        semanticTitle: "人工智能三要素",
        title: "人工智能三要素",
        text: "人工智能三要素：数据是知识来源，算法决定学习和推理方式，算力支撑训练和推理，三者缺一不可。"
      },
      teacherScript: {
        source: "platform",
        text: "这一页强调数据、算法和算力相互支撑。"
      },
      learner: { id: "demo-learner", profile: { level: "beginner", language: "zh", stylePreference: "auto" } }
    };
  }
}

function demoQuizLlm(): LLMClient {
  return {
    providerName: "demo-fixture-llm",
    modelName: "learning-loop-demo",
    async generate(messages: ChatMessage[]): Promise<string> {
      const userPayload = messages.find((message) => message.role === "user")?.content ?? "{}";
      const pageText = readPageText(userPayload);
      const evidenceFor = (concept: string, fallback: string) =>
        pageText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.includes(concept)) ?? fallback;
      return JSON.stringify({
        items: [
          {
            id: "demo-q-data",
            type: "concept_check",
            concept: "数据",
            learningObjective: "理解数据是 AI 的知识来源。",
            question: "为什么说数据是 AI 的“知识来源”？",
            expectedAnswer: "数据提供模型学习的材料，模型能学到什么受到数据内容、规模和质量的限制。",
            scoringRubric: {
              fullCredit: ["说明数据提供学习材料", "说明数据影响模型知识边界或训练效果"],
              partialCredit: ["只说数据重要"],
              commonMistakes: ["认为数据质量不重要", "只说数据越多一定越好"]
            },
            hints: ["找当前页中“数据”附近的句子。"],
            difficulty: "easy",
            sourceEvidence: evidenceFor("数据", "数据是知识来源")
          },
          {
            id: "demo-q-algorithm",
            type: "application",
            concept: "算法",
            learningObjective: "理解算法决定学习和推理方式。",
            question: "如果只有数据但没有合适算法，会缺少什么？",
            expectedAnswer: "会缺少让模型从数据中学习和推理的具体方法，数据无法被有效利用。",
            scoringRubric: {
              fullCredit: ["说明算法决定学习和推理方式", "能区分数据是材料、算法是方法"],
              partialCredit: ["只说算法重要"],
              commonMistakes: ["把算法说成算力"]
            },
            hints: ["用材料和方法的区别来想。"],
            difficulty: "medium",
            sourceEvidence: evidenceFor("算法", "算法决定学习和推理方式")
          },
          {
            id: "demo-q-compute",
            type: "misconception_check",
            concept: "算力",
            learningObjective: "理解算力支撑训练和推理。",
            question: "“算力就是算法更聪明”这句话哪里不对？",
            expectedAnswer: "它混淆了算力和算法。算法决定怎么学习和推理，算力是支撑训练和推理的计算资源。",
            scoringRubric: {
              fullCredit: ["指出混淆算力和算法", "说明算力是计算资源", "说明算法决定怎么学习和推理"],
              partialCredit: ["只说两者不同"],
              commonMistakes: ["算力就是算法更聪明", "把算力理解成算法"]
            },
            hints: ["当前页说算力支撑训练和推理。"],
            difficulty: "medium",
            sourceEvidence: evidenceFor("算力", "算力支撑训练和推理")
          }
        ]
      });
    }
  };
}

function readPageText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { currentPage?: { text?: string } };
    return parsed.currentPage?.text ?? "";
  } catch {
    return "";
  }
}
