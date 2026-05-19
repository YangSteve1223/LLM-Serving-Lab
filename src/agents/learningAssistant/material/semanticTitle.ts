export function extractSemanticTitle(pageText: string, fallbackPageIndex?: number): { title: string; pageLabel?: string } {
  const lines = pageText
    .split(/\r?\n/)
    .map(cleanTitleText)
    .filter(Boolean);

  const pageLabel = lines.find(isPageLabel);
  const title = lines.find((line) => looksLikeSemanticTitle(line));
  if (title) return { title, pageLabel };

  const fallback = fallbackPageIndex ? `第 ${fallbackPageIndex} 页` : "Untitled page";
  return { title: fallback, pageLabel };
}

export function normalizePageTitle(candidate: string | undefined, pageText: string, fallbackPageIndex?: number): {
  title: string;
  pageLabel?: string;
  semanticTitle?: string;
} {
  const fromText = extractSemanticTitle(pageText, fallbackPageIndex);
  const cleaned = cleanTitleText(candidate ?? "");
  if (cleaned && looksLikeSemanticTitle(cleaned)) {
    return {
      title: cleaned,
      pageLabel: fromText.pageLabel,
      semanticTitle: cleaned
    };
  }
  return {
    title: fromText.title,
    pageLabel: cleaned && isPageLabel(cleaned) ? cleaned : fromText.pageLabel,
    semanticTitle: fromText.title.startsWith("第 ") ? undefined : fromText.title
  };
}

export function cleanTitleText(text: string): string {
  return text
    .replace(/^#{1,6}\s*/, "")
    .replace(/^Slide\s*\d+\s*[:：-]\s*/i, "")
    .replace(/^第\s*\d+\s*页\s*[:：-]?\s*/i, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPageLabel(text: string): boolean {
  const normalized = text.trim();
  return /^\d{1,3}$/.test(normalized) || /^[-–—]?\s*\d{1,3}\s*[-–—]?$/.test(normalized) || /^page\s+\d{1,3}$/i.test(normalized);
}

export function looksLikeSemanticTitle(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 2 || normalized.length > 64) return false;
  if (isPageLabel(normalized)) return false;
  if (/<\/?[a-z]+:/i.test(normalized)) return false;
  if (!/[\p{L}\p{N}]/u.test(normalized)) return false;
  if (/^(notes?|title|slide)$/i.test(normalized)) return false;
  if (/^(jilin university|university|contents?)$/i.test(normalized)) return false;
  if (/[。；;.]$/.test(normalized) && normalized.length > 18) return false;
  if (/是.+[，,。]/.test(normalized) && normalized.length > 24) return false;
  if ((normalized.match(/[，,。；;.!?？]/g)?.length ?? 0) >= 3) return false;
  return true;
}
