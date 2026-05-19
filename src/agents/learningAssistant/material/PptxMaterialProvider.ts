import { promises as fs } from "node:fs";
import path from "node:path";
import { MiniZipReader } from "./miniZip.ts";
import { inferOutlineFromDeck } from "./inferOutlineFromDeck.ts";
import { MarkdownMaterialProvider } from "./MarkdownMaterialProvider.ts";
import { tryConvertPptxToMarkdown } from "./PptxMarkdownBridge.ts";
import { cleanTitleText, isPageLabel, looksLikeSemanticTitle, normalizePageTitle } from "./semanticTitle.ts";
import type { LearningMaterial, LearningMaterialInput, LearningOutline, LearningPage } from "../types.ts";
import type { LearningMaterialProvider } from "./LearningMaterialProvider.ts";

export class PptxMaterialProvider implements LearningMaterialProvider {
  private material?: LearningMaterial;

  async load(input: LearningMaterialInput): Promise<LearningMaterial> {
    if (input.type !== "pptx" && !input.filePath?.toLowerCase().endsWith(".pptx")) {
      throw new Error("PptxMaterialProvider only supports .pptx files");
    }

    const externalMaterial = input.filePath ? await this.tryLoadViaMarkdownBridge(input) : undefined;
    if (externalMaterial) {
      this.material = externalMaterial;
      return externalMaterial;
    }

    const buffer = input.fileBuffer ?? (input.filePath ? await fs.readFile(input.filePath) : undefined);
    if (!buffer) throw new Error("PPTX input requires filePath or fileBuffer");

    const zip = new MiniZipReader(buffer);
    const slidePaths = zip
      .list()
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => slideNumber(a) - slideNumber(b));

    if (slidePaths.length === 0) throw new Error("No slides found in PPTX");

    const title =
      readDocTitle(zip) ??
      (input.filePath ? path.basename(input.filePath, path.extname(input.filePath)) : input.metadata?.title?.toString());
    const materialId = slugify(title ?? "pptx-material");
    const pages = slidePaths.map((slidePath, index) => parseSlide(zip, slidePath, materialId, index + 1));

    this.material = {
      id: materialId,
      type: "pptx",
      title,
      filePath: input.filePath,
      pageCount: pages.length,
      pages,
      outline: inferOutlineFromDeck({ pages }),
      metadata: {
        ...input.metadata,
        parser: "PptxMaterialProvider",
        slidePaths
      }
    };

    return this.material;
  }

  private async tryLoadViaMarkdownBridge(input: LearningMaterialInput): Promise<LearningMaterial | undefined> {
    const filePath = input.filePath;
    if (!filePath) return undefined;

    const conversion = await tryConvertPptxToMarkdown(filePath, {
      workspaceRoot: input.metadata?.workspaceRoot?.toString()
    });
    if (!conversion) return undefined;

    const markdownProvider = new MarkdownMaterialProvider();
    const markdownMaterial = await markdownProvider.load({
      type: "markdown",
      filePath: conversion.markdownPath,
      metadata: {
        ...input.metadata,
        originalFilePath: filePath,
        conversion
      }
    });
    const title = input.metadata?.title?.toString() ?? path.basename(filePath, path.extname(filePath));
    const materialId = slugify(title);
    const pages = markdownMaterial.pages.map((page) => ({
      ...page,
      id: `${materialId}-page-${page.pageIndex}`,
      metadata: {
        ...page.metadata,
        source: "pptx",
        conversionEngine: conversion.engine,
        convertedMarkdownPath: conversion.markdownPath
      }
    }));

    return {
      id: materialId,
      type: "pptx",
      title,
      filePath,
      pageCount: pages.length,
      pages,
      outline: inferOutlineFromDeck({ pages }),
      metadata: {
        ...input.metadata,
        parser: conversion.engine,
        convertedMarkdownPath: conversion.markdownPath,
        conversionOutputDir: conversion.outputDir,
        conversionMetadataPath: conversion.metadataPath,
        conversionSummaryPath: conversion.summaryPath
      }
    };
  }

  async getPage(pageIndex: number): Promise<LearningPage> {
    if (!this.material) throw new Error("No PPTX material has been loaded");
    const page = this.material.pages.find((item) => item.pageIndex === pageIndex);
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

function parseSlide(zip: MiniZipReader, slidePath: string, materialId: string, pageIndex: number): LearningPage {
  const xml = zip.readText(slidePath) ?? "";
  const rawShapes = parseShapes(xml);
  const paragraphs = uniqueNonEmpty(rawShapes.flatMap((shape) => shape.paragraphs ?? []));
  const tables = parseTables(xml);
  const tableTexts = tables.flatMap((table) => table.cells);
  const imageAltTexts = parseImageAltTexts(xml);
  const speakerNotes = parseSpeakerNotes(zip, slidePath);
  const textParts = uniqueNonEmpty([...paragraphs, ...tableTexts]);
  const titleInfo = normalizePageTitle(findTitle(rawShapes, paragraphs, pageIndex), textParts.join("\n"), pageIndex);
  const title = titleInfo.title;
  const bulletPoints = textParts.filter((text) => text !== title).slice(0, 12);

  return {
    id: `${materialId}-page-${pageIndex}`,
    pageIndex,
    pageLabel: titleInfo.pageLabel,
    title,
    semanticTitle: titleInfo.semanticTitle,
    text: textParts.join("\n"),
    bulletPoints,
    tables: tables.map((table, index) => ({ id: `table-${index + 1}`, cells: table.cells })),
    speakerNotes,
    imageAltTexts,
    mediaDescriptions: imageAltTexts.map((alt) => `Image: ${alt}`),
    rawShapes,
    metadata: {
      slidePath,
      parser: "pptx-openxml"
    }
  };
}

type ParsedShape = Record<string, unknown> & {
  paragraphs: string[];
  text?: string;
  placeholder?: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  maxFontSizePt?: number;
};

function parseShapes(xml: string): ParsedShape[] {
  const shapes: ParsedShape[] = [];
  for (const match of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
    const shapeXml = match[0];
    const placeholder = shapeXml.match(/<p:ph\b[^>]*type="([^"]+)"/)?.[1];
    const name = shapeXml.match(/<p:cNvPr\b[^>]*name="([^"]+)"/)?.[1];
    const paragraphs = parseParagraphs(shapeXml);
    if (paragraphs.length > 0) {
      const geometry = parseShapeGeometry(shapeXml);
      shapes.push({
        name: name ? decodeXml(name) : undefined,
        placeholder,
        ...geometry,
        maxFontSizePt: parseMaxFontSize(shapeXml),
        paragraphs,
        text: paragraphs.join("\n")
      });
    }
  }
  return shapes;
}

function parseShapeGeometry(xml: string): Pick<ParsedShape, "x" | "y" | "width" | "height"> {
  const off = xml.match(/<a:off\b[^>]*x="(-?\d+)"[^>]*y="(-?\d+)"/);
  const ext = xml.match(/<a:ext\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  return {
    x: off ? Number(off[1]) : undefined,
    y: off ? Number(off[2]) : undefined,
    width: ext ? Number(ext[1]) : undefined,
    height: ext ? Number(ext[2]) : undefined
  };
}

function parseMaxFontSize(xml: string): number | undefined {
  const sizes = [...xml.matchAll(/<a:rPr\b[^>]*\bsz="(\d+)"/g)]
    .map((match) => Number(match[1]) / 100)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (sizes.length === 0) return undefined;
  return Math.max(...sizes);
}

function parseParagraphs(xml: string): string[] {
  const paragraphs: string[] = [];
  const paragraphMatches = [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)];
  if (paragraphMatches.length === 0) return parseTextRuns(xml);
  for (const paragraphMatch of paragraphMatches) {
    const text = parseTextRuns(paragraphMatch[0]).join("").replace(/\s+/g, " ").trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs;
}

function parseTextRuns(xml: string): string[] {
  return [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
    .map((match) => decodeXml(match[1]).trim())
    .filter(Boolean);
}

function parseTables(xml: string): Array<{ cells: string[] }> {
  const tables: Array<{ cells: string[] }> = [];
  for (const tableMatch of xml.matchAll(/<a:tbl\b[\s\S]*?<\/a:tbl>/g)) {
    const cells = [...tableMatch[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)]
      .map((cellMatch) => parseTextRuns(cellMatch[0]).join("").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (cells.length > 0) tables.push({ cells });
  }
  return tables;
}

function parseImageAltTexts(xml: string): string[] {
  const values: string[] = [];
  for (const match of xml.matchAll(/<p:cNvPr\b[^>]*(?:name|descr)="([^"]+)"[^>]*>/g)) {
    const value = decodeXml(match[1]).trim();
    if (value && !/^Picture\s+\d+$/i.test(value)) values.push(value);
  }
  return uniqueNonEmpty(values);
}

function parseSpeakerNotes(zip: MiniZipReader, slidePath: string): string | undefined {
  const relsPath = slidePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
  const rels = zip.readText(relsPath);
  const target = rels?.match(/Type="[^"]+\/notesSlide"[^>]*Target="([^"]+)"/)?.[1];
  const candidates = [
    target ? normalizeRelativeZipPath(path.posix.dirname(slidePath), target) : undefined,
    `ppt/notesSlides/notesSlide${slideNumber(slidePath)}.xml`
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const notesXml = zip.readText(candidate);
    if (!notesXml) continue;
    const text = uniqueNonEmpty(parseParagraphs(notesXml))
      .filter((paragraph) => !/^\d+$/.test(paragraph))
      .join("\n")
      .trim();
    if (text) return text;
  }
  return undefined;
}

function readDocTitle(zip: MiniZipReader): string | undefined {
  const core = zip.readText("docProps/core.xml");
  return core?.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/)?.[1]
    ? decodeXml(core.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/)?.[1] ?? "").trim()
    : undefined;
}

function findTitle(rawShapes: ParsedShape[], paragraphs: string[], pageIndex: number): string {
  const scored = rawShapes
    .flatMap((shape, shapeIndex) =>
      (shape.paragraphs ?? []).map((paragraph, paragraphIndex) => ({
        text: cleanTitleText(paragraph),
        score: scoreTitleCandidate(shape, shapeIndex, paragraphIndex, rawShapes.length)
      }))
    )
    .filter((candidate) => looksLikeSemanticTitle(candidate.text))
    .sort((a, b) => b.score - a.score);

  if (scored[0]) return scored[0].text;

  const fromParagraphs = paragraphs.map(cleanTitleText).find((paragraph) => looksLikeSemanticTitle(paragraph));
  return fromParagraphs ?? `Page ${pageIndex}`;
}

function scoreTitleCandidate(shape: ParsedShape, shapeIndex: number, paragraphIndex: number, shapeCount: number): number {
  const text = cleanTitleText(shape.paragraphs?.[paragraphIndex] ?? "");
  if (!text || isPageLabel(text)) return -100;

  const placeholder = String(shape.placeholder ?? "");
  const name = String(shape.name ?? "");
  const y = typeof shape.y === "number" ? shape.y : Number.POSITIVE_INFINITY;
  const font = shape.maxFontSizePt ?? 0;
  let score = 0;

  if (["title", "ctrTitle"].includes(placeholder)) score += 100;
  if (placeholder === "subTitle") score += 40;
  if (/title|标题/i.test(name)) score += 14;
  if (y < 900_000) score += 28;
  else if (y < 1_800_000) score += 18;
  else if (y < 2_700_000) score += 8;
  if (font >= 30) score += 24;
  else if (font >= 24) score += 18;
  else if (font >= 18) score += 8;
  if (text.length <= 24) score += 10;
  else if (text.length <= 40) score += 5;
  if (/[：:]/.test(text)) score += 4;
  if (/^[A-Z\s]{4,}$/.test(text) || /university/i.test(text)) score -= 18;
  if (/[。；;.]$/.test(text)) score -= 45;
  if (/是.+[，,。]/.test(text) && text.length > 24) score -= 32;
  if (/<\/?[a-z]+:/i.test(text)) score -= 80;
  score += Math.max(0, shapeCount - shapeIndex) * 0.05;
  score -= paragraphIndex * 2;

  return score;
}

function slideNumber(slidePath: string): number {
  return Number(slidePath.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean)) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function normalizeRelativeZipPath(base: string, target: string): string {
  return path.posix.normalize(path.posix.join(base, target)).replace(/^\/+/, "");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "pptx-material";
}
