import type { ResourceAdapter } from "./ResourceAdapter.ts";
import type { LearningResource } from "../types.ts";

export class BilibiliAdapterStub implements ResourceAdapter {
  readonly name = "bilibili-adapter-stub";

  async listResources(): Promise<LearningResource[]> {
    return [];
  }
}
