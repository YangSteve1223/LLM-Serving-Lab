import type { LearningContext } from "../types.ts";
import type { LearnerMemory, QuizGradingResult, ReviewTask } from "../learningLoop/types.ts";
import type { ResourceRecommendation, ResourceType } from "../resources/types.ts";
import type { ClassSessionData } from "../teacher/types.ts";

export type LearningLoopStage =
  | "page_loaded"
  | "answered_question"
  | "quiz_generated"
  | "quiz_submitted"
  | "memory_updated"
  | "review_scheduled";

export interface LearningLoopProgress {
  stage: LearningLoopStage;
  currentLabel: string;
  nextAction: string;
  completed: LearningLoopStage[];
}

export interface LearnerSessionReport {
  learnerId: string;
  materialTitle: string;
  pagesStudied: Array<{
    pageIndex: number;
    title: string;
  }>;
  questionsAsked: string[];
  conceptsLearned: string[];
  weakConcepts: string[];
  misconceptions: string[];
  quizResults: QuizGradingResult[];
  reviewTasks: ReviewTask[];
  recommendedResources: ResourceRecommendation[];
  summary: string;
}

export interface TeacherAfterClassReport {
  lessonId: string;
  classSize: number;
  commonConfusions: Array<{
    concept: string;
    count: number;
    exampleQuestions: string[];
  }>;
  weakConceptRanking: Array<{
    concept: string;
    count: number;
  }>;
  suggestedMiniLesson: Array<{
    title: string;
    durationMinutes: number;
    reason: string;
  }>;
  suggestedQuizQuestions: Array<{
    question: string;
    targetConcept: string;
  }>;
  nextLessonAdjustment: string[];
}

export interface ConceptMap {
  nodes: Array<{
    id: string;
    label: string;
    status: "unknown" | "learning" | "weak" | "mastered";
    sourcePageIndexes: number[];
  }>;
  edges: Array<{
    from: string;
    to: string;
    relation: "prerequisite" | "related" | "part_of" | "contrasts_with";
  }>;
}

export interface LearningResourceTask {
  id: string;
  resourceId: string;
  title: string;
  url?: string;
  type?: ResourceType;
  sourceName?: string;
  reason: string;
  learningGoal?: string;
  credibility?: "high" | "medium" | "low";
  verified?: boolean;
  suggestedSegment?: {
    start: string;
    end: string;
  };
  suggestedFocus?: string;
  beforeTaskQuestion: string;
  afterTaskQuestion: string;
  status: "pending" | "done" | "skipped";
  linkedWeakConcept?: string;
}

export interface WikiWritebackSuggestion {
  shouldWriteBack: boolean;
  reason: string;
  suggestedEntry?: {
    type: "missing_concept" | "weak_explanation" | "common_confusion" | "learning_route" | "evidence_gap";
    title: string;
    content: string;
  };
}

export interface BuildSessionReportInput {
  learnerId: string;
  learningContext: LearningContext;
  learnerMemory: LearnerMemory;
  questionsAsked?: string[];
  recommendedResources?: ResourceRecommendation[];
}

export interface BuildTeacherAfterClassReportInput {
  session: ClassSessionData;
}

export interface BuildConceptMapInput {
  learningContext: LearningContext;
  learnerMemory?: LearnerMemory;
}

export interface BuildResourceTasksInput {
  recommendations: ResourceRecommendation[];
  learnerMemory?: LearnerMemory;
}

export interface SuggestWikiWritebackInput {
  learningContext?: LearningContext;
  learnerMemory?: LearnerMemory;
  classSession?: ClassSessionData;
  retrievalStatus?: "success" | "empty" | "failed" | "skipped";
  query?: string;
}
