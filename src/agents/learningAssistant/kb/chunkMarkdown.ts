import path from "node:path";
import type { RetrievedChunk } from "../types.ts";

export type MarkdownChunkOptions = {
  maxChars?: number;
  overlapChars?: number;
};

export type MarkdownSource = {
  absolutePath: string;
  relativePath: string;
  content: string;
};

type Section = {
  heading?: string;
  level?: number;
  text: string;
  startLine: number;
  endLine: number;
};

export function chunkMarkdown(
  source: MarkdownSource,
  options: MarkdownChunkOptions = {}
): RetrievedChunk[] {
  const maxChars = options.maxChars ?? 1800;
  const overlapChars = options.overlapChars ?? 160;
  const { frontmatter, body } = stripFrontmatter(source.content);
  const title = frontmatter.title ?? firstHeading(body) ?? path.basename(source.relativePath, ".md");
  const sections = splitIntoSections(body);
  const chunks: RetrievedChunk[] = [];

  for (const section of sections) {
    const pieces = splitLongText(section.text, maxChars, overlapChars);
    pieces.forEach((piece, index) => {
      const sectionSlug = slugify(section.heading ?? title);
      chunks.push({
        chunkId: `${source.relativePath.replaceAll("\\", "/")}::${sectionSlug}::${index + 1}`,
        text: piece.trim(),
        score: 0,
        sourceType: "wiki",
        sourceId: source.relativePath.replaceAll("\\", "/"),
        filePath: source.absolutePath,
        fileName: path.basename(source.absolutePath),
        title,
        sectionTitle: section.heading ?? title,
        startLine: section.startLine,
        endLine: section.endLine,
        metadata: {
          relativePath: source.relativePath.replaceAll("\\", "/"),
          frontmatter
        }
      });
    });
  }

  return chunks.filter((chunk) => chunk.text.length > 0);
}

function stripFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  if (!content.startsWith("---")) return { frontmatter: {}, body: content };
  const lines = content.split(/\r?\n/);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end <= 0) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([^:#]+):\s*(.*)$/);
    if (match) frontmatter[match[1].trim()] = match[2].trim();
  }

  return {
    frontmatter,
    body: lines.slice(end + 1).join("\n")
  };
}

function firstHeading(content: string): string | undefined {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function splitIntoSections(content: string): Section[] {
  const lines = content.split(/\r?\n/);
  const sections: Section[] = [];
  let current: Section = { text: "", startLine: 1, endLine: lines.length };

  lines.forEach((line, index) => {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading && current.text.trim()) {
      current.endLine = index;
      sections.push(current);
      current = {
        heading: heading[2].trim(),
        level: heading[1].length,
        text: `${line}\n`,
        startLine: index + 1,
        endLine: index + 1
      };
      return;
    }

    if (heading && !current.text.trim()) {
      current.heading = heading[2].trim();
      current.level = heading[1].length;
      current.startLine = index + 1;
    }

    current.text += `${line}\n`;
    current.endLine = index + 1;
  });

  if (current.text.trim()) sections.push(current);
  return sections;
}

function splitLongText(text: string, maxChars: number, overlapChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + maxChars);
    pieces.push(text.slice(start, end));
    if (end === text.length) break;
    start = Math.max(0, end - overlapChars);
  }
  return pieces;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "section";
}
