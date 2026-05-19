import type { LearningContext } from "../types.ts";
import type { ClassSessionData } from "../teacher/types.ts";
import type { LearnerMemory } from "../learningLoop/types.ts";
import type {
  BuildConceptMapInput,
  BuildResourceTasksInput,
  BuildSessionReportInput,
  BuildTeacherAfterClassReportInput,
  ConceptMap,
  LearnerSessionReport,
  LearningLoopProgress,
  LearningResourceTask,
  SuggestWikiWritebackInput,
  TeacherAfterClassReport,
  WikiWritebackSuggestion
} from "./types.ts";

const stageOrder: LearningLoopProgress["completed"] = [
  "page_loaded",
  "answered_question",
  "quiz_generated",
  "quiz_submitted",
  "memory_updated",
  "review_scheduled"
];

export class FutureSchoolAgent {
  buildProgress(input: { stage?: LearningLoopProgress["stage"] } = {}): LearningLoopProgress {
    const stage = input.stage ?? "page_loaded";
    const index = stageOrder.indexOf(stage);
    return {
      stage,
      currentLabel: stageLabel(stage),
      nextAction: nextAction(stage),
      completed: stageOrder.slice(0, Math.max(index + 1, 1))
    };
  }

  buildLearnerSessionReport(input: BuildSessionReportInput): LearnerSessionReport {
    const page = input.learningContext.currentPage;
    const memory = input.learnerMemory;
    const misconceptions = memory.misconceptions.map((item) => item.description);
    const materialTitle = input.learningContext.material?.title ?? input.learningContext.material?.id ?? "当前学习材料";
    const conceptsLearned = unique([
      ...memory.masteredConcepts,
      ...(page?.bulletPoints ?? []),
      ...(page?.semanticTitle ? [page.semanticTitle] : [])
    ]).slice(0, 8);
    const weakConcepts = unique(memory.weakConcepts).slice(0, 8);
    return {
      learnerId: input.learnerId,
      materialTitle,
      pagesStudied: page
        ? [{ pageIndex: page.pageIndex, title: page.semanticTitle ?? page.title ?? `第 ${page.pageIndex} 页` }]
        : [],
      questionsAsked: input.questionsAsked ?? [],
      conceptsLearned,
      weakConcepts,
      misconceptions,
      quizResults: memory.quizHistory.slice(-10),
      reviewTasks: memory.reviewTasks.filter((task) => task.status === "pending").slice(0, 10),
      recommendedResources: input.recommendedResources ?? [],
      summary: buildLearnerSummary(materialTitle, conceptsLearned, weakConcepts, misconceptions)
    };
  }

  buildTeacherAfterClassReport(input: BuildTeacherAfterClassReportInput): TeacherAfterClassReport {
    const session = input.session;
    const weakConceptRanking = rankWeakConcepts(session);
    const commonConfusions = aggregateConfusions(session);
    return {
      lessonId: session.lessonId,
      classSize: session.students.length,
      commonConfusions,
      weakConceptRanking,
      suggestedMiniLesson: weakConceptRanking.slice(0, 3).map((item) => ({
        title: `复讲：${item.concept}`,
        durationMinutes: item.concept.includes("FLOPS") ? 6 : 5,
        reason: `${item.count} 名学生在该概念上出现薄弱或误解。`
      })),
      suggestedQuizQuestions: weakConceptRanking.slice(0, 4).map((item) => ({
        targetConcept: item.concept,
        question: `请用自己的话解释“${item.concept}”，并举一个当前课件中的例子。`
      })),
      nextLessonAdjustment: [
        "下节课开头先用 3-5 分钟复盘最高频薄弱概念。",
        "安排一道概念辨析题，检查学生是否仍存在同类误解。",
        "对已掌握学生提供挑战题，对薄弱学生提供类比和例题。"
      ]
    };
  }

  buildConceptMap(input: BuildConceptMapInput): ConceptMap {
    const context = input.learningContext;
    const memory = input.learnerMemory;
    const page = context.currentPage;
    const title = page?.semanticTitle ?? page?.title ?? "当前页";
    const concepts = unique([title, ...(page?.bulletPoints ?? []), ...extractConcepts(page?.text ?? "")]).slice(0, 8);
    const root = concepts[0] ?? title;
    const nodes = concepts.map((concept) => ({
      id: stableId(concept),
      label: concept,
      status: conceptStatus(concept, memory),
      sourcePageIndexes: page ? [page.pageIndex] : []
    }));
    const edges = nodes
      .slice(1)
      .map((node) => ({ from: stableId(root), to: node.id, relation: "part_of" as const }));
    return { nodes, edges };
  }

  buildResourceTasks(input: BuildResourceTasksInput): LearningResourceTask[] {
    return input.recommendations.slice(0, 5).map((item, index) => ({
      id: stableId(`resource-task-${item.resource.id}-${index}`),
      resourceId: item.resource.id,
      title: item.resource.title,
      url: item.url ?? item.resource.url,
      type: item.type ?? item.resource.type,
      sourceName: item.sourceName ?? item.resource.sourceName ?? item.resource.platform,
      reason: item.matchReason,
      learningGoal: item.learningGoal,
      credibility: item.credibility ?? item.resource.credibility,
      verified: item.verified ?? item.resource.verified,
      suggestedSegment: item.suggestedSegment
        ? { start: item.suggestedSegment.start, end: item.suggestedSegment.end }
        : item.resource.recommendedSegments?.[0]
          ? { start: item.resource.recommendedSegments[0].start, end: item.resource.recommendedSegments[0].end }
          : undefined,
      suggestedFocus: item.suggestedSegment || item.resource.recommendedSegments?.[0]
        ? undefined
        : `重点关注资源中解释“${item.resource.concepts[0] ?? "当前概念"}”与当前页关系的部分。`,
      beforeTaskQuestion: item.beforeLearningQuestion ?? item.beforeWatchingQuestion ?? "开始前先想：这个资源要帮我解决哪个薄弱点？",
      afterTaskQuestion: item.afterLearningCheckQuestion ?? item.afterWatchingCheckQuestion ?? "看完后请用一句话复述你学到的关键点。",
      status: "pending",
      linkedWeakConcept: firstMatchingWeakConcept(item.resource.concepts, input.learnerMemory)
    }));
  }

  suggestWikiWriteback(input: SuggestWikiWritebackInput): WikiWritebackSuggestion {
    const misconception = input.learnerMemory?.misconceptions[0];
    if (misconception) {
      return {
        shouldWriteBack: true,
        reason: "学习记忆中出现了可复用的常见误区，适合沉淀到课程知识库。",
        suggestedEntry: {
          type: "common_confusion",
          title: `${misconception.concept} 常见误区`,
          content: `学生常见误区：${misconception.description}\n建议补充：用一个反例和一个检查题帮助区分。`
        }
      };
    }
    if (input.retrievalStatus === "empty" && input.query) {
      return {
        shouldWriteBack: true,
        reason: "知识库检索为空，但学生问题可能具有教学价值。",
        suggestedEntry: {
          type: "evidence_gap",
          title: `待补充：${input.query}`,
          content: "当前知识库没有找到足够证据。建议教师补充定义、例子和可引用材料。"
        }
      };
    }
    const classConfusion = input.classSession?.students.flatMap((student) => student.misconceptions)[0];
    if (classConfusion) {
      return {
        shouldWriteBack: true,
        reason: "班级层面出现了共性困惑，适合形成知识库改进建议。",
        suggestedEntry: {
          type: "common_confusion",
          title: "班级共性困惑",
          content: classConfusion
        }
      };
    }
    return {
      shouldWriteBack: false,
      reason: "当前没有发现需要写回知识库的高价值缺口。"
    };
  }

  learnerReportToMarkdown(report: LearnerSessionReport): string {
    return [
      `# ${report.materialTitle} 学习报告`,
      "",
      `学习者：${report.learnerId}`,
      "",
      "## 今天学习了",
      ...report.pagesStudied.map((page) => `- 第 ${page.pageIndex} 页：${page.title}`),
      "",
      "## 掌握较好",
      ...(report.conceptsLearned.length ? report.conceptsLearned.map((concept) => `- ${concept}`) : ["- 暂无记录"]),
      "",
      "## 需要复习",
      ...(report.weakConcepts.length ? report.weakConcepts.map((concept) => `- ${concept}`) : ["- 暂无明显薄弱点"]),
      "",
      "## 常见误区",
      ...(report.misconceptions.length ? report.misconceptions.map((item) => `- ${item}`) : ["- 暂无"]),
      "",
      "## 复习任务",
      ...(report.reviewTasks.length ? report.reviewTasks.map((task) => `- ${task.concept}：${task.taskType}`) : ["- 暂无"]),
      "",
      report.summary
    ].join("\n");
  }

  teacherReportToMarkdown(report: TeacherAfterClassReport): string {
    return [
      `# ${report.lessonId} 教师课后洞察`,
      "",
      `班级人数：${report.classSize}`,
      "",
      "## 共性困惑",
      ...(report.commonConfusions.length
        ? report.commonConfusions.map((item) => `- ${item.concept}：${item.count} 人`)
        : ["- 暂无"]),
      "",
      "## 薄弱概念排行",
      ...(report.weakConceptRanking.length
        ? report.weakConceptRanking.map((item) => `- ${item.concept}：${item.count}`)
        : ["- 暂无"]),
      "",
      "## 建议补讲",
      ...report.suggestedMiniLesson.map((item) => `- ${item.title}（${item.durationMinutes} 分钟）：${item.reason}`),
      "",
      "## 下节课调整",
      ...report.nextLessonAdjustment.map((item) => `- ${item}`)
    ].join("\n");
  }
}

function stageLabel(stage: LearningLoopProgress["stage"]): string {
  return {
    page_loaded: "当前页理解",
    answered_question: "已完成问答",
    quiz_generated: "检查理解",
    quiz_submitted: "错因反馈",
    memory_updated: "学习记忆已更新",
    review_scheduled: "复习已安排"
  }[stage];
}

function nextAction(stage: LearningLoopProgress["stage"]): string {
  return {
    page_loaded: "向助教提问或生成本页小测",
    answered_question: "生成小测检查理解",
    quiz_generated: "提交你的答案",
    quiz_submitted: "查看反馈并写入学习记忆",
    memory_updated: "查看复习任务或推荐资源",
    review_scheduled: "按计划复习薄弱概念"
  }[stage];
}

function buildLearnerSummary(materialTitle: string, concepts: string[], weak: string[], misconceptions: string[]): string {
  const learned = concepts[0] ? `你今天围绕《${materialTitle}》学习了 ${concepts.slice(0, 3).join("、")}。` : `你今天学习了《${materialTitle}》。`;
  const weakText = weak.length ? `接下来优先复习 ${weak.slice(0, 3).join("、")}。` : "暂时没有明显薄弱点，可以继续挑战更高难度问题。";
  const misconceptionText = misconceptions.length ? `需要特别注意：${misconceptions[0]}。` : "";
  return [learned, weakText, misconceptionText].filter(Boolean).join(" ");
}

function rankWeakConcepts(session: ClassSessionData) {
  const counts = new Map<string, number>();
  for (const student of session.students) {
    for (const concept of student.weakConcepts) counts.set(concept, (counts.get(concept) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([concept, count]) => ({ concept, count }));
}

function aggregateConfusions(session: ClassSessionData) {
  const map = new Map<string, { count: number; questions: string[] }>();
  for (const student of session.students) {
    for (const confusion of student.misconceptions) {
      const key = normalizeConcept(confusion);
      const entry = map.get(key) ?? { count: 0, questions: [] };
      entry.count += 1;
      entry.questions.push(...student.questions.slice(0, 2));
      map.set(key, entry);
    }
  }
  return [...map.entries()].map(([concept, entry]) => ({
    concept,
    count: entry.count,
    exampleQuestions: unique(entry.questions).slice(0, 3)
  }));
}

function conceptStatus(concept: string, memory?: LearnerMemory): "unknown" | "learning" | "weak" | "mastered" {
  if (!memory) return "learning";
  if (memory.masteredConcepts.some((item) => contains(item, concept) || contains(concept, item))) return "mastered";
  if (memory.weakConcepts.some((item) => contains(item, concept) || contains(concept, item))) return "weak";
  if (memory.misconceptions.some((item) => contains(item.concept, concept) || contains(concept, item.concept))) return "weak";
  return "learning";
}

function extractConcepts(text: string): string[] {
  const matches = text.match(/[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fa5]{2,12}/g) ?? [];
  const noise = new Set(["当前", "本页", "学生", "问题", "可以", "说明", "主要", "学习", "内容"]);
  return unique(matches.filter((item) => !noise.has(item) && !/^\d+$/.test(item))).slice(0, 10);
}

function firstMatchingWeakConcept(concepts: string[], memory?: LearnerMemory): string | undefined {
  return memory?.weakConcepts.find((weak) => concepts.some((concept) => contains(weak, concept) || contains(concept, weak)));
}

function normalizeConcept(text: string): string {
  if (/算力|算法/.test(text)) return "算法与算力";
  if (/数据/.test(text)) return "数据作用";
  if (/FLOPS|PFLOPS|GFLOPS/i.test(text)) return "算力单位换算";
  return text.slice(0, 24);
}

function stableId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function contains(a: string, b: string): boolean {
  return a.includes(b) || b.includes(a);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items.filter(Boolean))];
}
