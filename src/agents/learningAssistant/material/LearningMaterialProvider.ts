import type { LearningMaterial, LearningMaterialInput, LearningOutline, LearningPage, PagePreview } from "../types.ts";

export interface LearningMaterialProvider {
  load(input: LearningMaterialInput): Promise<LearningMaterial>;
  getPage(pageIndex: number): Promise<LearningPage>;
  getPageCount(): number;
  getOutline?(): Promise<LearningOutline>;
  renderPagePreview?(pageIndex: number): Promise<PagePreview>;
}
