import assert from "node:assert/strict";
import test from "node:test";
import {
  LearningAssistantAgent,
  LearningContextBuilder,
  QuestionAnalyzer,
  type LearningMaterial
} from "../../src/agents/learningAssistant/index.ts";

test("agent uses platform outline, teacher script, learner state, history, and metadata when they support the question", async () => {
  const material = buildMiniMaterial();
  const context = new LearningContextBuilder().build({
    material,
    pageIndex: 2,
    platformOutline: {
      source: "platform",
      items: [
        {
          id: "chapter-rag",
          title: "检索增强学习问答",
          pageStart: 1,
          pageEnd: 3,
          children: [{ id: "page-evidence", title: "证据驱动的回答链路", pageStart: 2, pageEnd: 2 }]
        }
      ]
    },
    platformTeacherScript: {
      source: "platform",
      text: "本页重点是先理解学生问题，再检索材料证据，最后把当前页上下文和证据合并成回答。"
    },
    learner: {
      id: "learner-context",
      profile: { level: "beginner", goals: ["理解 RAG 的平台用途"], language: "zh" },
      inferredState: { confusionLevel: "medium", likelyIntent: "needs the main thread" },
      progress: { currentPageIndex: 2, completedPages: [1] }
    },
    chatHistory: [
      { role: "user", content: "为什么普通模型回答容易没有依据？" },
      { role: "assistant", content: "可以先把它理解为缺少外部证据时的猜测。" }
    ],
    platformMetadata: { classroomId: "class-a", contentSource: "platform-mock" }
  });

  const response = await new LearningAssistantAgent().answer("这页的证据驱动回答链路要抓住什么？", context);

  assert.equal(response.usedContext.usedCurrentPage, true);
  assert.equal(response.usedContext.usedOutline, true);
  assert.equal(response.usedContext.usedTeacherScript, true);
  assert.equal(response.usedContext.usedLearnerProfile, true);
  assert.equal(response.usedContext.usedChatHistory, true);
  assert.equal(response.decisionTrace.contextRelevance.currentPage.score > 0, true);
  assert.equal(response.decisionTrace.contextRelevance.teacherScript.score > 0, true);
  assert.ok(response.citations.some((citation) => citation.sourceType === "current_page"));
  assert.ok(response.citations.some((citation) => citation.sourceType === "outline" || citation.sourceType === "teacher_script"));
});

test("context builder keeps auto summary separate from teacher script", () => {
  const context = new LearningContextBuilder().build({
    material: buildMiniMaterial(),
    pageIndex: 1
  });

  assert.equal(context.outline?.source, "inferred_from_deck");
  assert.equal(context.currentPage?.pageIndex, 1);
  assert.equal(context.teacherScript?.source, "missing");
  assert.equal(context.currentPageSummary?.source, "auto_summary");
  assert.ok(context.neighborPages?.next);
});

test("speaker notes are exposed as teacher script when platform script is absent", () => {
  const material = buildMiniMaterial();
  material.pages[1] = {
    ...material.pages[1],
    speakerNotes: "讲解时强调证据链，而不是只给结论。"
  };

  const context = new LearningContextBuilder().build({ material, pageIndex: 2 });

  assert.equal(context.teacherScript?.source, "speaker_notes");
  assert.match(context.teacherScript?.text ?? "", /证据链/);
});

test("question analyzer identifies exact-evidence and knowledge-base questions", () => {
  const analyzer = new QuestionAnalyzer();
  const exact = analyzer.analyze("请给出 AlphaBetaZeta-927 的具体公式、数值推导和预算表。", {});
  const kb = analyzer.analyze("这个概念在知识库里有没有更完整解释？", {});

  assert.equal(exact.asksForExactEvidence, true);
  assert.equal(exact.asksForFormula, true);
  assert.equal(exact.asksForBudget, true);
  assert.ok(exact.keyEntities.includes("AlphaBetaZeta-927"));
  assert.equal(kb.intent, "ask_knowledge_base");
  assert.equal(kb.likelyNeedsRetrieval, true);
});

function buildMiniMaterial(): LearningMaterial {
  return {
    id: "mini-rag-material",
    type: "markdown",
    title: "学习平台问答链路",
    pageCount: 3,
    pages: [
      {
        id: "mini-page-1",
        pageIndex: 1,
        title: "问题输入",
        text: "学生提出自由问题，平台需要保留当前学习位置。"
      },
      {
        id: "mini-page-2",
        pageIndex: 2,
        title: "证据驱动的回答链路",
        text: "学习助教先分析学生问题，再使用当前页、大纲、讲稿和知识库证据组织回答。",
        bulletPoints: ["分析问题", "结合当前页", "检索知识库", "返回引用"]
      },
      {
        id: "mini-page-3",
        pageIndex: 3,
        title: "结构化返回",
        text: "回答需要包含 citations、usedSkills、decisionTrace 和 confidence。"
      }
    ],
    outline: {
      source: "inferred_from_deck",
      items: [
        { id: "mini-page-1", title: "问题输入", pageStart: 1, pageEnd: 1 },
        { id: "mini-page-2", title: "证据驱动的回答链路", pageStart: 2, pageEnd: 2 },
        { id: "mini-page-3", title: "结构化返回", pageStart: 3, pageEnd: 3 }
      ]
    }
  };
}
