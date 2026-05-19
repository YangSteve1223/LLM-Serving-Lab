import type { ResourceRecommendation, ResourceSearchQuery, ResourceSearchResult } from "../types.ts";

export class ResourceRanker {
  rank(results: ResourceSearchResult[], query: ResourceSearchQuery): ResourceRecommendation[] {
    return results
      .map((result) => ({ result, score: score(result, query) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, query.maxResults)
      .map(({ result, score }) => toRecommendation(result, query, score));
  }
}

function score(result: ResourceSearchResult, query: ResourceSearchQuery): number {
  const text = `${result.title} ${result.snippet ?? ""} ${result.reason ?? ""}`.toLowerCase();
  let value = text.includes(query.concept.toLowerCase()) ? 5 : 0;
  value += query.confusionPoints.some((point) => text.includes(point.toLowerCase())) ? 2 : 0;
  value += result.credibility === "high" ? 3 : result.credibility === "medium" ? 1.5 : 0;
  value += result.language === query.language ? 1 : 0;
  value += ["official_doc", "course_page", "exercise"].includes(result.type) ? 1.5 : 0;
  value += result.estimatedDurationMinutes && result.estimatedDurationMinutes <= 20 ? 1 : 0;
  value += result.verified ? 2 : -4;
  return value;
}

function toRecommendation(result: ResourceSearchResult, query: ResourceSearchQuery, matchScore: number): ResourceRecommendation {
  const learningGoal = `补强“${query.concept}”：${query.confusionPoints[0] ?? "能用自己的话解释当前页中的关键关系和限制"}`;
  return {
    resource: {
      id: stableId(`${result.url}-${result.title}`),
      title: result.title,
      platform: "web",
      url: result.url,
      concepts: [query.concept, ...query.confusionPoints].filter(Boolean),
      difficulty: query.learnerLevel,
      type: result.type,
      description: result.snippet,
      sourceName: result.sourceName,
      credibility: result.credibility,
      verified: Boolean(result.verified),
      language: result.language === "en" ? "en" : "zh"
    },
    title: result.title,
    url: result.url,
    type: result.type,
    sourceName: result.sourceName,
    matchScore: Number(matchScore.toFixed(2)),
    matchReason: result.reason ?? `该资源与当前薄弱概念“${query.concept}”相关。`,
    learningGoal,
    beforeLearningQuestion: `学习前先想：你现在对“${query.concept}”最不确定的地方是什么？`,
    afterLearningCheckQuestion: `学习后请用当前页证据解释“${query.concept}”，并指出一个容易误解的点。`,
    beforeWatchingQuestion: `学习前先想：你现在对“${query.concept}”最不确定的地方是什么？`,
    afterWatchingCheckQuestion: `学习后请用当前页证据解释“${query.concept}”，并指出一个容易误解的点。`,
    credibility: result.credibility,
    verified: Boolean(result.verified)
  };
}

function stableId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}
