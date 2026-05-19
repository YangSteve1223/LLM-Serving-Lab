import type { TeacherDashboardReport, TeacherInsightReport } from "./types.ts";

export class TeacherReportGenerator {
  toMarkdown(report: TeacherInsightReport): string {
    return [
      "# 教师洞察报告",
      "",
      "## 共性困惑",
      ...report.commonConfusions.map((item) => `- ${item.concept}: ${item.studentCount} 名学生；例子：${item.examples.join("；") || "暂无"}`),
      "",
      "## 高频问题",
      ...report.highFrequencyQuestions.map((item) => `- ${item.question} (${item.count} 次)`),
      "",
      "## 薄弱概念排行",
      ...report.weakConceptRanking.map((item, index) => `${index + 1}. ${item.concept}: ${item.count}`),
      "",
      "## 建议干预",
      ...report.suggestedInterventions.map((item) => `- ${item.concept}: ${item.suggestion}${item.activity ? `；活动：${item.activity}` : ""}`),
      "",
      "## 下节课调整建议",
      ...report.recommendedNextLessonAdjustments.map((item) => `- ${item}`),
      "",
      `隐私说明：${report.privacyNote}`
    ].join("\n");
  }

  dashboardToMarkdown(report: TeacherDashboardReport): string {
    return [
      `# ${report.lessonTitle} 教师看板报告`,
      "",
      `数据来源：${readableDataSource(report.dataSource)}`,
      `班级：${report.config.className}`,
      `课程：${report.config.courseName}`,
      report.config.teacherName ? `教师：${report.config.teacherName}` : "",
      `班级人数：${report.config.studentCount}`,
      report.pageTitle ? `当前页：${report.pageTitle}` : "",
      "",
      "## 班级概览",
      `- 学生人数：${report.overview.studentCount}`,
      `- 问题数：${report.overview.totalQuestions}`,
      `- 小测次数：${report.overview.totalQuizAttempts}`,
      `- 平均掌握度：${report.overview.averageMastery ?? "暂无"}`,
      `- 高风险概念数：${report.overview.highRiskConceptCount}`,
      "",
      "## 本节课共性问题",
      ...(report.commonConfusions.length
        ? report.commonConfusions.map((item) => `- ${item.concept}：${item.studentCount} 人，严重度 ${item.severity}。建议：${item.suggestedTeacherAction}`)
        : ["- 暂无"]),
      "",
      "## 薄弱概念",
      ...(report.weakConceptRanking.length
        ? report.weakConceptRanking.map((item, index) => `${index + 1}. ${item.concept}：${item.count}`)
        : ["- 暂无"]),
      "",
      "## 建议干预",
      ...report.suggestedMiniLessons.map((item) => `- ${item.title}（${item.durationMinutes} 分钟）：${item.suggestedActivity}`),
      "",
      "## 建议小测题",
      ...report.suggestedQuizQuestions.map((item) => `- [${item.difficulty}] ${item.question}`),
      "",
      "## 推荐资源",
      ...(report.resourceSuggestionsForTeacher.length
        ? report.resourceSuggestionsForTeacher.map((item) => `- ${item.title ?? item.resource.title}: ${item.url ?? item.resource.url}`)
        : ["- 暂无可靠资源推荐"]),
      "",
      "## 建议写入知识库的内容",
      ...(report.knowledgeBaseWritebackSuggestions.length
        ? report.knowledgeBaseWritebackSuggestions.map((item) => `- ${item.title}：${item.reason}（${item.suggestedEntryType}）`)
        : ["- 暂无"]),
      "",
      `隐私说明：${report.privacyNote}`
    ]
      .filter((line) => line !== "")
      .join("\n");
  }
}

function readableDataSource(source: TeacherDashboardReport["dataSource"]): string {
  if (source === "real_learner_memory") return "真实学习记录";
  if (source === "mixed") return "真实学习记录 + Demo 班级数据";
  return "Demo 班级数据";
}
