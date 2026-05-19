import type { ContextSummary, DetectedIntent, LearningContext, LearningOutlineItem } from "../types.ts";

const CURRENT_PAGE_CUES = [
  "这页",
  "这一页",
  "当前页",
  "当前ppt",
  "ppt",
  "幻灯片",
  "教材页",
  "上面",
  "这里",
  "本页",
  "this slide",
  "current page",
  "current slide"
];

const KNOWLEDGE_BASE_CUES = [
  "知识库",
  "wiki",
  "资料",
  "文档",
  "来源",
  "依据",
  "引用",
  "检索",
  "更完整",
  "除了当前",
  "有没有",
  "补充",
  "outside",
  "source",
  "evidence",
  "knowledge base"
];

export class ContextAnalyzer {
  analyze(query: string, context: LearningContext = {}): ContextSummary {
    const currentPage = context.currentPage;
    const currentPageText = compactJoin([
      currentPage?.title,
      currentPage?.text,
      ...(currentPage?.bulletPoints ?? []),
      ...(currentPage?.imageAltTexts ?? []),
      ...(currentPage?.mediaDescriptions ?? [])
    ]);

    const teacherScriptText = compactJoin([
      context.teacherScript?.text,
      ...(context.teacherScript?.segments ?? []).map((segment) => segment.text)
    ]);

    const queryReferencesCurrentPage = includesAny(query, CURRENT_PAGE_CUES);
    const queryRequestsKnowledgeBase = includesAny(query, KNOWLEDGE_BASE_CUES);
    const pageQueryOverlapScore = lexicalOverlap(query, currentPageText ?? "");
    const detectedIntent = detectIntent(query, {
      queryReferencesCurrentPage,
      queryRequestsKnowledgeBase,
      pageQueryOverlapScore,
      hasCurrentPage: Boolean(currentPageText)
    });
    const outlinePath = findOutlinePath(context.outline?.items ?? [], currentPage?.pageIndex);
    const metadataKeys = Object.keys(context.platformMetadata ?? {});
    const hasNeighborPages = Boolean(context.neighborPages?.previous || context.neighborPages?.next);
    const likelyTopic = inferLikelyTopic(query, currentPage?.title, currentPage?.bulletPoints ?? []);

    const reasons: string[] = [];
    if (currentPageText) reasons.push("current page content is available");
    if (teacherScriptText) reasons.push(`${context.teacherScript?.source ?? "teacher"} script context is available`);
    if (outlinePath.length > 0) reasons.push(`${context.outline?.source ?? "outline"} outline position is available`);
    if (hasNeighborPages) reasons.push("neighbor page summaries are available");
    if (queryReferencesCurrentPage) reasons.push("query explicitly references the current page");
    if (queryRequestsKnowledgeBase) reasons.push("query asks for knowledge-base or source support");
    if (pageQueryOverlapScore > 0) reasons.push("query terms overlap with current page text");

    const usableContextScore =
      (currentPageText ? 0.4 : 0) +
      (teacherScriptText ? 0.2 : 0) +
      (outlinePath.length > 0 ? 0.14 : 0) +
      (hasNeighborPages ? 0.1 : 0) +
      ((context.chatHistory?.length ?? 0) > 0 ? 0.08 : 0) +
      (metadataKeys.length > 0 ? 0.04 : 0) +
      Math.min(0.04, pageQueryOverlapScore * 0.04);

    return {
      detectedIntent,
      questionUnderstanding: summarizeQuestion(query, detectedIntent, likelyTopic),
      hasCurrentPage: Boolean(currentPageText),
      currentPageId: currentPage?.id,
      currentPageTitle: currentPage?.title,
      currentPageText,
      currentPageKnowledgePoints: currentPage?.bulletPoints ?? [],
      outlinePath,
      outlineSource: context.outline?.source ?? "missing",
      hasTeacherScript: Boolean(teacherScriptText) && context.teacherScript?.source !== "missing",
      teacherScriptSource: context.teacherScript?.source ?? "missing",
      teacherScriptText,
      hasNeighborPages,
      chatHistoryTurns: context.chatHistory?.length ?? 0,
      metadataKeys,
      queryReferencesCurrentPage,
      queryRequestsKnowledgeBase,
      likelyTopic,
      pageQueryOverlapScore,
      usableContextScore: Math.min(1, usableContextScore),
      reasons
    };
  }
}

function detectIntent(
  query: string,
  signals: {
    queryReferencesCurrentPage: boolean;
    queryRequestsKnowledgeBase: boolean;
    pageQueryOverlapScore: number;
    hasCurrentPage: boolean;
  }
): DetectedIntent {
  if (signals.queryRequestsKnowledgeBase) return "ask_beyond_current_page";
  if (/练习|题|考试|测验|作业|quiz|exercise/i.test(query)) return "ask_exercise";
  if (/总结|概括|主要|核心|讲什么|main idea|summary/i.test(query)) return "ask_summary";
  if (signals.queryReferencesCurrentPage) return "ask_current_page";
  if (/是什么|什么意思|区别|原理|why|what|how/i.test(query)) {
    if (signals.hasCurrentPage && signals.pageQueryOverlapScore < 0.05 && /公式|具体|数值|预算|价格|日期/.test(query)) {
      return "ask_unrelated";
    }
    return "ask_concept";
  }
  return "unknown";
}

function compactJoin(values: Array<string | undefined>): string | undefined {
  const joined = values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n");
  return joined || undefined;
}

function includesAny(text: string, cues: string[]): boolean {
  const lowered = text.toLowerCase();
  return cues.some((cue) => lowered.includes(cue.toLowerCase()));
}

function lexicalOverlap(query: string, pageText: string): number {
  const queryTerms = tokenize(query);
  const pageTerms = new Set(tokenize(pageText));
  if (queryTerms.length === 0 || pageTerms.size === 0) return 0;
  const hits = queryTerms.filter((term) => pageTerms.has(term)).length;
  return hits / queryTerms.length;
}

function tokenize(text: string): string[] {
  const terms = new Set<string>();
  const lowered = text.toLowerCase();
  for (const match of lowered.matchAll(/[a-z0-9][a-z0-9_+-]{1,}/g)) terms.add(match[0]);
  for (const match of lowered.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const word = match[0];
    terms.add(word);
    for (let i = 0; i < word.length - 1; i += 1) terms.add(word.slice(i, i + 2));
  }
  return [...terms].filter((term) => !STOP_TERMS.has(term));
}

const STOP_TERMS = new Set(["这个", "什么", "怎么", "为什么", "一下", "这里", "这页", "当前", "主要", "核心", "the", "and", "what", "how"]);

function inferLikelyTopic(query: string, pageTitle?: string, bulletPoints: string[] = []): string | undefined {
  const bulletHit = bulletPoints.find((point) => point && query.includes(point));
  if (bulletHit) return bulletHit;
  if (pageTitle && includesAny(query, CURRENT_PAGE_CUES)) return pageTitle;
  const quoted = query.match(/[“"']([^”"']{2,40})[”"']/)?.[1];
  if (quoted) return quoted;
  const englishConcept = query.match(/\b[A-Z][A-Za-z0-9+-]{1,}\b/);
  if (englishConcept) return englishConcept[0];
  return query.match(/[\u4e00-\u9fa5A-Za-z0-9+-]{2,24}(?:是什么|有什么区别|怎么理解|什么意思)/)?.[0]?.replace(/是什么|有什么区别|怎么理解|什么意思/g, "");
}

function findOutlinePath(items: LearningOutlineItem[], pageIndex?: number): string[] {
  if (!pageIndex) return [];
  for (const item of items) {
    const found = findOutlinePathInItem(item, pageIndex, []);
    if (found.length > 0) return found;
  }
  return [];
}

function findOutlinePathInItem(item: LearningOutlineItem, pageIndex: number, parents: string[]): string[] {
  const inRange =
    typeof item.pageStart === "number" &&
    typeof item.pageEnd === "number" &&
    pageIndex >= item.pageStart &&
    pageIndex <= item.pageEnd;
  const next = [...parents, item.title];
  for (const child of item.children ?? []) {
    const found = findOutlinePathInItem(child, pageIndex, next);
    if (found.length > 0) return found;
  }
  if (inRange) return next;
  return [];
}

function summarizeQuestion(query: string, intent: DetectedIntent, topic?: string): string {
  const target = topic ? ` about "${topic}"` : "";
  return `Detected ${intent}${target}: ${query}`;
}
