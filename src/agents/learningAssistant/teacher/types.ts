import type { QuizGradingResult } from "../learningLoop/types.ts";
import type { ResourceRecommendation } from "../resources/types.ts";

export interface ClassLearnerSnapshot {
  learnerId: string;
  questions: string[];
  weakConcepts: string[];
  misconceptions: string[];
  quizResults: QuizGradingResult[];
}

export interface ClassSessionData {
  courseId: string;
  lessonId: string;
  pageId?: string;
  startedAt: string;
  endedAt?: string;
  students: ClassLearnerSnapshot[];
}

export interface TeacherInsightReport {
  commonConfusions: Array<{
    concept: string;
    studentCount: number;
    examples: string[];
  }>;
  highFrequencyQuestions: Array<{
    question: string;
    count: number;
    relatedConcepts: string[];
  }>;
  weakConceptRanking: Array<{
    concept: string;
    count: number;
  }>;
  suggestedInterventions: Array<{
    concept: string;
    suggestion: string;
    activity?: string;
  }>;
  recommendedNextLessonAdjustments: string[];
  privacyNote: string;
}

export interface TeacherViewConfig {
  className: string;
  courseName: string;
  lessonName: string;
  teacherName?: string;
  studentCount: number;
  dataSource: "demo_mock_class" | "real_learner_memory" | "mixed";
}

export interface TeacherDashboardReport {
  config: TeacherViewConfig;
  dataSource: "real_learner_memory" | "demo_mock_class" | "mixed";
  classSize: number;
  lessonTitle: string;
  pageTitle?: string;
  overview: {
    studentCount: number;
    totalQuestions: number;
    totalQuizAttempts: number;
    averageMastery?: number;
    highRiskConceptCount: number;
  };
  commonConfusions: Array<{
    concept: string;
    studentCount: number;
    severity: "low" | "medium" | "high";
    evidenceExamples: string[];
    suggestedTeacherAction: string;
  }>;
  weakConceptRanking: Array<{
    concept: string;
    count: number;
    relatedPages: string[];
  }>;
  questionClusters: Array<{
    theme: string;
    count: number;
    exampleQuestions: string[];
  }>;
  suggestedMiniLessons: Array<{
    title: string;
    durationMinutes: number;
    targetConcept: string;
    reason: string;
    suggestedActivity: string;
  }>;
  suggestedQuizQuestions: Array<{
    question: string;
    targetConcept: string;
    difficulty: "easy" | "medium" | "hard";
  }>;
  resourceSuggestionsForTeacher: ResourceRecommendation[];
  knowledgeBaseWritebackSuggestions: Array<{
    title: string;
    reason: string;
    suggestedEntryType: "missing_concept" | "weak_explanation" | "common_confusion" | "learning_route" | "evidence_gap";
  }>;
  privacyNote: string;
}
