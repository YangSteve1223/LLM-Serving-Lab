import type { LearningMaterial, LearningMaterialInput, SlidePreview, SlidePreviewManifest } from "../types.ts";

export interface SlideRenderer {
  readonly rendererName: string;
  canRender(input: LearningMaterialInput): Promise<boolean>;
  renderDeck(input: LearningMaterialInput): Promise<SlidePreviewManifest>;
  renderPage(input: LearningMaterialInput, pageIndex: number): Promise<SlidePreview>;
}

export type ApplySlidePreviewOptions = {
  imageUrlForPage?: (pageIndex: number, preview: SlidePreview) => string | undefined;
};

export function applySlidePreviewManifest(
  material: LearningMaterial,
  manifest: SlidePreviewManifest,
  options: ApplySlidePreviewOptions = {}
): LearningMaterial {
  const previews = new Map(manifest.previews.map((preview) => [preview.pageIndex, preview]));
  material.pages = material.pages.map((page) => {
    const preview = previews.get(page.pageIndex) ?? unavailablePreview(material.id, page.pageIndex, manifest.error);
    const imageUrl = options.imageUrlForPage?.(page.pageIndex, preview) ?? preview.imageUrl;
    const publicPreview = imageUrl ? { ...preview, imageUrl } : preview;
    return {
      ...page,
      preview: publicPreview,
      previewImagePath: preview.imagePath,
      previewImageUrl: imageUrl,
      metadata: {
        ...page.metadata,
        previewStatus: publicPreview.status,
        previewFormat: publicPreview.format,
        previewRenderer: manifest.rendererName,
        previewError: publicPreview.error
      }
    };
  });
  material.metadata = {
    ...material.metadata,
    previewManifest: manifest
  };
  return material;
}

export function unavailablePreview(materialId: string, pageIndex: number, error?: string): SlidePreview {
  return {
    materialId,
    pageIndex,
    format: "unavailable",
    status: "unavailable",
    error: error ?? "Slide preview renderer is unavailable."
  };
}
