import type { LearningDiagnosis, LearningIntervention } from "./types.ts";

export class LearningActionPlanner {
  choose(diagnosis: LearningDiagnosis): LearningIntervention {
    if (diagnosis.possibleMisconceptions.length > 0) return "worked_example";
    if (diagnosis.intent === "quiz_request") return "micro_quiz";
    if (diagnosis.intent === "resource_request") return "resource_recommendation";
    if (diagnosis.intent === "review") return "review_plan";
    if (diagnosis.masteryEstimate === "low") return "micro_quiz";
    return diagnosis.recommendedIntervention;
  }

  shouldNotifyTeacher(diagnosis: LearningDiagnosis): boolean {
    return diagnosis.possibleMisconceptions.length > 0 || diagnosis.masteryEstimate === "low";
  }
}
