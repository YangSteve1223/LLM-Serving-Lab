import { LearningObjectiveExtractor } from "../learningLoop/LearningObjectiveExtractor.ts";
import { extractConcepts, pageTitle } from "../learningLoop/learningLoopUtils.ts";
import type { ResourceAdapter } from "./adapters/ResourceAdapter.ts";
import { ResourceMatcher } from "./ResourceMatcher.ts";
import { ResourceLibraryStore } from "./ResourceLibraryStore.ts";
import { LLMWebSearchResourceProvider } from "./search/LLMWebSearchResourceProvider.ts";
import { ManualResourceProvider } from "./search/ManualResourceProvider.ts";
import { ResourceRanker } from "./search/ResourceRanker.ts";
import type { ResourceSearchProvider } from "./search/ResourceSearchProvider.ts";
import { SearchApiResourceProvider } from "./search/SearchApiResourceProvider.ts";
import { TavilyResourceSearchProvider } from "./search/TavilyResourceSearchProvider.ts";
import { BingResourceSearchProvider } from "./search/BingResourceSearchProvider.ts";
import { SerpApiResourceSearchProvider } from "./search/SerpApiResourceSearchProvider.ts";
import type { ResourceRecommendation, ResourceRecommendationResponse, ResourceScoutInput, ResourceSearchQuery } from "./types.ts";

export type ResourceScoutAgentOptions = {
  adapters?: ResourceAdapter[];
  providers?: ResourceSearchProvider[];
  resourceStore?: ResourceLibraryStore;
  env?: Record<string, string | undefined>;
};

export class ResourceScoutAgent {
  private readonly adapters?: ResourceAdapter[];
  private readonly matcher = new ResourceMatcher();
  private readonly providers: ResourceSearchProvider[];
  private readonly ranker = new ResourceRanker();
  private readonly objectiveExtractor = new LearningObjectiveExtractor();

  constructor(options: ResourceScoutAgentOptions = {}) {
    this.adapters = options.adapters;
    this.providers =
      options.providers ?? defaultProviders(options);
  }

  async recommend(input: ResourceScoutInput): Promise<ResourceRecommendation[]> {
    return (await this.recommendWithStatus(input)).recommendations;
  }

  async recommendWithStatus(input: ResourceScoutInput): Promise<ResourceRecommendationResponse> {
    if (this.adapters?.length) {
      const resources = (await Promise.all(this.adapters.map((adapter) => adapter.listResources()))).flat();
      const recommendations = this.matcher.match(resources, input).filter((item) => item.verified !== false && !isDemoRecommendation(item));
      return {
        status: recommendations.length ? "teacher_library" : "empty",
        providerName: "legacy-adapter",
        message: recommendations.length ? "使用教师资源库" : "当前没有找到可靠资源。你可以配置搜索 API，或让老师导入资源库。",
        recommendations
      };
    }

    const providerStatuses = this.providers.map((provider) => ({ name: provider.name, configured: provider.isConfigured() }));
    const provider = this.providers.find((item) => item.isConfigured());
    const query = buildSearchQuery(input, this.objectiveExtractor);
    if (!provider) {
      return {
        status: "not_configured",
        message: "当前未配置资源搜索服务，也没有教师导入资源库，无法推荐可靠资源。",
        recommendations: [],
        debug: { query, providerStatuses }
      };
    }

    try {
      const results = await provider.search(query);
      const recommendations = this.ranker.rank(results, query);
      return {
        status: provider.name === "teacher-resource-library" ? "teacher_library" : recommendations.length ? "web_search" : "empty",
        providerName: provider.name,
        message: recommendations.length
          ? provider.name === "teacher-resource-library"
            ? "当前使用本地教师资源库。"
            : "使用联网搜索"
          : "当前没有找到可靠资源。你可以配置搜索 API，或让老师导入资源库。",
        recommendations,
        debug: { query, providerStatuses }
      };
    } catch {
      return {
        status: "failed",
        providerName: provider.name,
        message: "资源搜索失败，未返回任何未验证资源。",
        recommendations: [],
        debug: { query, providerStatuses }
      };
    }
  }
}

function defaultProviders(options: ResourceScoutAgentOptions): ResourceSearchProvider[] {
  const preference = options.env?.RESOURCE_SEARCH_PROVIDER;
  const manual = new ManualResourceProvider({ store: options.resourceStore });
  if (preference === "manual") return [manual];
  if (preference === "tavily") return [new TavilyResourceSearchProvider({ env: options.env }), manual];
  if (preference === "bing") return [new BingResourceSearchProvider({ env: options.env }), manual];
  if (preference === "serpapi") return [new SerpApiResourceSearchProvider({ env: options.env }), manual];
  return [
    new SearchApiResourceProvider({ env: options.env }),
    manual,
    new LLMWebSearchResourceProvider()
  ];
}

function buildSearchQuery(input: ResourceScoutInput, extractor: LearningObjectiveExtractor): ResourceSearchQuery {
  const objectives = extractor.extract({ learningContext: input.learningContext, count: 3 });
  const concept =
    input.diagnosis?.confusionPoints?.[0] ??
    input.learnerMemory?.weakConcepts?.[0] ??
    objectives[0]?.concept ??
    extractConcepts(input.learningContext, 1)[0] ??
    pageTitle(input.learningContext);
  const level = input.learnerLevel ?? input.learningContext.learner?.profile?.level;
  return {
    concept,
    currentPageTitle: pageTitle(input.learningContext),
    learnerLevel: level === "advanced" || level === "intermediate" || level === "beginner" ? level : "beginner",
    confusionPoints: [
      ...(input.diagnosis?.confusionPoints ?? []),
      ...(input.learnerMemory?.weakConcepts ?? []),
      ...(input.learnerMemory?.misconceptions.map((item) => item.description) ?? [])
    ].slice(0, 5),
    preferredTypes: input.preferredTypes,
    language: input.language ?? (input.learningContext.learner?.profile?.language === "en" ? "en" : "zh"),
    maxResults: input.maxResults ?? 5
  };
}

function isDemoRecommendation(item: ResourceRecommendation): boolean {
  const text = `${item.resource.title} ${item.resource.url} ${(item.resource.qualityTags ?? []).join(" ")}`.toLowerCase();
  return /demo|example\.edu|placeholder|占位/.test(text);
}
