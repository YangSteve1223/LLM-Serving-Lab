import type { ResourceSearchProvider } from "./ResourceSearchProvider.ts";
import { ResourceVerifier } from "./ResourceVerifier.ts";
import type { ResourceSearchQuery, ResourceSearchResult, ResourceType } from "../types.ts";

export type SearchApiResourceProviderOptions = {
  env?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
  verifier?: ResourceVerifier;
};

export class SearchApiResourceProvider implements ResourceSearchProvider {
  readonly name = "search-api";
  private readonly env: Record<string, string | undefined>;
  private readonly fetchFn: typeof fetch;
  private readonly verifier: ResourceVerifier;

  constructor(options: SearchApiResourceProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchFn = options.fetchFn ?? fetch;
    this.verifier = options.verifier ?? new ResourceVerifier({ fetchFn: this.fetchFn });
  }

  isConfigured(): boolean {
    return Boolean(this.env.TAVILY_API_KEY || this.env.BING_SEARCH_API_KEY || this.env.SERPAPI_API_KEY);
  }

  async search(query: ResourceSearchQuery): Promise<ResourceSearchResult[]> {
    if (!this.isConfigured()) return [];
    const raw = this.env.TAVILY_API_KEY
      ? await this.searchTavily(query)
      : this.env.BING_SEARCH_API_KEY
        ? await this.searchBing(query)
        : await this.searchSerpApi(query);
    const verified: ResourceSearchResult[] = [];
    for (const result of raw) {
      const item = await this.verifier.verifySearchResult(result);
      if (item?.verified) verified.push(item);
    }
    return verified.slice(0, query.maxResults);
  }

  private async searchTavily(query: ResourceSearchQuery): Promise<ResourceSearchResult[]> {
    const response = await this.fetchFn("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: this.env.TAVILY_API_KEY,
        query: buildQuery(query),
        max_results: query.maxResults,
        search_depth: "basic"
      })
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string; score?: number }> };
    return (data.results ?? []).map((item) => ({
      title: item.title ?? "",
      url: item.url ?? "",
      sourceName: hostName(item.url),
      type: inferType(item.url, item.title),
      snippet: item.content,
      language: query.language,
      credibility: credibilityForUrl(item.url),
      verified: false,
      reason: `搜索结果与“${query.concept}”相关。`
    }));
  }

  private async searchBing(query: ResourceSearchQuery): Promise<ResourceSearchResult[]> {
    const url = new URL("https://api.bing.microsoft.com/v7.0/search");
    url.searchParams.set("q", buildQuery(query));
    url.searchParams.set("count", String(query.maxResults));
    url.searchParams.set("mkt", query.language === "zh" ? "zh-CN" : "en-US");
    const response = await this.fetchFn(url, {
      headers: { "Ocp-Apim-Subscription-Key": this.env.BING_SEARCH_API_KEY ?? "" }
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> } };
    return (data.webPages?.value ?? []).map((item) => ({
      title: item.name ?? "",
      url: item.url ?? "",
      sourceName: hostName(item.url),
      type: inferType(item.url, item.name),
      snippet: item.snippet,
      language: query.language,
      credibility: credibilityForUrl(item.url),
      verified: false,
      reason: `搜索结果与“${query.concept}”相关。`
    }));
  }

  private async searchSerpApi(query: ResourceSearchQuery): Promise<ResourceSearchResult[]> {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", buildQuery(query));
    url.searchParams.set("num", String(query.maxResults));
    url.searchParams.set("api_key", this.env.SERPAPI_API_KEY ?? "");
    const response = await this.fetchFn(url);
    if (!response.ok) return [];
    const data = (await response.json()) as { organic_results?: Array<{ title?: string; link?: string; snippet?: string; source?: string }> };
    return (data.organic_results ?? []).map((item) => ({
      title: item.title ?? "",
      url: item.link ?? "",
      sourceName: item.source ?? hostName(item.link),
      type: inferType(item.link, item.title),
      snippet: item.snippet,
      language: query.language,
      credibility: credibilityForUrl(item.link),
      verified: false,
      reason: `搜索结果与“${query.concept}”相关。`
    }));
  }
}

function buildQuery(query: ResourceSearchQuery): string {
  const typeHint = query.preferredTypes?.length ? ` ${query.preferredTypes.join(" OR ")}` : " 教程 课程 官方 文档 练习";
  return `${query.concept} ${query.currentPageTitle} ${query.confusionPoints.join(" ")}${typeHint}`;
}

function inferType(url = "", title = ""): ResourceType {
  const text = `${url} ${title}`.toLowerCase();
  if (/arxiv|paper|doi|论文/.test(text)) return "paper";
  if (/docs|documentation|官方|manual/.test(text)) return "official_doc";
  if (/course|mooc|lesson|课程/.test(text)) return "course_page";
  if (/youtube|bilibili|video|视频/.test(text)) return "video";
  if (/exercise|quiz|练习|题/.test(text)) return "exercise";
  return "article";
}

function credibilityForUrl(url = ""): "high" | "medium" | "low" {
  if (/\.edu|\.gov|docs\.|developer\.|microsoft\.com|google\.com|openai\.com|moonshot\.cn/i.test(url)) return "high";
  if (/wikipedia|github|arxiv|coursera|edx|mit\.edu|stanford\.edu/i.test(url)) return "medium";
  return "medium";
}

function hostName(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
}
