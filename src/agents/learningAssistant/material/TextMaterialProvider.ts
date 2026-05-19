import { inferOutlineFromDeck } from "./inferOutlineFromDeck.ts";
import type { LearningMaterial, LearningMaterialInput, LearningOutline, LearningPage } from "../types.ts";
import type { LearningMaterialProvider } from "./LearningMaterialProvider.ts";

export class TextMaterialProvider implements LearningMaterialProvider {
  private material?: LearningMaterial;

  async load(input: LearningMaterialInput): Promise<LearningMaterial> {
    const raw = input.rawText ?? "";
    if (!raw.trim()) throw new Error("Text material requires rawText");
    const title = input.metadata?.title?.toString() ?? "Text material";
    const page: LearningPage = {
      id: "text-page-1",
      pageIndex: 1,
      title,
      text: raw.trim(),
      bulletPoints: raw
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-*]\s+/, "").trim())
        .filter(Boolean)
        .slice(0, 10),
      metadata: { source: "text" }
    };
    this.material = {
      id: "text-material",
      type: "text",
      title,
      pageCount: 1,
      pages: [page],
      outline: inferOutlineFromDeck({ pages: [page] }),
      metadata: input.metadata
    };
    return this.material;
  }

  async getPage(pageIndex: number): Promise<LearningPage> {
    if (!this.material || pageIndex !== 1) throw new Error(`Page ${pageIndex} is out of range`);
    return this.material.pages[0];
  }

  getPageCount(): number {
    return this.material?.pageCount ?? 0;
  }

  async getOutline(): Promise<LearningOutline> {
    return this.material?.outline ?? { source: "missing", items: [] };
  }
}
