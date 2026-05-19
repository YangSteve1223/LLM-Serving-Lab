import { SearchApiResourceProvider, type SearchApiResourceProviderOptions } from "./SearchApiResourceProvider.ts";
import type { ResourceSearchProvider } from "./ResourceSearchProvider.ts";
import type { ResourceSearchQuery, ResourceSearchResult } from "../types.ts";

export class TavilyResourceSearchProvider implements ResourceSearchProvider {
  readonly name = "tavily";
  private readonly delegate: SearchApiResourceProvider;

  constructor(options: SearchApiResourceProviderOptions = {}) {
    this.delegate = new SearchApiResourceProvider({
      ...options,
      env: { TAVILY_API_KEY: options.env?.TAVILY_API_KEY }
    });
  }

  isConfigured(): boolean {
    return this.delegate.isConfigured();
  }

  search(query: ResourceSearchQuery): Promise<ResourceSearchResult[]> {
    return this.delegate.search(query);
  }
}
