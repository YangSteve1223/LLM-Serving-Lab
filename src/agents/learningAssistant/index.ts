export { LearningAssistantAgent } from "./LearningAssistantAgent.ts";
export type { LearningAssistantAgentOptions } from "./LearningAssistantAgent.ts";
export { ContextAnalyzer } from "./context/ContextAnalyzer.ts";
export { QuestionAnalyzer, lexicalOverlap } from "./analysis/QuestionAnalyzer.ts";
export { LearningContextBuilder } from "./context/LearningContextBuilder.ts";
export { StudentModeler } from "./learner/StudentModeler.ts";
export { TeachingPolicyPlanner } from "./learner/TeachingPolicyPlanner.ts";
export { PptxMaterialProvider } from "./material/PptxMaterialProvider.ts";
export { MarkdownMaterialProvider } from "./material/MarkdownMaterialProvider.ts";
export { TextMaterialProvider } from "./material/TextMaterialProvider.ts";
export { createMaterialProvider } from "./material/providerFactory.ts";
export { applySlidePreviewManifest, unavailablePreview } from "./material/SlideRenderer.ts";
export type { ApplySlidePreviewOptions, SlideRenderer } from "./material/SlideRenderer.ts";
export { PowerPointComSlideRenderer } from "./material/PowerPointComSlideRenderer.ts";
export type { PowerPointComSlideRendererOptions } from "./material/PowerPointComSlideRenderer.ts";
export { inferOutlineFromDeck, summarizePage } from "./material/inferOutlineFromDeck.ts";
export { pptxToMarkdown, materialToMarkdown, pageToMarkdown } from "./material/pptxToMarkdown.ts";
export type { PptxMarkdownResult } from "./material/pptxToMarkdown.ts";
export { tryConvertPptxToMarkdown } from "./material/PptxMarkdownBridge.ts";
export type { PptxMarkdownBridgeOptions, PptxMarkdownBridgeResult } from "./material/PptxMarkdownBridge.ts";
export { MarkdownKnowledgeBase } from "./kb/MarkdownKnowledgeBase.ts";
export { retrieveChunks, tokenizeForSearch } from "./kb/retrieveChunks.ts";
export { chunkMarkdown } from "./kb/chunkMarkdown.ts";
export { SkillRegistry } from "./skills/SkillRegistry.ts";
export { KnowledgeRetrievalSkill } from "./skills/KnowledgeRetrievalSkill.ts";
export { AnswerReflector } from "./reflection/AnswerReflector.ts";
export { AnswerabilityChecker } from "./grounding/AnswerabilityChecker.ts";
export { EvidenceSelector } from "./grounding/EvidenceSelector.ts";
export { assistantSystemPrompt } from "./prompts/assistantSystemPrompt.ts";
export { buildAnswerPrompt } from "./prompts/answerPrompt.ts";
export { OpenAICompatibleLLMClient } from "./llm/OpenAICompatibleLLMClient.ts";
export type { OpenAICompatibleLLMClientOptions } from "./llm/OpenAICompatibleLLMClient.ts";
export { KimiLLMClient } from "./llm/KimiLLMClient.ts";
export type { KimiLLMClientOptions } from "./llm/KimiLLMClient.ts";
export { createLLMClientFromEnv } from "./llm/createLLMClientFromEnv.ts";
export type { EnvLLMClientResult, EnvLLMConfig, EnvLike } from "./llm/createLLMClientFromEnv.ts";
export * from "./learningLoop/index.ts";
export * from "./resources/index.ts";
export * from "./teacher/index.ts";
export * from "./futureSchool/index.ts";
export * from "./serving/index.ts";
export type {
  AssistantAgentResponse,
  AgentDecisionTrace,
  AnswerabilityResult,
  AnswerStylePreference,
  ChatMessage,
  Citation,
  ContextSummary,
  CurrentPageSummary,
  DetectedIntent,
  EvidenceCandidate,
  GenerationDebugInfo,
  GroundingCheck,
  GroundingMode,
  KnowledgeBase,
  LearningContext,
  LearningMaterial,
  LearningMaterialInput,
  LearningOutline,
  LearningOutlineItem,
  LearningPage,
  LLMClient,
  PagePreview,
  QuestionAnalysis,
  QuestionIntent,
  RetrievalResult,
  RetrievedChunk,
  SelectedEvidence,
  Skill,
  SkillInput,
  SkillOutput,
  SlidePreview,
  SlidePreviewManifest,
  StudentModel,
  TeachingPolicy,
  UsedSkillRecord
} from "./types.ts";
