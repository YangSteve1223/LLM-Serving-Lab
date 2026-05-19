import type { LearningContext, LLMClient } from "../types.ts";
import { LearningActionPlanner } from "./LearningActionPlanner.ts";
import { LearningDiagnosisAgent } from "./LearningDiagnosisAgent.ts";
import { LearnerMemoryStore } from "./LearnerMemoryStore.ts";
import { MicroQuizGenerator } from "./MicroQuizGenerator.ts";
import { QuizGrader } from "./QuizGrader.ts";
import { ReviewPlanner } from "./ReviewPlanner.ts";
import type {
  DiagnosisInput,
  GenerateMicroQuizInput,
  GradeQuizInput,
  LearnerMemory,
  LearningDiagnosis,
  LearningLoopResponse,
  MicroQuiz,
  QuizGradingResult,
  ReviewTask
} from "./types.ts";
import { pageId } from "./learningLoopUtils.ts";

export type LearningLoopAgentOptions = {
  memoryStore?: LearnerMemoryStore;
  llm?: LLMClient;
};

export class LearningLoopAgent {
  readonly diagnosisAgent = new LearningDiagnosisAgent();
  readonly microQuizGenerator: MicroQuizGenerator;
  readonly quizGrader = new QuizGrader();
  readonly reviewPlanner = new ReviewPlanner();
  readonly actionPlanner = new LearningActionPlanner();
  readonly memoryStore?: LearnerMemoryStore;

  constructor(options: LearningLoopAgentOptions = {}) {
    this.memoryStore = options.memoryStore;
    this.microQuizGenerator = new MicroQuizGenerator({ llm: options.llm });
  }

  diagnose(input: DiagnosisInput): LearningDiagnosis {
    return this.diagnosisAgent.diagnose(input);
  }

  async generateMicroQuiz(input: GenerateMicroQuizInput): Promise<MicroQuiz> {
    return this.microQuizGenerator.generate(input);
  }

  gradeQuizAnswer(input: GradeQuizInput): QuizGradingResult {
    return this.quizGrader.grade(input);
  }

  async updateLearnerMemory(input: {
    learnerId: string;
    gradingResult: QuizGradingResult;
    reviewTasks?: ReviewTask[];
  }): Promise<LearnerMemory | undefined> {
    if (!this.memoryStore) return undefined;
    let memory = await this.memoryStore.updateMemoryWithQuizResult(input.learnerId, input.gradingResult);
    if (input.reviewTasks?.length) memory = await this.memoryStore.addReviewTasks(input.learnerId, input.reviewTasks);
    return memory;
  }

  planReview(input: { gradingResult: QuizGradingResult; learningContext: LearningContext }): ReviewTask[] {
    return this.reviewPlanner.planFromQuizResult(input.gradingResult, pageId(input.learningContext));
  }

  async runPostAnswerLoop(input: {
    query: string;
    assistantAnswer?: string;
    learningContext: LearningContext;
    learnerId?: string;
    learnerMemory?: LearnerMemory;
    chatHistory?: Array<{ role: string; content: string }>;
  }): Promise<LearningLoopResponse> {
    const memory =
      input.learnerMemory ?? (this.memoryStore ? await this.memoryStore.getMemory(input.learnerId ?? "demo-learner") : undefined);
    const diagnosis = this.diagnose({
      query: input.query,
      assistantAnswer: input.assistantAnswer,
      learningContext: input.learningContext,
      learnerMemory: memory,
      chatHistory: input.chatHistory
    });
    const suggestedAction = this.actionPlanner.choose(diagnosis);
    const microQuiz =
      suggestedAction === "micro_quiz"
        ? await this.generateMicroQuiz({
            learningContext: input.learningContext,
            learnerMemory: memory,
            learnerId: input.learnerId,
            targetConcepts: diagnosis.confusionPoints.length ? diagnosis.confusionPoints : undefined,
            count: 3
          })
        : undefined;
    return {
      diagnosis,
      suggestedAction,
      microQuiz,
      updatedLearnerMemory: memory,
      teacherSignal: {
        shouldNotifyTeacher: this.actionPlanner.shouldNotifyTeacher(diagnosis),
        reason: diagnosis.possibleMisconceptions[0] ?? (diagnosis.masteryEstimate === "low" ? diagnosis.reason : undefined),
        concept: diagnosis.confusionPoints[0]
      }
    };
  }
}
