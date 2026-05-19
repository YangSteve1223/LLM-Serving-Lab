import type { LearningContext } from "../types.ts";
import type { LearnerMemory, LearningDiagnosis } from "../learningLoop/types.ts";

export type ResourceType =
  | "article"
  | "official_doc"
  | "course_page"
  | "video"
  | "paper"
  | "interactive_demo"
  | "exercise"
  | "book_chapter";

export interface LearningResource {
  id: string;
  title: string;
  platform: "bilibili" | "mooc" | "school" | "local" | "web";
  url: string;
  concepts: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
  type?: ResourceType;
  durationMinutes?: number;
  recommendedSegments?: Array<{
    start: string;
    end: string;
    reason: string;
  }>;
  description?: string;
  qualityTags?: string[];
  sourceName?: string;
  credibility?: "high" | "medium" | "low";
  verified?: boolean;
  language?: "zh" | "en";
}

export interface ResourceRecommendation {
  resource: LearningResource;
  matchScore: number;
  matchReason: string;
  title?: string;
  url?: string;
  type?: ResourceType;
  sourceName?: string;
  learningGoal?: string;
  beforeLearningQuestion?: string;
  afterLearningCheckQuestion?: string;
  credibility?: "high" | "medium" | "low";
  verified?: boolean;
  searchProvider?: string;
  suggestedSegment?: {
    start: string;
    end: string;
    reason: string;
  };
  beforeWatchingQuestion?: string;
  afterWatchingCheckQuestion?: string;
}

export interface ResourceScoutInput {
  learningContext: LearningContext;
  diagnosis?: LearningDiagnosis;
  learnerMemory?: LearnerMemory;
  preferredDurationMinutes?: number;
  learnerLevel?: "beginner" | "intermediate" | "advanced";
  preferredTypes?: ResourceType[];
  language?: "zh" | "en";
  maxResults?: number;
}

export type ResourceSearchQuery = {
  concept: string;
  currentPageTitle: string;
  learnerLevel: "beginner" | "intermediate" | "advanced";
  confusionPoints: string[];
  preferredTypes?: ResourceType[];
  language: "zh" | "en";
  maxResults: number;
};

export type ResourceSearchResult = {
  title: string;
  url: string;
  sourceName?: string;
  type: ResourceType;
  snippet?: string;
  language?: string;
  estimatedDurationMinutes?: number;
  credibility: "high" | "medium" | "low";
  verified: boolean;
  reason?: string;
};

export type ResourceSearchStatus = "web_search" | "teacher_library" | "not_configured" | "empty" | "failed";

export type ResourceRecommendationResponse = {
  status: ResourceSearchStatus;
  providerName?: string;
  message: string;
  recommendations: ResourceRecommendation[];
  debug?: {
    query?: ResourceSearchQuery;
    providerStatuses?: Array<{ name: string; configured: boolean }>;
  };
};
