import { promises as fs } from "node:fs";
import path from "node:path";
import type { ClassSessionData } from "./types.ts";

export class ClassSessionStore {
  private readonly rootDir: string;
  private readonly dataDir: string;

  constructor(rootDir = process.cwd(), dataDir = path.join(rootDir, ".data", "class-sessions")) {
    this.rootDir = rootDir;
    this.dataDir = dataDir;
  }

  async save(session: ClassSessionData): Promise<string> {
    const filePath = path.resolve(this.dataDir, `${session.courseId}-${session.lessonId}.json`.replace(/[^a-z0-9_.-]/gi, "_"));
    this.assertInsideRoot(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
    return filePath;
  }

  async load(courseId: string, lessonId: string): Promise<ClassSessionData | undefined> {
    const filePath = path.resolve(this.dataDir, `${courseId}-${lessonId}.json`.replace(/[^a-z0-9_.-]/gi, "_"));
    this.assertInsideRoot(filePath);
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8")) as ClassSessionData;
    } catch {
      return undefined;
    }
  }

  private assertInsideRoot(targetPath: string): void {
    const relative = path.relative(path.resolve(this.rootDir), path.resolve(targetPath));
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to access class session outside workspace: ${targetPath}`);
    }
  }
}
