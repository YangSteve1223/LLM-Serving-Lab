import type { LearningContext, LLMClient } from "../types.ts";

export type LearningIntent =
  | "summary"
  | "concept_confusion"
  | "example_needed"
  | "calculation_needed"
  | "misconception"
  | "review"
  | "extension"
  | "quiz_request"
  | "resource_request"
  | "unknown";

export type MasteryEstimate = "unknown" | "low" | "medium" | "high";

export type LearningIntervention =
  | "explain"
  | "analogy"
  | "socratic_question"
  | "worked_example"
  | "micro_quiz"
  | "resource_recommendation"
  | "review_plan"
  | "teacher_alert";

export interface LearningDiagnosis {
  intent: LearningIntent;
  masteryEstimate: MasteryEstimate;
  confusionPoints: string[];
  prerequisiteGaps: string[];
  possibleMisconceptions: string[];
  recommendedIntervention: LearningIntervention;
  reason: string;
  evidenceRefs?: Array<{
    sourceType: "current_page" | "teacher_script" | "deck_context" | "knowledge_base" | "chat_history" | "learner_memory";
    sourceId?: string;
    textPreview?: string;
  }>;
}

export interface MicroQuizQuestion {
  id: string;
  type: QuizQuestionType;
  concept: string;
  learningObjective: string;
  question: string;
  expectedAnswer: string;
  scoringRubric: QuizScoringRubric;
  hints: string[];
  difficulty: "easy" | "medium" | "hard";
  sourcePageId?: string;
  sourceEvidence: string;
}

export interface MicroQuiz {
  id: string;
  learnerId?: string;
  pageId: string;
  pageTitle: string;
  concepts: string[];
  questions: MicroQuizQuestion[];
  generatedAt: string;
  quality?: QuizQualityResult;
  learningObjectives?: LearningObjective[];
  generationMode?: "real_llm" | "unavailable";
}

export interface QuizScoringRubric {
  fullCredit: string[];
  partialCredit: string[];
  commonMistakes: string[];
}

export interface LearningObjective {
  concept: string;
  objective: string;
  evidence: string;
  difficulty: "easy" | "medium" | "hard";
  questionTypes: QuizQuestionType[];
}

export interface GeneratedQuizItem {
  id: string;
  type: QuizQuestionType;
  concept: string;
  learningObjective: string;
  question: string;
  expectedAnswer: string;
  scoringRubric: QuizScoringRubric;
  hints: string[];
  difficulty: "easy" | "medium" | "hard";
  sourceEvidence: string;
}

export interface QuizQualityResult {
  passed: boolean;
  score: number;
  issues: string[];
  needsRegeneration: boolean;
}

export type QuizQuestionType =
  | "recall"
  | "concept_check"
  | "application"
  | "calculation"
  | "misconception_check"
  | "boundary_judgment"
  | "explain_back"
  | "chart_reading";

export interface QuizGradingResult {
  quizId: string;
  questionId: string;
  concept: string;
  studentAnswer: string;
  score: 0 | 1 | 2;
  mastery: "not_understood" | "partial" | "understood";
  feedback: string;
  misconception?: string;
  matchedRubricItems: string[];
  missingRubricItems: string[];
  nextAction: "explain_again" | "give_example" | "ask_followup" | "move_on" | "recommend_resource" | "schedule_review";
  evidenceUsed?: Array<{
    sourceType: "current_page" | "teacher_script" | "deck_context" | "knowledge_base";
    textPreview: string;
  }>;
}

export interface LearnerMisconception {
  concept: string;
  description: string;
  firstSeenAt: string;
  lastSeenAt: string;
  count: number;
  examples: string[];
}

export interface ReviewTask {
  id: string;
  concept: string;
  reason: "new" | "weak" | "wrong_answer" | "important" | "misconception";
  dueAt: string;
  taskType: "recall" | "quiz" | "explain_back" | "application";
  sourcePageId?: string;
  status: "pending" | "done" | "skipped";
}

export interface LearnerMemory {
  learnerId: string;
  masteredConcepts: string[];
  weakConcepts: string[];
  misconceptions: LearnerMisconception[];
  preferredExplanationStyle?: string;
  quizHistory: QuizGradingResult[];
  reviewTasks: ReviewTask[];
  updatedAt: string;
}

export interface LearningLoopResponse {
  diagnosis: LearningDiagnosis;
  suggestedAction: LearningIntervention;
  microQuiz?: MicroQuiz;
  gradingResult?: QuizGradingResult;
  updatedLearnerMemory?: LearnerMemory;
  reviewTasks?: ReviewTask[];
  teacherSignal?: {
    shouldNotifyTeacher: boolean;
    reason?: string;
    concept?: string;
  };
}

export interface DiagnosisInput {
  query: string;
  assistantAnswer?: string;
  learningContext: LearningContext;
  learnerMemory?: LearnerMemory;
  chatHistory?: Array<{ role: string; content: string }>;
}

export interface GenerateMicroQuizInput {
  learningContext: LearningContext;
  learnerMemory?: LearnerMemory;
  targetConcepts?: string[];
  difficulty?: "easy" | "medium" | "hard";
  count?: number;
  learnerId?: string;
  llm?: LLMClient;
}

export interface GradeQuizInput {
  quizQuestion: MicroQuizQuestion;
  quizId?: string;
  studentAnswer: string;
  learningContext: LearningContext;
  learnerMemory?: LearnerMemory;
}
