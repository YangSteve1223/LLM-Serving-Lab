import type { LLMClient } from "../../types.ts";
import type { ResourceSearchProvider } from "./ResourceSearchProvider.ts";
import { ResourceVerifier } from "./ResourceVerifier.ts";
import type { ResourceSearchQuery, ResourceSearchResult } from "../types.ts";

export type LLMWebSearchResourceProviderOptions = {
  llm?: LLMClient;
  supportsWebSearch?: boolean;
  verifier?: ResourceVerifier;
};

export class LLMWebSearchResourceProvider implements ResourceSearchProvider {
  readonly name = "llm-web-search";
  private readonly llm?: LLMClient;
  private readonly supportsWebSearch: boolean;
  private readonly verifier: ResourceVerifier;

  constructor(options: LLMWebSearchResourceProviderOptions = {}) {
    this.llm = options.llm;
    this.supportsWebSearch = Boolean(options.supportsWebSearch);
    this.verifier = options.verifier ?? new ResourceVerifier();
  }

  isConfigured(): boolean {
    return Boolean(this.llm && this.supportsWebSearch);
  }

  async search(query: ResourceSearchQuery): Promise<ResourceSearchResult[]> {
    if (!this.isConfigured() || !this.llm) return [];
    const raw = await this.llm.generate([
      {
        role: "system",
        content: "如果你具备联网搜索能力，请只返回真实可访问 URL 的学习资源 JSON；如果没有联网能力，返回 {\"items\":[]}。不得编造 URL、标题或视频片段。"
      },
      {
        role: "user",
        content: JSON.stringify({
          query,
          schema: {
            items: [
              {
                title: "string",
                url: "https://...",
                sourceName: "string",
                type: "article | official_doc | course_page | video | paper | interactive_demo | exercise | book_chapter",
                snippet: "string",
                credibility: "high | medium | low",
                reason: "string"
              }
            ]
          }
        })
      }
    ]);
    const items = normalizeItems(raw);
    const verified: ResourceSearchResult[] = [];
    for (const item of items) {
      const result = await this.verifier.verifySearchResult(item);
      if (result?.verified) verified.push(result);
    }
    return verified.slice(0, query.maxResults);
  }
}

function normalizeItems(raw: string): ResourceSearchResult[] {
  try {
    const text = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? raw;
    const data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { items?: ResourceSearchResult[] };
    return Array.isArray(data.items) ? data.items.map((item) => ({ ...item, verified: Boolean(item.verified) })) : [];
  } catch {
    return [];
  }
}
