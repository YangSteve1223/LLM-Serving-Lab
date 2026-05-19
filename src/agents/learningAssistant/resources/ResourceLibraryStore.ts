import { promises as fs } from "node:fs";
import path from "node:path";
import type { LearningResource } from "./types.ts";

export type ResourceLibraryStoreOptions = {
  rootDir?: string;
  filePath?: string;
};

export class ResourceLibraryStore {
  private readonly rootDir: string;
  private readonly filePath: string;

  constructor(options: ResourceLibraryStoreOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? process.cwd());
    this.filePath = path.resolve(options.filePath ?? path.join(this.rootDir, ".data", "resource-library", "resources.json"));
  }

  async listResources(): Promise<LearningResource[]> {
    this.assertInsideRoot(this.filePath);
    try {
      return JSON.parse(await fs.readFile(this.filePath, "utf8")) as LearningResource[];
    } catch {
      return [];
    }
  }

  getFilePath(): string {
    this.assertInsideRoot(this.filePath);
    return this.filePath;
  }

  async saveResources(resources: LearningResource[]): Promise<void> {
    this.assertInsideRoot(this.filePath);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(resources, null, 2)}\n`, "utf8");
  }

  private assertInsideRoot(targetPath: string): void {
    const relative = path.relative(this.rootDir, path.resolve(targetPath));
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to access resource library outside workspace: ${targetPath}`);
    }
  }
}
