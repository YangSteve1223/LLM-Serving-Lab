import { existsSync } from "node:fs";
import type { ResourceSearchProvider } from "./ResourceSearchProvider.ts";
import { ResourceVerifier } from "./ResourceVerifier.ts";
import { ResourceLibraryStore } from "../ResourceLibraryStore.ts";
import type { LearningResource, ResourceSearchQuery, ResourceSearchResult, ResourceType } from "../types.ts";

export type ManualResourceProviderOptions = {
  store?: ResourceLibraryStore;
  verifier?: ResourceVerifier;
};

export class ManualResourceProvider implements ResourceSearchProvider {
  readonly name = "teacher-resource-library";
  private readonly store: ResourceLibraryStore;
  private readonly verifier: ResourceVerifier;

  constructor(options: ManualResourceProviderOptions = {}) {
    this.store = options.store ?? new ResourceLibraryStore();
    this.verifier = options.verifier ?? new ResourceVerifier();
  }

  isConfigured(): boolean {
    return existsSync(this.store.getFilePath());
  }

  async search(query: ResourceSearchQuery): Promise<ResourceSearchResult[]> {
    const resources = await this.store.listResources();
    const verified: LearningResource[] = [];
    for (const resource of resources) {
      const item = await this.verifier.verifyLearningResource(resource);
      if (item) verified.push(item);
    }
    return verified
      .filter((resource) => matchesQuery(resource, query))
      .slice(0, query.maxResults)
      .map((resource) => ({
        title: resource.title,
        url: resource.url,
        sourceName: resource.sourceName ?? (resource.platform === "school" ? "教师资源库" : resource.platform),
        type: resource.type ?? typeFromResource(resource),
        snippet: resource.description,
        language: resource.language ?? query.language,
        estimatedDurationMinutes: resource.durationMinutes,
        credibility: resource.credibility ?? (resource.platform === "school" ? "high" : "medium"),
        reason: `教师资源库中与“${query.concept}”相关的资源。`,
        verified: true
      }));
  }
}

function matchesQuery(resource: LearningResource, query: ResourceSearchQuery): boolean {
  const text = `${resource.title} ${resource.description ?? ""} ${resource.concepts.join(" ")}`.toLowerCase();
  const targets = [query.concept, query.currentPageTitle, ...query.confusionPoints].filter(Boolean);
  return targets.some((target) => text.includes(target.toLowerCase()) || target.toLowerCase().includes(resource.concepts[0]?.toLowerCase() ?? ""));
}

function typeFromResource(resource: LearningResource): ResourceType {
  if (resource.platform === "mooc") return "course_page";
  if (resource.platform === "bilibili") return "video";
  if (/paper|arxiv|论文/i.test(`${resource.title} ${resource.description ?? ""}`)) return "paper";
  if (/练习|quiz|exercise/i.test(`${resource.title} ${resource.description ?? ""}`)) return "exercise";
  return "article";
}
