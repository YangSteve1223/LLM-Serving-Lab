import type { LearningContext } from "../types.ts";
import type { LearningObjective } from "./types.ts";
import { containsLoose, extractConcepts, meaningfulLines, pageTitle, sourceText, summarize } from "./learningLoopUtils.ts";

export type LearningObjectiveExtractorInput = {
  learningContext: LearningContext;
  targetConcepts?: string[];
  learnerProfile?: LearningContext["learner"];
  difficulty?: "easy" | "medium" | "hard";
  count?: number;
};

export class LearningObjectiveExtractor {
  extract(input: LearningObjectiveExtractorInput): LearningObjective[] {
    const context = input.learningContext;
    const text = sourceText(context);
    const lines = meaningfulLines(text);
    const concepts = prioritizeConcepts(input.targetConcepts?.length ? input.targetConcepts : extractConcepts(context, 8), context);
    const max = Math.min(Math.max(input.count ?? 3, 2), 5);
    const level = context.learner?.profile?.level ?? "unknown";

    return concepts.slice(0, Math.max(max, 3)).map((concept) => {
      const evidence = evidenceForConcept(concept, lines) ?? summarize(text, 220);
      return {
        concept,
        objective: objectiveForConcept(concept, evidence, pageTitle(context)),
        evidence,
        difficulty: input.difficulty ?? difficultyForLearner(level),
        questionTypes: questionTypesForConcept(concept, evidence)
      };
    });
  }
}

function prioritizeConcepts(concepts: string[], context: LearningContext): string[] {
  const text = sourceText(context);
  const page = context.currentPage;
  const preferred = ["数据", "算法", "算力", "FLOPS", "PFLOPS", "GFLOPS", "mAP", "F1", "RAG"].filter((item) =>
    containsLoose(text, item)
  );
  return unique([...concepts, ...(page?.bulletPoints ?? []), ...preferred])
    .filter((concept) => !/^\d+$/.test(concept))
    .slice(0, 8);
}

function evidenceForConcept(concept: string, lines: string[]): string | undefined {
  return lines.find((line) => containsLoose(line, concept)) ?? lines.find((line) => line.length > 8);
}

function objectiveForConcept(concept: string, evidence: string, fallbackTitle: string): string {
  if (containsLoose(concept, "数据")) {
    return "理解数据是 AI 的知识来源，决定模型知识边界，并能解释数据规模和质量对模型训练效果的影响。";
  }
  if (containsLoose(concept, "算法")) {
    return "理解算法决定模型如何从数据中学习、推理和生成结果，并能区分算法与算力的作用。";
  }
  if (containsLoose(concept, "算力")) {
    return "理解算力是支撑模型训练和推理的计算资源，并能说明它与算法、数据的关系。";
  }
  if (/FLOPS|PFLOPS|GFLOPS/i.test(concept) || /FLOPS|PFLOPS|GFLOPS/i.test(evidence)) {
    return "掌握 FLOPS 相关算力单位的含义和换算方法，并知道不能只凭算力指标判断整体训练效果。";
  }
  if (/mAP|F1/i.test(concept) || /mAP|F1/i.test(evidence)) {
    return "理解检测指标在方法评估中的作用，并能区分当前页证据能支持和不能支持的结论。";
  }
  return `围绕《${fallbackTitle}》中的“${concept}”，能用当前页证据说明它的含义、作用和限制。`;
}

function questionTypesForConcept(concept: string, evidence: string): LearningObjective["questionTypes"] {
  const types: LearningObjective["questionTypes"] = ["concept_check", "explain_back"];
  if (/FLOPS|PFLOPS|GFLOPS|\d/.test(`${concept} ${evidence}`)) types.push("calculation");
  if (/chart|curve|trend|map|F1|mAP|Scaling Law|图|曲线|趋势|表|柱状|折线/i.test(`${concept} ${evidence}`)) types.push("chart_reading");
  if (/区别|不是|不能|关系|缺一不可|混淆/.test(evidence)) types.push("misconception_check");
  if (/不能|无法|边界|限制|不支持|不能证明|全局最优/.test(evidence)) types.push("boundary_judgment");
  types.push("application");
  return unique(types);
}

function difficultyForLearner(level: string): "easy" | "medium" | "hard" {
  if (level === "advanced") return "hard";
  if (level === "intermediate") return "medium";
  return "easy";
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items.filter(Boolean))];
}
