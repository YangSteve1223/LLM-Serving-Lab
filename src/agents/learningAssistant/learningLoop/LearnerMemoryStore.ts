import { promises as fs } from "node:fs";
import path from "node:path";
import type { LearnerMemory, QuizGradingResult, ReviewTask } from "./types.ts";
import { nowIso, uniquePush } from "./learningLoopUtils.ts";
import { MisconceptionDetector } from "./MisconceptionDetector.ts";

export type LearnerMemoryStoreOptions = {
  rootDir?: string;
  dataDir?: string;
};

export class LearnerMemoryStore {
  private readonly rootDir: string;
  private readonly dataDir: string;
  private readonly misconceptionDetector = new MisconceptionDetector();

  constructor(options: LearnerMemoryStoreOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? process.cwd());
    this.dataDir = path.resolve(options.dataDir ?? path.join(this.rootDir, ".data", "learner-memory"));
  }

  async getMemory(learnerId = "demo-learner"): Promise<LearnerMemory> {
    await this.ensureDir();
    const filePath = this.filePathFor(learnerId);
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8")) as LearnerMemory;
    } catch {
      return this.emptyMemory(learnerId);
    }
  }

  async updateMemoryWithQuizResult(learnerId: string, result: QuizGradingResult): Promise<LearnerMemory> {
    const memory = await this.getMemory(learnerId);
    memory.quizHistory = [...memory.quizHistory, sanitizeQuizResult(result)].slice(-100);
    if (result.score === 2) {
      memory.masteredConcepts = uniquePush(memory.masteredConcepts, result.concept);
      memory.weakConcepts = memory.weakConcepts.filter((concept) => concept !== result.concept);
    } else {
      memory.weakConcepts = uniquePush(memory.weakConcepts, result.concept);
    }
    if (result.misconception) {
      const existing = memory.misconceptions.find((item) => item.concept === result.concept && item.description === result.misconception);
      const entry = this.misconceptionDetector.toMemoryEntry(result.concept, result.misconception, redactSecret(result.studentAnswer), existing);
      memory.misconceptions = existing
        ? memory.misconceptions.map((item) => (item === existing ? entry : item))
        : [...memory.misconceptions, entry];
    }
    memory.updatedAt = nowIso();
    await this.saveMemory(memory);
    return memory;
  }

  async addReviewTask(learnerId: string, task: ReviewTask): Promise<LearnerMemory> {
    const memory = await this.getMemory(learnerId);
    if (!memory.reviewTasks.some((item) => item.id === task.id)) memory.reviewTasks.push(task);
    memory.updatedAt = nowIso();
    await this.saveMemory(memory);
    return memory;
  }

  async addReviewTasks(learnerId: string, tasks: ReviewTask[]): Promise<LearnerMemory> {
    let memory = await this.getMemory(learnerId);
    for (const task of tasks) {
      if (!memory.reviewTasks.some((item) => item.id === task.id)) memory.reviewTasks.push(task);
    }
    memory.updatedAt = nowIso();
    await this.saveMemory(memory);
    return memory;
  }

  async clearMemory(learnerId = "demo-learner"): Promise<LearnerMemory> {
    const memory = this.emptyMemory(learnerId);
    await this.saveMemory(memory);
    return memory;
  }

  async exportMemory(learnerId = "demo-learner"): Promise<LearnerMemory> {
    return this.getMemory(learnerId);
  }

  private async saveMemory(memory: LearnerMemory): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(this.filePathFor(memory.learnerId), `${JSON.stringify(memory, null, 2)}\n`, "utf8");
  }

  private emptyMemory(learnerId: string): LearnerMemory {
    return {
      learnerId,
      masteredConcepts: [],
      weakConcepts: [],
      misconceptions: [],
      quizHistory: [],
      reviewTasks: [],
      updatedAt: nowIso()
    };
  }

  private async ensureDir(): Promise<void> {
    this.assertInsideRoot(this.dataDir);
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  private filePathFor(learnerId: string): string {
    const safeId = learnerId.replace(/[^a-z0-9_-]/gi, "_");
    const filePath = path.join(this.dataDir, `${safeId}.json`);
    this.assertInsideRoot(filePath);
    return filePath;
  }

  private assertInsideRoot(targetPath: string): void {
    const relative = path.relative(this.rootDir, path.resolve(targetPath));
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to write learner memory outside workspace: ${targetPath}`);
    }
  }
}

function sanitizeQuizResult(result: QuizGradingResult): QuizGradingResult {
  const redacted = JSON.parse(
    JSON.stringify(result, (key, value) => {
      if (/api.?key/i.test(key)) return "[redacted]";
      if (typeof value === "string") return value.replace(/sk-[A-Za-z0-9]{20,}/g, "[REDACTED_API_KEY]");
      return value;
    })
  ) as QuizGradingResult;
  return redacted;
}

function redactSecret(text: string): string {
  return text.replace(/sk-[A-Za-z0-9]{20,}/g, "[REDACTED_API_KEY]");
}
