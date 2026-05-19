import { promises as fs } from "node:fs";
import path from "node:path";
import { chunkMarkdown, type MarkdownChunkOptions } from "./chunkMarkdown.ts";
import { retrieveChunks, retrieveChunksWithDiagnostics } from "./retrieveChunks.ts";
import type { KnowledgeBase, LearningContext, RetrievalResult, RetrievedChunk, RetrievalOptions } from "../types.ts";

export type MarkdownKnowledgeBaseOptions = {
  paths: string[];
  rootDir?: string;
  chunkOptions?: MarkdownChunkOptions;
};

export class MarkdownKnowledgeBase implements KnowledgeBase {
  private chunks: RetrievedChunk[];

  constructor(chunks: RetrievedChunk[]) {
    this.chunks = chunks;
  }

  static async fromPaths(options: MarkdownKnowledgeBaseOptions): Promise<MarkdownKnowledgeBase> {
    const rootDir = path.resolve(options.rootDir ?? process.cwd());
    const files: string[] = [];

    for (const inputPath of options.paths) {
      const resolved = path.resolve(rootDir, inputPath);
      assertInsideRoot(rootDir, resolved);
      const stats = await fs.stat(resolved);
      if (stats.isDirectory()) {
        files.push(...(await walkMarkdownFiles(resolved, rootDir)));
      } else if (stats.isFile() && resolved.toLowerCase().endsWith(".md")) {
        files.push(resolved);
      }
    }

    const chunks: RetrievedChunk[] = [];
    for (const file of files.sort()) {
      const content = await fs.readFile(file, "utf8");
      chunks.push(
        ...chunkMarkdown(
          {
            absolutePath: file,
            relativePath: path.relative(rootDir, file),
            content
          },
          options.chunkOptions
        )
      );
    }

    return new MarkdownKnowledgeBase(chunks);
  }

  retrieve(
    query: string,
    context: LearningContext = {},
    options: RetrievalOptions = {}
  ): Promise<RetrievedChunk[]> {
    return Promise.resolve(retrieveChunks(this.chunks, query, context, options));
  }

  retrieveWithDiagnostics(
    query: string,
    context: LearningContext = {},
    options: RetrievalOptions = {}
  ): Promise<RetrievalResult> {
    return Promise.resolve(retrieveChunksWithDiagnostics(this.chunks, query, context, options));
  }

  getAllChunks(): RetrievedChunk[] {
    return [...this.chunks];
  }
}

async function walkMarkdownFiles(dir: string, rootDir: string): Promise<string[]> {
  assertInsideRoot(rootDir, dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const next = path.join(dir, entry.name);
    assertInsideRoot(rootDir, next);
    if (entry.isDirectory()) files.push(...(await walkMarkdownFiles(next, rootDir)));
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(next);
  }

  return files;
}

function assertInsideRoot(rootDir: string, targetPath: string): void {
  const relative = path.relative(rootDir, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to read outside knowledge base root: ${targetPath}`);
  }
}
