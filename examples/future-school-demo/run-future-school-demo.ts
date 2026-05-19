import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FutureSchoolAgent,
  LearningDiagnosisAgent,
  MicroQuizGenerator,
  QuizGrader,
  ReviewPlanner,
  TeacherInsightAgent,
  type ChatMessage,
  type LearningContext,
  type LLMClient,
  type QuizGradingResult
} from "../../src/agents/learningAssistant/index.ts";

const currentFile = fileURLToPath(import.meta.url);
const demoDir = path.dirname(currentFile);
const outDir = path.join(demoDir, "output");
const students = JSON.parse(await fs.readFile(path.join(demoDir, "mock-students.json"), "utf8")) as Array<{
  learnerId: string;
  profile: string;
  question: string;
  wrongAnswer: string;
}>;

const context = aiThreeElementsContext();
const diagnosisAgent = new LearningDiagnosisAgent();
const quizGenerator = new MicroQuizGenerator({ llm: demoQuizLlm() });
const grader = new QuizGrader();
const reviewPlanner = new ReviewPlanner();
const teacherAgent = new TeacherInsightAgent();
const futureAgent = new FutureSchoolAgent();

const snapshots: Array<{
  learnerId: string;
  question: string;
  diagnosis: string;
  grading: QuizGradingResult;
  reviewTaskCount: number;
}> = [];

for (const student of students) {
  const diagnosis = diagnosisAgent.diagnose({ query: student.question, learningContext: context });
  const quiz = await quizGenerator.generate({ learningContext: context, learnerId: student.learnerId, count: 3 });
  const targetQuestion =
    quiz.questions.find((question) => /算力|算法/.test(question.concept + question.question)) ?? quiz.questions[0];
  const grading = grader.grade({
    quizQuestion: targetQuestion,
    quizId: quiz.id,
    studentAnswer: student.wrongAnswer,
    learningContext: context
  });
  const reviewTasks = reviewPlanner.planFromQuizResult(grading, context.currentPage?.id ?? "page-1");
  snapshots.push({
    learnerId: student.learnerId,
    question: student.question,
    diagnosis: diagnosis.reason,
    grading,
    reviewTaskCount: reviewTasks.length
  });
}

const classSession = {
  courseId: "future-school-demo",
  lessonId: "ai-three-elements",
  pageId: "page-1",
  startedAt: new Date().toISOString(),
  students: snapshots.map((item) => ({
    learnerId: item.learnerId,
    questions: [item.question],
    weakConcepts: item.grading.score === 2 ? [] : [item.grading.concept],
    misconceptions: item.grading.misconception ? [item.grading.misconception] : [],
    quizResults: [item.grading]
  }))
};

const teacherReport = teacherAgent.generateReport(classSession);
const afterClass = futureAgent.buildTeacherAfterClassReport({ session: classSession });
const writeback = futureAgent.suggestWikiWriteback({ classSession });

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(
  path.join(outDir, "future-school-demo-report.md"),
  [
    "# Future School Demo Report",
    "",
    "## 场景",
    "同一页《人工智能三要素》，模拟 5 名学生的提问、小测、批改、复习和教师洞察。",
    "",
    "说明：本离线 demo 使用本地 fixture LLM 生成结构化小测；正式 UI 中未连接真实模型时不会生成小测。",
    "",
    "## 学生状态",
    ...snapshots.flatMap((item) => [
      `### ${item.learnerId}`,
      `- 问题：${item.question}`,
      `- 诊断：${item.diagnosis}`,
      `- 批改：${item.grading.score}/2，${item.grading.feedback}`,
      `- 下一步：${item.grading.nextAction}`,
      ""
    ]),
    "## 教师洞察",
    teacherAgent.toMarkdown(teacherReport),
    "",
    "## 教师课后报告",
    futureAgent.teacherReportToMarkdown(afterClass),
    "",
    "## 知识库改进建议",
    `- 是否建议写回：${writeback.shouldWriteBack}`,
    `- 原因：${writeback.reason}`,
    writeback.suggestedEntry ? `- 建议条目：${writeback.suggestedEntry.title}` : ""
  ].join("\n"),
  "utf8"
);

console.log(`Future school demo report written to ${path.join(outDir, "future-school-demo-report.md")}`);

function aiThreeElementsContext(): LearningContext {
  return {
    material: { id: "demo-ai", type: "pptx", title: "人工智能基础", pageCount: 1 },
    currentPage: {
      id: "page-1",
      pageIndex: 1,
      semanticTitle: "人工智能三要素",
      title: "人工智能三要素",
      text: [
        "人工智能三要素",
        "数据是 AI 的知识来源，决定模型能从什么材料中学习。",
        "算法是 AI 的智能内核，决定模型如何学习、推理和生成。",
        "算力是 AI 的基础设施，支撑模型训练和推理。",
        "三者缺一不可，需要相互支撑。"
      ].join("\n"),
      bulletPoints: ["数据", "算法", "算力"]
    },
    learner: { id: "demo", profile: { level: "beginner", language: "zh", stylePreference: "auto" } }
  };
}

function demoQuizLlm(): LLMClient {
  return {
    providerName: "demo-fixture-llm",
    modelName: "future-school-demo",
    async generate(_messages: ChatMessage[]): Promise<string> {
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
            hints: ["找当前页中“数据是 AI 的知识来源”这句话。"],
            difficulty: "easy",
            sourceEvidence: "数据是 AI 的知识来源，决定模型能从什么材料中学习。"
          },
          {
            id: "demo-q-algorithm",
            type: "application",
            concept: "算法",
            learningObjective: "理解算法决定模型如何学习、推理和生成。",
            question: "如果只有数据但没有合适算法，会缺少什么？",
            expectedAnswer: "会缺少让模型从数据中学习、推理和生成的具体方法，数据无法被有效利用。",
            scoringRubric: {
              fullCredit: ["说明算法决定如何学习", "能区分数据是材料、算法是方法"],
              partialCredit: ["只说算法重要"],
              commonMistakes: ["把算法说成算力", "认为有数据就能自动学习"]
            },
            hints: ["用“材料”和“方法”的区别来想。"],
            difficulty: "medium",
            sourceEvidence: "算法是 AI 的智能内核，决定模型如何学习、推理和生成。"
          },
          {
            id: "demo-q-compute",
            type: "misconception_check",
            concept: "算力",
            learningObjective: "理解算力支撑模型训练和推理，并区分算力和算法。",
            question: "“算力就是算法更聪明”这句话哪里不对？",
            expectedAnswer: "它混淆了算力和算法。算法决定怎么学习和推理，算力是支撑训练和推理的计算资源。",
            scoringRubric: {
              fullCredit: ["指出混淆算力和算法", "说明算力是计算资源", "说明算法决定怎么学习和推理"],
              partialCredit: ["只说两者不同"],
              commonMistakes: ["算力就是算法更聪明", "把算力理解成算法"]
            },
            hints: ["当前页写的是“算力支撑模型训练和推理”。"],
            difficulty: "medium",
            sourceEvidence: "算力是 AI 的基础设施，支撑模型训练和推理。"
          }
        ]
      });
    }
  };
}
