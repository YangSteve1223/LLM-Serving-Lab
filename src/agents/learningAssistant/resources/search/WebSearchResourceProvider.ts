import type { ResourceSearchProvider } from "./ResourceSearchProvider.ts";
import type { ResourceSearchQuery, ResourceSearchResult } from "../types.ts";

export class WebSearchResourceProvider implements ResourceSearchProvider {
  readonly name = "web-search";

  isConfigured(): boolean {
    return false;
  }

  async search(_query: ResourceSearchQuery): Promise<ResourceSearchResult[]> {
    return [];
  }
}
