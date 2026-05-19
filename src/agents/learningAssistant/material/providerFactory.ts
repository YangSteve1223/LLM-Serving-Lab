import { MarkdownMaterialProvider } from "./MarkdownMaterialProvider.ts";
import { PptxMaterialProvider } from "./PptxMaterialProvider.ts";
import { TextMaterialProvider } from "./TextMaterialProvider.ts";
import type { LearningMaterialInput } from "../types.ts";
import type { LearningMaterialProvider } from "./LearningMaterialProvider.ts";

export function createMaterialProvider(input: LearningMaterialInput): LearningMaterialProvider {
  const filePath = input.filePath?.toLowerCase() ?? "";
  if (input.type === "pptx" || filePath.endsWith(".pptx")) return new PptxMaterialProvider();
  if (input.type === "ppt") {
    throw new Error(".ppt parsing is not supported directly. Please convert the file to .pptx first.");
  }
  if (input.type === "markdown" || filePath.endsWith(".md")) return new MarkdownMaterialProvider();
  if (input.type === "text" || input.rawText) return new TextMaterialProvider();
  throw new Error(`Unsupported learning material type: ${input.type}`);
}
