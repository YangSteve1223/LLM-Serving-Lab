import type { LearningContext, RetrievalOptions, RetrievalResult, RetrievedChunk } from "../types.ts";

export function retrieveChunks(
  chunks: RetrievedChunk[],
  query: string,
  context: LearningContext = {},
  options: RetrievalOptions = {}
): RetrievedChunk[] {
  return retrieveChunksWithDiagnostics(chunks, query, context, options).chunks;
}

export function retrieveChunksWithDiagnostics(
  chunks: RetrievedChunk[],
  query: string,
  context: LearningContext = {},
  options: RetrievalOptions = {}
): RetrievalResult {
  const topK = options.topK ?? 5;
  const minScore = options.minScore ?? defaultThreshold(query);
  const searchText = buildSearchText(query, context);
  const terms = tokenizeForSearch(searchText);
  const scored = chunks
    .map((chunk) => ({ ...chunk, score: scoreChunk(chunk, terms, query) }))
    .sort((a, b) => b.score - a.score);
  const accepted = scored.filter((chunk) => chunk.score >= minScore && passesHardQueryRules(chunk, query)).slice(0, topK);
  const rejected = scored
    .filter((chunk) => chunk.score < minScore || !passesHardQueryRules(chunk, query))
    .slice(0, topK)
    .map((chunk) => ({
      chunk,
      reason: !passesHardQueryRules(chunk, query)
        ? "failed hard relevance rule for the query entity/concept"
        : `score ${chunk.score.toFixed(2)} below threshold ${minScore.toFixed(2)}`
    }));

  return {
    status: accepted.length > 0 ? "success" : "empty",
    query,
    rewrittenQuery: searchText === query ? undefined : searchText,
    chunks: accepted,
    rejectedChunks: rejected,
    topScore: scored[0]?.score,
    relevanceThreshold: minScore,
    evidenceSufficient: accepted.length > 0 && accepted[0].score >= minScore + 1
  };
}

export function tokenizeForSearch(text: string): string[] {
  const lowered = text.toLowerCase();
  const terms = new Set<string>();

  for (const match of lowered.matchAll(/[a-z0-9][a-z0-9_+-]{1,}/g)) {
    if (!EN_STOP_TERMS.has(match[0])) terms.add(match[0]);
  }

  for (const match of lowered.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const word = match[0];
    if (!ZH_STOP_TERMS.has(word)) terms.add(word);
    for (let i = 0; i < word.length - 1; i += 1) {
      const term = word.slice(i, i + 2);
      if (!ZH_STOP_TERMS.has(term)) terms.add(term);
    }
    for (let i = 0; i < word.length - 2; i += 1) {
      const term = word.slice(i, i + 3);
      if (!ZH_STOP_TERMS.has(term)) terms.add(term);
    }
  }

  addSemanticExpansions(lowered, terms);
  return [...terms].filter((term) => term.length >= 2);
}

function buildSearchText(query: string, context: LearningContext): string {
  const queryAsksKbFlow = /知识库|wiki|运行流程|组织流程|source loop|query loop|maintenance loop|operating package/i.test(query);
  if (!queryAsksKbFlow) return query;
  return [
    query,
    context.currentPage?.semanticTitle,
    context.currentPage?.title,
    ...(context.outline?.items.map((item) => item.title) ?? [])
  ]
    .filter(Boolean)
    .join("\n");
}

function defaultThreshold(query: string): number {
  if (/alphabeta|公式|推导|预算|budget|formula|derivation/i.test(query)) return 5.8;
  if (/知识库|wiki|运行流程|source loop|query loop|maintenance loop/i.test(query)) return 3.2;
  if (/\brag\b|retrieval-augmented/i.test(query)) return 6.5;
  return 4.2;
}

function scoreChunk(chunk: RetrievedChunk, terms: string[], originalQuery: string): number {
  const title = `${chunk.title ?? ""} ${chunk.fileName}`.toLowerCase();
  const section = `${chunk.sectionTitle ?? ""}`.toLowerCase();
  const body = chunk.text.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (title.includes(term)) score += 4;
    if (section.includes(term)) score += 2.5;
    const bodyHits = countOccurrences(body, term);
    if (bodyHits > 0) score += Math.min(4, bodyHits) * termWeight(term);
  }

  if (/知识库|wiki|运行流程|组织流程|source loop|query loop|maintenance loop/i.test(originalQuery)) {
    if (/source loop|query loop|maintenance loop/i.test(body)) score += 10;
    if (/intake|triage|parse|compile|integrate|record|retrieve|answer|reflect|audit|diagnose|repair|review/i.test(body)) {
      score += 4;
    }
  }

  if (/\brag\b|retrieval-augmented/i.test(originalQuery)) {
    if (/\brag\b|retrieval-augmented generation/i.test(body)) score += 9;
    if (!/\brag\b|retrieval-augmented/i.test(body)) score -= 4;
  }

  for (const entity of extractExactEntities(originalQuery)) {
    if (body.includes(entity.toLowerCase()) || title.includes(entity.toLowerCase()) || section.includes(entity.toLowerCase())) {
      score += 12;
    } else {
      score -= 5;
    }
  }

  return Number(Math.max(0, score).toFixed(3));
}

function passesHardQueryRules(chunk: RetrievedChunk, query: string): boolean {
  const text = `${chunk.title ?? ""}\n${chunk.sectionTitle ?? ""}\n${chunk.text}`.toLowerCase();
  if (/\brag\b|retrieval-augmented/i.test(query)) return /\brag\b|retrieval-augmented/.test(text);
  const concept = conceptReferenceQuery(query);
  if (concept && !conceptTokens(concept).some((term) => text.includes(term.toLowerCase()))) return false;
  for (const entity of extractExactEntities(query)) {
    if (!text.includes(entity.toLowerCase())) return false;
  }
  return true;
}

function conceptReferenceQuery(query: string): string | undefined {
  if (!/(有没有更完整|更完整解释|除了当前|知识库里|knowledge base)/i.test(query)) return undefined;
  const firstLine = query.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!firstLine || firstLine === query.trim()) return undefined;
  const cleaned = firstLine.replace(/^#{1,6}\s*/, "").replace(/^Slide\s*\d+\s*[:：-]\s*/i, "").trim();
  if (!cleaned || cleaned.length > 40) return undefined;
  return cleaned;
}

function conceptTokens(concept: string): string[] {
  return tokenizeForSearch(concept).filter((term) => term.length >= 2 && !["wiki", "base", "knowledge"].includes(term));
}

function countOccurrences(text: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let start = 0;
  while (true) {
    const index = text.indexOf(term, start);
    if (index === -1) return count;
    count += 1;
    start = index + term.length;
  }
}

function termWeight(term: string): number {
  if (/^[a-z0-9_+-]+$/.test(term)) return term.length <= 3 ? 0.7 : 1.1;
  return term.length <= 2 ? 0.8 : 1.15;
}

function addSemanticExpansions(text: string, terms: Set<string>): void {
  if (/知识库|wiki|vault|文档库/.test(text)) addAll(terms, ["wiki", "vault", "knowledge", "base"]);
  if (/流程|运行|组织|循环|loop|flow|process/.test(text)) {
    addAll(terms, ["loop", "flow", "process", "operating", "source", "query", "maintenance"]);
  }
  if (/source|来源|素材|资料|进入/.test(text)) {
    addAll(terms, ["source", "intake", "triage", "parse", "compile", "integrate", "record"]);
  }
  if (/query|查询|问题|问答|回答/.test(text)) {
    addAll(terms, ["query", "retrieve", "answer", "reflect", "write", "back", "record"]);
  }
  if (/maintenance|维护|健康|修复|审查/.test(text)) {
    addAll(terms, ["maintenance", "audit", "diagnose", "repair", "review", "record"]);
  }
  if (/skill|技能|调用/.test(text)) addAll(terms, ["skill", "skills", "tool", "registry"]);
}

function addAll(terms: Set<string>, values: string[]): void {
  for (const value of values) terms.add(value);
}

function extractExactEntities(text: string): string[] {
  return [...text.matchAll(/\b[A-Z][A-Za-z0-9+-]*(?:-[A-Za-z0-9+-]+)+\b/g)].map((match) => match[0]);
}

const EN_STOP_TERMS = new Set(["the", "and", "what", "how", "why", "with", "from", "ordinary", "question", "answer"]);
const ZH_STOP_TERMS = new Set(["这个", "这些", "什么", "怎么", "如何", "这里", "当前", "除了", "有没有", "具体", "给出"]);
