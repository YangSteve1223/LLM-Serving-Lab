/**
 * Shared type surface for the education agent.
 *
 * The serving additions are append-only so existing UI/tests keep working;
 * new fields distinguish actual, estimated, simulated, and unavailable metrics.
 */
export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  timestamp?: string;
};

export type MaterialType = "ppt" | "pptx" | "markdown" | "text" | "unknown";

export type AnswerStylePreference =
  | "auto"
  | "direct"
  | "concise"
  | "step_by_step"
  | "analogy"
  | "socratic"
  | "exam_focused"
  | "deep_dive"
  | "beginner_friendly";

export type LearningMaterialInput = {
  type: MaterialType;
  filePath?: string;
  fileBuffer?: Buffer;
  rawText?: string;
  metadata?: Record<string, unknown>;
};

export type PagePreview = {
  type: "image" | "html" | "text";
  path?: string;
  content?: string;
  metadata?: Record<string, unknown>;
};

export type SlidePreview = {
  materialId: string;
  pageIndex: number;
  imagePath?: string;
  imageUrl?: string;
  width?: number;
  height?: number;
  format: "png" | "jpg" | "svg" | "html" | "unavailable";
  status: "ready" | "rendering" | "failed" | "unavailable";
  error?: string;
  generatedAt?: string;
};

export type SlidePreviewManifest = {
  materialId: string;
  filePath?: string;
  pageCount: number;
  previews: SlidePreview[];
  cacheDir?: string;
  rendererName: string;
  status: "ready" | "partial" | "failed";
  error?: string;
  generatedAt?: string;
  sourceFileHash?: string;
};

export type LearningPage = {
  id: string;
  pageIndex: number;
  pageLabel?: string;
  title?: string;
  semanticTitle?: string;
  text: string;
  bulletPoints?: string[];
  tables?: Array<Record<string, unknown>>;
  speakerNotes?: string;
  imageAltTexts?: string[];
  mediaDescriptions?: string[];
  rawShapes?: Array<Record<string, unknown>>;
  preview?: SlidePreview;
  previewImagePath?: string;
  previewImageUrl?: string;
  metadata?: Record<string, unknown>;
};

export type LearningOutlineItem = {
  id: string;
  title: string;
  summary?: string;
  pageStart?: number;
  pageEnd?: number;
  children?: LearningOutlineItem[];
};

export type LearningOutline = {
  source: "platform" | "inferred_from_deck" | "missing";
  items: LearningOutlineItem[];
};

export type LearningMaterial = {
  id: string;
  type: MaterialType;
  title?: string;
  filePath?: string;
  pageCount: number;
  pages: LearningPage[];
  outline?: LearningOutline;
  metadata?: Record<string, unknown>;
};

export type TeacherScript = {
  source: "platform" | "speaker_notes" | "auto_summary" | "missing";
  text?: string;
  segments?: Array<{
    pageId?: string;
    pageIndex?: number;
    text: string;
    timestamp?: string;
  }>;
};

export type CurrentPageSummary = {
  source: "auto_summary";
  text: string;
};

export type NeighborPageSummary = {
  pageIndex: number;
  title?: string;
  summary?: string;
};

export type LearningContext = {
  material?: {
    id?: string;
    type: MaterialType;
    title?: string;
    filePath?: string;
    pageCount?: number;
    metadata?: Record<string, unknown>;
  };
  outline?: LearningOutline;
  currentPage?: LearningPage;
  neighborPages?: {
    previous?: NeighborPageSummary;
    next?: NeighborPageSummary;
  };
  teacherScript?: TeacherScript;
  currentPageSummary?: CurrentPageSummary;
  learner?: {
    id?: string;
    profile?: {
      level?: "beginner" | "intermediate" | "advanced" | "unknown";
      goals?: string[];
      preferences?: string[];
      weakPoints?: string[];
      language?: "zh" | "en" | "auto";
      stylePreference?: AnswerStylePreference;
      [key: string]: unknown;
    };
    inferredState?: {
      confusionLevel?: "low" | "medium" | "high" | "unknown";
      engagement?: "low" | "medium" | "high" | "unknown";
      likelyIntent?: string;
      [key: string]: unknown;
    };
    progress?: {
      currentPageIndex?: number;
      completedPages?: number[];
      timeOnPageSeconds?: number;
      [key: string]: unknown;
    };
  };
  chatHistory?: Array<{
    role: ChatRole;
    content: string;
    timestamp?: string;
  }>;
  platformMetadata?: Record<string, unknown>;
};

export type DetectedIntent =
  | "ask_current_page"
  | "ask_concept"
  | "ask_beyond_current_page"
  | "ask_exercise"
  | "ask_summary"
  | "ask_unrelated"
  | "unknown";

export type QuestionIntent =
  | "ask_current_page_summary"
  | "ask_current_page_concept"
  | "ask_concept"
  | "ask_comparison"
  | "ask_knowledge_base"
  | "ask_formula_or_derivation"
  | "ask_budget_or_table"
  | "ask_exercise"
  | "ask_unrelated"
  | "unknown";

export type EvidenceNeed =
  | "summary"
  | "concept_explanation"
  | "socratic_guidance"
  | "analogy"
  | "numeric_extraction"
  | "numeric_calculation_from_page"
  | "chart_trend"
  | "ambiguous_reference"
  | "sufficiency_check"
  | "comparison"
  | "knowledge_base_lookup"
  | "exact_formula_or_derivation"
  | "budget_table"
  | "unknown_entity";

export type QuestionAnalysis = {
  normalizedQuestion: string;
  intent: QuestionIntent;
  evidenceNeed: EvidenceNeed;
  keyEntities: string[];
  keyConcepts: string[];
  asksForExactEvidence: boolean;
  asksForFormula: boolean;
  asksForNumbers: boolean;
  asksForBudget: boolean;
  likelyNeedsRetrieval: boolean;
  likelyNeedsGeneralKnowledge: boolean;
  currentPageRelevanceReason: string;
};

export type ContextSummary = {
  detectedIntent: DetectedIntent;
  questionUnderstanding: string;
  hasCurrentPage: boolean;
  currentPageId?: string;
  currentPageTitle?: string;
  currentPageText?: string;
  currentPageKnowledgePoints: string[];
  outlinePath: string[];
  outlineSource: LearningOutline["source"];
  hasTeacherScript: boolean;
  teacherScriptSource: TeacherScript["source"];
  teacherScriptText?: string;
  hasNeighborPages: boolean;
  chatHistoryTurns: number;
  metadataKeys: string[];
  queryReferencesCurrentPage: boolean;
  queryRequestsKnowledgeBase: boolean;
  likelyTopic?: string;
  pageQueryOverlapScore: number;
  usableContextScore: number;
  reasons: string[];
};

export type LearnerLevel = "beginner" | "intermediate" | "advanced" | "unknown";

export type StudentModel = {
  level: LearnerLevel;
  isLikelyStuck: boolean;
  prefersConciseAnswer: boolean;
  stylePreference: AnswerStylePreference;
  needsScaffolding: boolean;
  reasons: string[];
};

export type TeachingPolicy = {
  depth: "brief" | "normal" | "deep";
  style: "direct" | "guided" | "analogy" | "step_by_step" | "socratic" | "exam_focused" | "deep_dive";
  source: "auto" | "user_override" | "mixed";
  shouldUseCurrentPage: boolean;
  shouldUseOutline: boolean;
  shouldUseTeacherScript: boolean;
  shouldUseNeighborPages: boolean;
  shouldRetrieveKnowledge: boolean;
  shouldCallSkill: boolean;
  answerLanguage: "zh" | "en";
  reasons: string[];
};

export type GroundingMode = "course_grounded_only" | "allow_general_knowledge_with_label";

export type AnswerabilityResult = {
  status:
    | "answerable_from_current_page"
    | "answerable_from_context"
    | "answerable_from_retrieval"
    | "answerable_from_general_knowledge"
    | "not_answerable";
  relevance: {
    currentPage: number;
    teacherScript: number;
    outline: number;
    neighborPages: number;
    knowledgeBase: number;
  };
  requiredEvidenceType:
    | "exact_formula"
    | "numerical_derivation"
    | "budget_table"
    | "definition"
    | "summary"
    | "comparison"
    | "example"
    | "general_explanation"
    | "unknown";
  missingEvidence?: string[];
  shouldRefuseToInvent: boolean;
  reason: string;
};

export type EvidenceCandidate = {
  sourceType:
    | "current_page"
    | "outline"
    | "teacher_script"
    | "speaker_notes"
    | "neighbor_page"
    | "knowledge_base"
    | "wiki"
    | "general_knowledge";
  sourceId?: string;
  title?: string;
  pageIndex?: number;
  chunkId?: string;
  sectionTitle?: string;
  text: string;
  relevanceScore?: number;
  metadata?: Record<string, unknown>;
};

export type SelectedEvidence = {
  selected: EvidenceCandidate[];
  rejected: Array<{
    evidence: EvidenceCandidate;
    reason: string;
  }>;
  sufficiency: "sufficient" | "partially_sufficient" | "insufficient";
  reason: string;
};

export type GroundingCheck = {
  passed: boolean;
  reason: string;
  unsupportedClaims?: string[];
};

export type AgentDecisionTrace = {
  questionUnderstanding: string;
  detectedIntent: QuestionIntent;
  keyEntities: string[];
  contextRelevance: {
    currentPage: {
      score: number;
      reason: string;
    };
    teacherScript: {
      score: number;
      reason: string;
    };
    outline: {
      score: number;
      reason: string;
    };
    neighborPages: {
      score: number;
      reason: string;
    };
    knowledgeBase: {
      score?: number;
      reason: string;
    };
  };
  answerability: AnswerabilityResult;
  evidenceSelection: {
    selectedCount: number;
    rejectedCount: number;
    sufficiency: "sufficient" | "partially_sufficient" | "insufficient";
    reason: string;
  };
  policySummary: {
    style: string;
    depth: string;
    source: "auto" | "user_override" | "mixed";
    reason: string;
  };
  retrievalDecision: {
    needed: boolean;
    called: boolean;
    reason: string;
    resultStatus?: "success" | "empty" | "failed";
    topScore?: number;
    threshold?: number;
    evidenceSufficient?: boolean;
  };
  groundingCheck: GroundingCheck;
  answerPlanBrief?: string;
  uncertainty?: string;
};

export type RetrievedChunk = {
  chunkId: string;
  text: string;
  score: number;
  sourceType: "wiki" | "knowledge_base";
  sourceId?: string;
  filePath: string;
  fileName: string;
  title?: string;
  sectionTitle?: string;
  startLine?: number;
  endLine?: number;
  metadata?: Record<string, unknown>;
};

export type RetrievalOptions = {
  topK?: number;
  minScore?: number;
};

export type RetrievalResult = {
  status: "success" | "empty" | "failed";
  query: string;
  rewrittenQuery?: string;
  chunks: RetrievedChunk[];
  rejectedChunks?: Array<{
    chunk: RetrievedChunk;
    reason: string;
  }>;
  topScore?: number;
  relevanceThreshold: number;
  evidenceSufficient: boolean;
};

export type KnowledgeBase = {
  retrieve(query: string, context?: LearningContext, options?: RetrievalOptions): Promise<RetrievedChunk[]>;
  retrieveWithDiagnostics?(
    query: string,
    context?: LearningContext,
    options?: RetrievalOptions
  ): Promise<RetrievalResult>;
};

export type SkillInput = {
  query: string;
  context: LearningContext;
  policy: TeachingPolicy;
  kb?: KnowledgeBase;
};

export type SkillOutput = {
  content?: string;
  evidence?: RetrievedChunk[];
  metadata?: Record<string, unknown>;
  status: "success" | "empty" | "failed";
};

export type Skill = {
  name: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  canHandle?: (input: SkillInput) => boolean | Promise<boolean>;
  run: (input: SkillInput) => Promise<SkillOutput>;
};

export type UsedSkillRecord = {
  name: string;
  status: "called" | "skipped" | "failed";
  reason: string;
  metadata?: Record<string, unknown>;
};

export type Citation = {
  sourceType:
    | "current_page"
    | "outline"
    | "teacher_script"
    | "speaker_notes"
    | "neighbor_page"
    | "wiki"
    | "knowledge_base"
    | "general";
  sourceId?: string;
  title?: string;
  semanticTitle?: string;
  fileName?: string;
  pageIndex?: number;
  chunkId?: string;
  sectionTitle?: string;
  textPreview?: string;
  previewImageUrl?: string;
};

export type GenerationDebugInfo = {
  answerGenerationMode: "real_llm" | "mock_llm" | "template_fallback" | "unavailable";
  providerName?: string;
  modelName?: string;
  usedMock: boolean;
  usedTemplateFallback: boolean;
  llmConfigured: boolean;
  rawLlmCalled: boolean;
  llmFailureReason?: string;
  promptPreview?: string;
  selectedEvidenceCount: number;
  rejectedEvidenceCount: number;
  groundingPassed: boolean;
  groundingFailureReason?: string;
  servingTraceSummary?: {
    estimatedPrefillTokens: number;
    estimatedDecodeTokens: number;
    simulatedTTFTMs?: number;
    simulatedTPOTMs?: number;
    contextBudgetPolicy?: string;
    cacheAwarePrompt?: {
      mode: string;
      applied: boolean;
      stablePrefixTokens: number;
      stablePrefixHash: string;
    };
  };
};

export type AssistantAgentResponse = {
  answer: string;
  decisionTrace: AgentDecisionTrace;
  usedContext: {
    usedCurrentPage: boolean;
    usedOutline: boolean;
    usedTeacherScript: boolean;
    usedNeighborPages: boolean;
    usedLearnerProfile: boolean;
    usedChatHistory: boolean;
  };
  usedSkills: UsedSkillRecord[];
  citations: Citation[];
  teachingPolicy: TeachingPolicy;
  confidence: "low" | "medium" | "high";
  generationDebug: GenerationDebugInfo;
  answerGenerationMode: GenerationDebugInfo["answerGenerationMode"];
  evidenceDebug: {
    selected: EvidenceCandidate[];
    rejected: SelectedEvidence["rejected"];
  };
  retrievalDebug?: RetrievalResult;
  followUps?: string[];
  servingTrace?: import("./serving/ServingTrace.ts").ServingPhaseTrace;
};

export type LLMClient = {
  providerName?: string;
  modelName?: string;
  isMock?: boolean;
  generate: (
    messages: Array<{ role: ChatRole; content: string }>,
    options?: Record<string, unknown>
  ) => Promise<string>;
};
