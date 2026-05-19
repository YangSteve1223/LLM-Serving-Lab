import type { EvidenceNeed, LearningContext, QuestionAnalysis, QuestionIntent } from "../types.ts";

const CURRENT_PAGE_CUES = ["这页", "这一页", "当前页", "当前 PPT", "当前PPT", "这里", "本页", "上面", "this page", "this slide", "current page", "current slide"];
const EXPLICIT_KB_CUES = ["知识库", "资料库", "外部资料", "外部证据", "除了当前", "有没有更完整", "Source Loop", "Query Loop", "Maintenance Loop", "skill", "skills", "knowledge base"];
const FORMULA_CUES = ["公式", "推导", "证明", "derive", "formula", "equation"];
const BUDGET_CUES = ["预算", "报价", "成本", "价格", "清单", "budget", "cost"];
const COMPARISON_CUES = ["区别", "对比", "不同", "相比", "vs", "versus", "compare", "difference"];
const SUMMARY_CUES = ["主要讲", "核心内容", "总结", "概括", "主旨", "main idea", "summary"];
const SOCRATIC_CUES = ["苏格拉底", "引导", "不要直接给结论", "提问引导"];
const ANALOGY_CUES = ["类比", "生活类比", "比喻", "好比", "直观理解"];
const NUMERIC_EXTRACTION_CUES = ["哪些具体数字", "列出数字", "逐条列出", "给了哪些数字", "有哪些数字"];
const CHART_TREND_CUES = ["图中", "图表", "趋势", "可见内容", "不要编造图上没有"];
const SUFFICIENCY_CUES = ["能不能完全说明", "能否完全说明", "能不能完全解释", "能否完全解释", "能否完全支持", "能不能完全支持", "是否足以证明", "能不能完全证明"];

export class QuestionAnalyzer {
  analyze(query: string, context: LearningContext = {}): QuestionAnalysis {
    const normalizedQuestion = query.replace(/\s+/g, " ").trim();
    const lower = normalizedQuestion.toLowerCase();
    const currentPageText = [
      context.currentPage?.semanticTitle,
      context.currentPage?.title,
      context.currentPage?.text,
      ...(context.currentPage?.bulletPoints ?? [])
    ]
      .filter(Boolean)
      .join("\n");
    const queryReferencesCurrentPage = includesAny(lower, CURRENT_PAGE_CUES);
    const keyEntities = extractKeyEntities(normalizedQuestion);
    const keyConcepts = extractKeyConcepts(normalizedQuestion, keyEntities);
    const pageOverlap = lexicalOverlap(normalizedQuestion, currentPageText);
    const pageHasEntity = keyEntities.some((entity) => containsNormalized(currentPageText, entity));
    const pageHasConcept = keyConcepts.some((concept) => containsNormalized(currentPageText, concept));
    let pageRelevant = Boolean(currentPageText.trim()) && (queryReferencesCurrentPage || pageOverlap >= 0.08 || pageHasEntity || pageHasConcept);
    if (/\bRAG\b/i.test(normalizedQuestion) && !/\bRAG\b/i.test(currentPageText)) {
      pageRelevant = false;
    }
    const evidenceNeed = detectEvidenceNeed(normalizedQuestion, lower, queryReferencesCurrentPage, pageRelevant, currentPageText, keyEntities);
    const intent = detectIntent({
      lower,
      evidenceNeed,
      queryReferencesCurrentPage,
      pageRelevant,
      hasPage: Boolean(currentPageText.trim()),
      pageOverlap,
      pageHasEntity,
      pageHasConcept
    });
    const currentPageRelevanceReason =
      pageRelevant
        ? queryReferencesCurrentPage
          ? "question explicitly references the current page"
          : "question overlaps with current-page entities or concepts"
        : "question has little lexical/entity overlap with the current page";
    const asksForFormula = evidenceNeed === "exact_formula_or_derivation" || includesAny(lower, FORMULA_CUES);
    const asksForBudget = evidenceNeed === "budget_table" || includesAny(lower, BUDGET_CUES);
    const asksForNumbers =
      evidenceNeed === "numeric_extraction" ||
      evidenceNeed === "numeric_calculation_from_page" ||
      /\d+(?:\.\d+)?/.test(normalizedQuestion);
    const asksForExactEvidence =
      asksForFormula ||
      asksForBudget ||
      evidenceNeed === "unknown_entity" ||
      (!pageRelevant && /\b(具体|精确|数值|实验数据|原始数据|论文结论)\b/.test(normalizedQuestion));
    const likelyNeedsRetrieval = shouldRetrieve({
      lower,
      evidenceNeed,
      intent,
      pageRelevant,
      queryReferencesCurrentPage,
      currentPageText
    });
    const likelyNeedsGeneralKnowledge =
      !queryReferencesCurrentPage &&
      !pageRelevant &&
      ["ask_comparison", "ask_concept"].includes(intent);

    return {
      normalizedQuestion,
      intent,
      evidenceNeed,
      keyEntities,
      keyConcepts,
      asksForExactEvidence,
      asksForFormula,
      asksForNumbers,
      asksForBudget,
      likelyNeedsRetrieval,
      likelyNeedsGeneralKnowledge,
      currentPageRelevanceReason
    };
  }
}

function detectEvidenceNeed(
  question: string,
  lower: string,
  queryReferencesCurrentPage: boolean,
  pageRelevant: boolean,
  currentPageText: string,
  keyEntities: string[]
): EvidenceNeed {
  const explicitKb = asksKnowledgeBase(lower);
  if (explicitKb) return "knowledge_base_lookup";
  if (isAmbiguousMetricQuestion(question, currentPageText)) return "ambiguous_reference";
  if (includesAny(lower, SUFFICIENCY_CUES)) return "sufficiency_check";
  if (includesAny(lower, CHART_TREND_CUES)) return "chart_trend";
  if (includesAny(lower, NUMERIC_EXTRACTION_CUES)) return "numeric_extraction";
  if (queryReferencesCurrentPage && /\d+(?:\.\d+)?/.test(question) && /(等于|多少|换算|计算|提升|增长|倍|%|百分点)/.test(question)) {
    return "numeric_calculation_from_page";
  }
  if (includesAny(lower, SOCRATIC_CUES)) return "socratic_guidance";
  if (includesAny(lower, ANALOGY_CUES)) return "analogy";
  if (includesAny(lower, BUDGET_CUES)) return "budget_table";
  if (includesAny(lower, FORMULA_CUES)) return "exact_formula_or_derivation";
  if (includesAny(lower, COMPARISON_CUES)) return "comparison";
  if (includesAny(lower, SUMMARY_CUES)) return "summary";
  if (keyEntities.length > 0 && !pageRelevant && /(具体|精确|数值|推导|预算|公式|表)/.test(question)) return "unknown_entity";
  if (queryReferencesCurrentPage || pageRelevant) return "concept_explanation";
  return "concept_explanation";
}

function detectIntent(input: {
  lower: string;
  evidenceNeed: EvidenceNeed;
  queryReferencesCurrentPage: boolean;
  pageRelevant: boolean;
  hasPage: boolean;
  pageOverlap: number;
  pageHasEntity: boolean;
  pageHasConcept: boolean;
}): QuestionIntent {
  if (input.evidenceNeed === "knowledge_base_lookup") return "ask_knowledge_base";
  if (input.evidenceNeed === "budget_table") return "ask_budget_or_table";
  if (input.evidenceNeed === "exact_formula_or_derivation") return "ask_formula_or_derivation";
  if (input.evidenceNeed === "summary") return "ask_current_page_summary";
  if (input.evidenceNeed === "ambiguous_reference" || input.evidenceNeed === "sufficiency_check") {
    return input.hasPage ? "ask_current_page_concept" : "ask_concept";
  }
  if (input.evidenceNeed === "comparison") return input.pageRelevant ? "ask_current_page_concept" : "ask_comparison";
  if (["numeric_extraction", "numeric_calculation_from_page", "chart_trend", "socratic_guidance", "analogy"].includes(input.evidenceNeed)) {
    return input.hasPage ? "ask_current_page_concept" : "ask_concept";
  }
  if (input.queryReferencesCurrentPage) return includesAny(input.lower, SUMMARY_CUES) ? "ask_current_page_summary" : "ask_current_page_concept";
  if (includesAny(input.lower, COMPARISON_CUES)) return input.pageRelevant ? "ask_current_page_concept" : "ask_comparison";
  if (/(是什么|什么意思|怎么理解|作用|为什么|why|what|how)/i.test(input.lower)) {
    return input.pageRelevant ? "ask_current_page_concept" : "ask_concept";
  }
  if (input.evidenceNeed === "unknown_entity") return "ask_unrelated";
  return input.pageRelevant ? "ask_current_page_concept" : "unknown";
}

function isAmbiguousMetricQuestion(question: string, currentPageText: string): boolean {
  if (!/(这个指标|该指标|这个数值|这个分数|这里的指标)/.test(question)) return false;
  return extractMetricCandidates(currentPageText).length >= 2;
}

function extractMetricCandidates(text: string): string[] {
  const candidates = new Set<string>();
  if (/mAP[_@]?0\.5/i.test(text)) candidates.add("mAP_0.5");
  if (/mAP[_@]?0\.5\s*[:：]\s*0\.95/i.test(text)) candidates.add("mAP_0.5:0.95");
  if (/\bF1\b|F1\s*分数/i.test(text)) candidates.add("F1");
  if (/\bPSNR\b/i.test(text)) candidates.add("PSNR");
  if (/\bSSIM\b/i.test(text)) candidates.add("SSIM");
  if (/\bLPIPS\b/i.test(text)) candidates.add("LPIPS");
  return [...candidates];
}

function shouldRetrieve(input: {
  lower: string;
  evidenceNeed: EvidenceNeed;
  intent: QuestionIntent;
  pageRelevant: boolean;
  queryReferencesCurrentPage: boolean;
  currentPageText: string;
}): boolean {
  if (input.evidenceNeed === "knowledge_base_lookup") return true;
  if (input.evidenceNeed === "unknown_entity") return true;
  if (input.evidenceNeed === "budget_table" || input.evidenceNeed === "exact_formula_or_derivation") {
    return !input.pageRelevant;
  }
  if (mentionsWikiOperatingPackage(input.lower)) return true;
  if (input.pageRelevant || input.queryReferencesCurrentPage) return false;
  return ["ask_concept", "ask_comparison"].includes(input.intent);
}

function asksKnowledgeBase(lower: string): boolean {
  if (EXPLICIT_KB_CUES.some((cue) => lower.includes(cue.toLowerCase()))) return true;
  if (/wiki\s*(里|中|inside|workflow|运行流程)/i.test(lower)) return true;
  return false;
}

function mentionsWikiOperatingPackage(lower: string): boolean {
  return /source loop|query loop|maintenance loop|answer_query_and_writeback|ingest_and_parse_source/i.test(lower);
}

function extractKeyEntities(text: string): string[] {
  const entities = new Set<string>();
  for (const match of text.matchAll(/\b[A-Z][A-Za-z0-9+_.]*(?:-[A-Za-z0-9+_.]+)*\b/g)) {
    const value = match[0];
    if (value.length >= 2 && !["PPT", "LLM", "AI"].includes(value)) entities.add(value);
  }
  for (const match of text.matchAll(/[A-Za-z]+(?:Beta|Zeta|Alpha)[A-Za-z0-9-]*/g)) {
    entities.add(match[0]);
  }
  return [...entities].slice(0, 8);
}

function extractKeyConcepts(text: string, entities: string[]): string[] {
  const concepts = new Set<string>(entities);
  for (const match of text.matchAll(/[\p{Script=Han}]{2,10}/gu)) {
    const value = match[0];
    if (!isChineseStopTerm(value)) concepts.add(value);
  }
  for (const match of text.matchAll(/\b[a-zA-Z][a-zA-Z0-9+_.-]{2,}\b/g)) {
    const value = match[0];
    if (!EN_STOP_TERMS.has(value.toLowerCase())) concepts.add(value);
  }
  return [...concepts].slice(0, 16);
}

export function lexicalOverlap(a: string, b: string): number {
  const aTerms = tokenize(a);
  const bTerms = new Set(tokenize(b));
  if (aTerms.length === 0 || bTerms.size === 0) return 0;
  return aTerms.filter((term) => bTerms.has(term)).length / aTerms.length;
}

export function tokenize(text: string): string[] {
  const terms = new Set<string>();
  const lower = text.toLowerCase();
  for (const match of lower.matchAll(/[a-z0-9][a-z0-9_+.-]{1,}/g)) {
    if (!EN_STOP_TERMS.has(match[0])) terms.add(match[0]);
  }
  for (const match of lower.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const word = match[0];
    if (!isChineseStopTerm(word)) terms.add(word);
    for (let i = 0; i < word.length - 1; i += 1) {
      const bi = word.slice(i, i + 2);
      if (!isChineseStopTerm(bi)) terms.add(bi);
    }
    for (let i = 0; i < word.length - 2; i += 1) {
      const tri = word.slice(i, i + 3);
      if (!isChineseStopTerm(tri)) terms.add(tri);
    }
  }
  return [...terms];
}

function includesAny(text: string, cues: string[]): boolean {
  return cues.some((cue) => text.includes(cue.toLowerCase()));
}

function containsNormalized(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function isChineseStopTerm(value: string): boolean {
  if (CHINESE_STOP_TERMS.has(value)) return true;
  return [...CHINESE_STOP_TERMS].some((term) => value === term);
}

const CHINESE_STOP_TERMS = new Set([
  "这个",
  "这些",
  "什么",
  "怎么",
  "如何",
  "这里",
  "这页",
  "当前",
  "主要",
  "核心",
  "请给",
  "给出",
  "具体",
  "分别",
  "一个",
  "有没有",
  "知识库",
  "根据",
  "说明",
  "问题",
  "结论",
  "直接",
  "不要"
]);

const EN_STOP_TERMS = new Set(["the", "and", "what", "how", "why", "with", "from", "this", "that", "ordinary", "question", "please"]);
