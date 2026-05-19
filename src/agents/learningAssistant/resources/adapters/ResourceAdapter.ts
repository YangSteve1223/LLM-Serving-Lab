import type { LearningResource } from "../types.ts";

export interface ResourceAdapter {
  name: string;
  listResources(): Promise<LearningResource[]>;
}
