import type { ResourceAdapter } from "./ResourceAdapter.ts";
import { ResourceLibraryStore } from "../ResourceLibraryStore.ts";
import type { LearningResource } from "../types.ts";

export class LocalResourceAdapter implements ResourceAdapter {
  readonly name = "local-resource-library";
  private readonly store: ResourceLibraryStore;

  constructor(store = new ResourceLibraryStore()) {
    this.store = store;
  }

  listResources(): Promise<LearningResource[]> {
    return this.store.listResources();
  }
}
