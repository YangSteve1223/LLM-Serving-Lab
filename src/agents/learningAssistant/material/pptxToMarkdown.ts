import { PptxMaterialProvider } from "./PptxMaterialProvider.ts";
import type { LearningMaterial, LearningMaterialInput, LearningPage } from "../types.ts";

export type PptxMarkdownResult = {
  material: LearningMaterial;
  markdown: string;
};

export async function pptxToMarkdown(input: LearningMaterialInput): Promise<PptxMarkdownResult> {
  const provider = new PptxMaterialProvider();
  const material = await provider.load(input);
  return {
    material,
    markdown: materialToMarkdown(material)
  };
}

export function materialToMarkdown(material: LearningMaterial): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`type: learning_material`);
  lines.push(`material_type: ${material.type}`);
  lines.push(`title: ${yamlString(material.title ?? material.id)}`);
  lines.push(`page_count: ${material.pageCount}`);
  if (material.filePath) lines.push(`source_file: ${yamlString(material.filePath)}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${material.title ?? "Learning Material"}`);
  lines.push("");
  lines.push("## Deck Outline");
  lines.push("");
  for (const item of material.outline?.items ?? []) {
    lines.push(`- ${item.pageStart ?? ""}: ${item.title}`);
  }
  lines.push("");

  for (const page of material.pages) {
    lines.push(pageToMarkdown(page));
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function pageToMarkdown(page: LearningPage): string {
  const lines: string[] = [];
  lines.push(`## Slide ${page.pageIndex}: ${page.title ?? `Page ${page.pageIndex}`}`);
  lines.push("");
  lines.push(`<!-- page_id: ${page.id} -->`);
  lines.push("");
  if (page.text.trim()) {
    lines.push("### Text");
    lines.push("");
    for (const paragraph of splitParagraphs(page.text)) lines.push(paragraph);
    lines.push("");
  }
  if ((page.bulletPoints ?? []).length > 0) {
    lines.push("### Bullet Points");
    lines.push("");
    for (const bullet of page.bulletPoints ?? []) lines.push(`- ${bullet}`);
    lines.push("");
  }
  if (page.speakerNotes?.trim()) {
    lines.push("### Speaker Notes");
    lines.push("");
    lines.push(page.speakerNotes.trim());
    lines.push("");
  }
  if ((page.imageAltTexts ?? []).length > 0) {
    lines.push("### Image Placeholders");
    lines.push("");
    for (const alt of page.imageAltTexts ?? []) lines.push(`- ${alt}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}
