import type { LearningResource, ResourceRecommendation, ResourceScoutInput } from "./types.ts";
import { containsLoose, extractConcepts, normalize } from "../learningLoop/learningLoopUtils.ts";

export class ResourceMatcher {
  match(resources: LearningResource[], input: ResourceScoutInput): ResourceRecommendation[] {
    const concepts = new Set([
      ...extractConcepts(input.learningContext, 8),
      ...(input.diagnosis?.confusionPoints ?? []),
      ...(input.learnerMemory?.weakConcepts ?? [])
    ]);
    const level = input.learnerLevel ?? input.learningContext.learner?.profile?.level;

    return resources
      .map((resource) => {
        const conceptHits = resource.concepts.filter((concept) =>
          [...concepts].some((target) => containsLoose(concept, target) || containsLoose(target, concept))
        );
        const text = `${resource.title} ${resource.description ?? ""} ${resource.concepts.join(" ")}`;
        const pageHits = [...concepts].filter((concept) => containsLoose(text, concept));
        let score = conceptHits.length * 3 + pageHits.length;
        if (level && level !== "unknown" && resource.difficulty === level) score += 1.5;
        if (input.preferredDurationMinutes && resource.durationMinutes && resource.durationMinutes <= input.preferredDurationMinutes) score += 1;
        return {
          resource,
          score,
          conceptHits
        };
      })
      .filter((item) => item.score > 0 && !isDemoResource(item.resource))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((item) => this.toRecommendation(item.resource, item.score, item.conceptHits));
  }

  private toRecommendation(resource: LearningResource, score: number, conceptHits: string[]): ResourceRecommendation {
    const primary = conceptHits[0] ?? resource.concepts[0] ?? "当前概念";
    return {
      resource,
      title: resource.title,
      url: resource.url,
      type: resource.type ?? "article",
      sourceName: resource.sourceName ?? resource.platform,
      matchScore: Number(score.toFixed(2)),
      matchReason: `与当前学习中的“${primary}”相关，适合作为课后补充材料。`,
      suggestedSegment: resource.recommendedSegments?.[0],
      learningGoal: `补强“${primary}”相关理解。`,
      beforeLearningQuestion: `学习前先想一想：你现在对“${primary}”最不确定的地方是什么？`,
      afterLearningCheckQuestion: `学习后请用自己的话解释“${primary}”和当前 PPT 页内容之间的关系。`,
      beforeWatchingQuestion: `学习前先想一想：你现在对“${primary}”最不确定的地方是什么？`,
      afterWatchingCheckQuestion: `学习后请用自己的话解释“${primary}”和当前 PPT 页内容之间的关系。`,
      credibility: resource.credibility ?? "medium",
      verified: resource.verified !== false
    };
  }
}

function isDemoResource(resource: LearningResource): boolean {
  const text = `${resource.title} ${resource.url} ${(resource.qualityTags ?? []).join(" ")}`.toLowerCase();
  return /demo|example\.edu|placeholder|占位/.test(text);
}
