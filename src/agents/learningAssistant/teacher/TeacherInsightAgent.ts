import { MisconceptionAggregator } from "./MisconceptionAggregator.ts";
import { QuestionClusterer } from "./QuestionClusterer.ts";
import { TeacherReportGenerator } from "./TeacherReportGenerator.ts";
import type { ClassSessionData, TeacherDashboardReport, TeacherInsightReport, TeacherViewConfig } from "./types.ts";
import type { ResourceRecommendation } from "../resources/types.ts";

export class TeacherInsightAgent {
  private readonly questionClusterer = new QuestionClusterer();
  private readonly misconceptionAggregator = new MisconceptionAggregator();
  readonly reportGenerator = new TeacherReportGenerator();

  generateReport(session: ClassSessionData): TeacherInsightReport {
    const commonConfusions = this.misconceptionAggregator.aggregateCommonConfusions(session);
    const weakConceptRanking = this.misconceptionAggregator.rankWeakConcepts(session);
    const highFrequencyQuestions = this.questionClusterer.cluster(session);
    const suggestedInterventions = weakConceptRanking.slice(0, 5).map((item) => ({
      concept: item.concept,
      suggestion: `下节课用 3-5 分钟复讲“${item.concept}”，并安排一道即时检查题。`,
      activity: item.concept.includes("FLOPS") ? "单位换算快问快答" : "同伴互讲 + 一题小测"
    }));
    return {
      commonConfusions,
      highFrequencyQuestions,
      weakConceptRanking,
      suggestedInterventions,
      recommendedNextLessonAdjustments: [
        "用班级高频问题作为下节课导入。",
        "对排名靠前的薄弱概念增加 1 道小测和 1 个反例。",
        "只展示聚合后的趋势，不暴露单个学生隐私。"
      ],
      privacyNote: "本报告只汇总班级层面的共性问题，不展示可识别的个人隐私信息。"
    };
  }

  toMarkdown(report: TeacherInsightReport): string {
    return this.reportGenerator.toMarkdown(report);
  }

  generateDashboardReport(input: {
    session: ClassSessionData;
    dataSource?: TeacherDashboardReport["dataSource"];
    lessonTitle?: string;
    pageTitle?: string;
    config?: Partial<TeacherViewConfig>;
    resourceSuggestionsForTeacher?: ResourceRecommendation[];
  }): TeacherDashboardReport {
    const session = input.session;
    const weakRanking = this.misconceptionAggregator.rankWeakConcepts(session);
    const common = this.misconceptionAggregator.aggregateCommonConfusions(session);
    const clusters = this.questionClusterer.cluster(session);
    const totalQuizAttempts = session.students.reduce((sum, student) => sum + student.quizResults.length, 0);
    const quizScores = session.students.flatMap((student) => student.quizResults.map((result) => result.score));
    const averageMastery = quizScores.length ? Number((quizScores.reduce((sum, score) => sum + score, 0) / (quizScores.length * 2)).toFixed(2)) : undefined;
    const config: TeacherViewConfig = {
      className: input.config?.className ?? "Demo 班级",
      courseName: input.config?.courseName ?? session.courseId,
      lessonName: input.config?.lessonName ?? input.lessonTitle ?? session.lessonId,
      teacherName: input.config?.teacherName,
      studentCount: input.config?.studentCount ?? session.students.length,
      dataSource: input.config?.dataSource ?? input.dataSource ?? "demo_mock_class"
    };
    return {
      config,
      dataSource: config.dataSource,
      classSize: config.studentCount,
      lessonTitle: config.lessonName,
      pageTitle: input.pageTitle,
      overview: {
        studentCount: config.studentCount,
        totalQuestions: session.students.reduce((sum, student) => sum + student.questions.length, 0),
        totalQuizAttempts,
        averageMastery,
        highRiskConceptCount: weakRanking.filter((item) => item.count >= Math.max(2, Math.ceil(session.students.length * 0.25))).length
      },
      commonConfusions: common.map((item) => ({
        concept: item.concept,
        studentCount: item.studentCount,
        severity: severity(item.studentCount, session.students.length),
        evidenceExamples: item.examples.slice(0, 3),
        suggestedTeacherAction: `用 3-5 分钟重讲“${item.concept}”，先给反例，再让学生用自己的话区分相近概念。`
      })),
      weakConceptRanking: weakRanking.map((item) => ({
        concept: item.concept,
        count: item.count,
        relatedPages: session.pageId ? [session.pageId] : []
      })),
      questionClusters: clusters.map((item) => ({
        theme: item.relatedConcepts[0] ?? item.question,
        count: item.count,
        exampleQuestions: [item.question]
      })),
      suggestedMiniLessons: weakRanking.slice(0, 3).map((item) => ({
        title: `5 分钟补讲：${item.concept}`,
        durationMinutes: item.concept.includes("FLOPS") ? 6 : 5,
        targetConcept: item.concept,
        reason: `${item.count} 名学生在该概念上出现薄弱或误区。`,
        suggestedActivity: item.concept.includes("算力") || item.concept.includes("算法")
          ? "让学生用“怎么做 / 做不做得动”两列卡片完成分类。"
          : "先展示当前页证据，再让学生写一句解释和一个反例。"
      })),
      suggestedQuizQuestions: weakRanking.slice(0, 4).map((item) => ({
        question: `请用当前页证据解释“${item.concept}”，并说出一个常见误区。`,
        targetConcept: item.concept,
        difficulty: item.count >= 2 ? "medium" : "easy"
      })),
      resourceSuggestionsForTeacher: input.resourceSuggestionsForTeacher ?? [],
      knowledgeBaseWritebackSuggestions: common.slice(0, 3).map((item) => ({
        title: `${item.concept}：常见困惑补充`,
        reason: `${item.studentCount} 名学生在该概念上出现相近困惑，适合沉淀为知识库补充条目。`,
        suggestedEntryType: "common_confusion"
      })),
      privacyNote: "本看板只展示班级层面的匿名统计与代表性问题，不展示真实学生姓名或可识别个人信息。"
    };
  }

  dashboardToMarkdown(report: TeacherDashboardReport): string {
    return this.reportGenerator.dashboardToMarkdown(report);
  }
}

function severity(count: number, classSize: number): "low" | "medium" | "high" {
  if (count >= Math.max(3, Math.ceil(classSize * 0.4))) return "high";
  if (count >= 2) return "medium";
  return "low";
}
