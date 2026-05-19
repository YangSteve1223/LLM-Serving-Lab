import type { ResourceSearchQuery, ResourceSearchResult } from "../types.ts";

export interface ResourceSearchProvider {
  name: string;
  isConfigured(): boolean;
  search(query: ResourceSearchQuery): Promise<ResourceSearchResult[]>;
}
