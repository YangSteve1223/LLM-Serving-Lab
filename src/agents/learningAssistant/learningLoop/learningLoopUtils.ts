import type { LearningContext } from "../types.ts";

export function nowIso(): string {
  return new Date().toISOString();
}

export function pageTitle(context: LearningContext): string {
  return context.currentPage?.semanticTitle ?? context.currentPage?.title ?? `第 ${context.currentPage?.pageIndex ?? 1} 页`;
}

export function pageId(context: LearningContext): string {
  return context.currentPage?.id ?? `page-${context.currentPage?.pageIndex ?? 1}`;
}

export function sourceText(context: LearningContext): string {
  return [
    context.currentPage?.semanticTitle,
    context.currentPage?.title,
    context.currentPage?.text,
    context.teacherScript?.text,
    context.outline?.items.map((item) => `${item.title} ${item.summary ?? ""}`).join("\n")
  ]
    .filter(Boolean)
    .join("\n");
}

export function extractConcepts(context: LearningContext, limit = 6): string[] {
  const text = sourceText(context);
  const concepts = new Set<string>();
  const preferred = [
    "数据",
    "算法",
    "算力",
    "RAG",
    "LLM Wiki",
    "Prompt Engineering",
    "Context Engineering",
    "CoT",
    "Harness",
    "mAP_0.5",
    "mAP_0.5:0.95",
    "F1",
    "PSNR",
    "SSIM",
    "LPIPS",
    "图像融合",
    "超声影像",
    "盲超分",
    "mix73"
  ];
  for (const item of preferred) {
    if (containsLoose(text, item)) concepts.add(item);
  }
  for (const line of meaningfulLines(text)) {
    if (line.length >= 2 && line.length <= 18 && !/^\d+$/.test(line)) concepts.add(line);
    if (concepts.size >= limit) break;
  }
  return [...concepts].slice(0, limit);
}

export function meaningfulLines(text: string | undefined): string[] {
  const seen = new Set<string>();
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 2 && !/^\d{1,3}$/.test(line))
    .filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    });
}

export function containsLoose(text: string, term: string): boolean {
  return normalize(text).includes(normalize(term));
}

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[,\s，。；;:：、"'“”‘’（）()]/g, "");
}

export function summarize(text: string | undefined, maxLength = 180): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

export function uniquePush(list: string[], value: string): string[] {
  return value && !list.includes(value) ? [...list, value] : list;
}

export function daysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function stableId(prefix: string, text: string): string {
  const hash = Array.from(text).reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 7);
  return `${prefix}-${hash.toString(16)}`;
}
