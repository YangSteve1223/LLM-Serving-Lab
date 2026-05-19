import { promises as fs } from "node:fs";
import path from "node:path";
import { inferOutlineFromDeck } from "./inferOutlineFromDeck.ts";
import { normalizePageTitle } from "./semanticTitle.ts";
import type { LearningMaterial, LearningMaterialInput, LearningOutline, LearningPage } from "../types.ts";
import type { LearningMaterialProvider } from "./LearningMaterialProvider.ts";

export class MarkdownMaterialProvider implements LearningMaterialProvider {
  private material?: LearningMaterial;

  async load(input: LearningMaterialInput): Promise<LearningMaterial> {
    const raw = input.rawText ?? (input.filePath ? await fs.readFile(input.filePath, "utf8") : "");
    if (!raw.trim()) throw new Error("Markdown material requires rawText or filePath");
    const title = input.metadata?.title?.toString() ?? firstHeading(raw) ?? (input.filePath ? path.basename(input.filePath) : "Markdown material");
    const sections = splitMarkdown(raw);
    const pages = sections.map((section, index) => {
      const pageIndex = section.pageIndex ?? index + 1;
      const titleInfo = normalizePageTitle(section.title, section.text, pageIndex);
      return {
        id: `markdown-page-${index + 1}`,
        pageIndex,
        pageLabel: titleInfo.pageLabel,
        title: titleInfo.title,
        semanticTitle: titleInfo.semanticTitle,
        text: section.text,
        bulletPoints: extractBullets(section.text),
        speakerNotes: extractNamedSection(section.text, "Notes"),
        imageAltTexts: extractImageAltTexts(section.text),
        mediaDescriptions: extractImageAltTexts(section.text).map((alt) => `Image: ${alt}`),
        metadata: { source: "markdown" }
      };
    });

    this.material = {
      id: slugify(title),
      type: "markdown",
      title,
      filePath: input.filePath,
      pageCount: pages.length,
      pages,
      outline: inferOutlineFromDeck({ pages }),
      metadata: input.metadata
    };
    return this.material;
  }

  async getPage(pageIndex: number): Promise<LearningPage> {
    const page = this.material?.pages.find((item) => item.pageIndex === pageIndex);
    if (!page) throw new Error(`Page ${pageIndex} is out of range`);
    return page;
  }

  getPageCount(): number {
    return this.material?.pageCount ?? 0;
  }

  async getOutline(): Promise<LearningOutline> {
    return this.material?.outline ?? { source: "missing", items: [] };
  }
}

function splitMarkdown(raw: string): Array<{ title?: string; text: string; pageIndex?: number }> {
  const slideMatches = [...raw.matchAll(/^##\s+Slide\s+(\d+)(?:\s*:\s*(.*))?$/gim)];
  if (slideMatches.length > 0) {
    return slideMatches.map((match, index) => {
      const start = match.index ?? 0;
      const end = slideMatches[index + 1]?.index ?? raw.length;
      const text = raw.slice(start, end).trim();
      return {
        pageIndex: Number(match[1]),
        title: (match[2] ?? "").trim() || extractNamedSection(text, "Title")?.split(/\r?\n/)[0]?.trim(),
        text
      };
    });
  }

  const matches = [...raw.matchAll(/^#{1,2}\s+(.+)$/gm)];
  if (matches.length === 0) return [{ title: "Document", text: raw.trim() }];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? raw.length;
    return {
      title: match[1].trim(),
      text: raw.slice(start, end).trim()
    };
  });
}

function firstHeading(raw: string): string | undefined {
  return raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function extractBullets(text: string): string[] {
  return [...text.matchAll(/^\s*[-*]\s+(.+)$/gm)].map((match) => match[1].trim());
}

function extractImageAltTexts(text: string): string[] {
  return [...text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function extractNamedSection(text: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^###\\s+${escaped}\\s*$([\\s\\S]*?)(?=\\n###\\s+|\\n##\\s+|$)`, "im");
  const match = text.match(regex);
  return match?.[1]?.trim() || undefined;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "markdown-material";
}
