import type { LearningMaterial, LearningOutline, LearningOutlineItem, LearningPage } from "../types.ts";

export function inferOutlineFromDeck(material: Pick<LearningMaterial, "pages">): LearningOutline {
  if (material.pages.length === 0) return { source: "missing", items: [] };

  const items: LearningOutlineItem[] = material.pages.map((page) => ({
    id: `outline-page-${page.pageIndex}`,
    title: page.semanticTitle || page.title || `Page ${page.pageIndex}`,
    summary: summarizePage(page),
    pageStart: page.pageIndex,
    pageEnd: page.pageIndex
  }));

  return {
    source: "inferred_from_deck",
    items
  };
}

export function summarizePage(page: LearningPage, maxLength = 120): string {
  const text = [page.semanticTitle ?? page.title, page.text, ...(page.bulletPoints ?? [])]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}
