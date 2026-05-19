import type { ResourceAdapter } from "./ResourceAdapter.ts";
import type { LearningResource } from "../types.ts";

export class MoocAdapterStub implements ResourceAdapter {
  readonly name = "mooc-adapter-stub";

  async listResources(): Promise<LearningResource[]> {
    return [];
  }
}
