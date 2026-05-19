import type { LearningContext } from "../types.ts";
import type { LearnerMisconception } from "./types.ts";
import { containsLoose, nowIso } from "./learningLoopUtils.ts";

export class MisconceptionDetector {
  detect(input: { text: string; context?: LearningContext }): string[] {
    const text = input.text;
    const findings: string[] = [];

    if (containsLoose(text, "算力就是算法") || (containsLoose(text, "算力") && containsLoose(text, "算法更聪明"))) {
      findings.push("混淆“算力”和“算法”：算力是计算资源，算法是解决问题的方法。");
    }
    if (containsLoose(text, "RAG") && (containsLoose(text, "完全消除幻觉") || containsLoose(text, "彻底消除幻觉"))) {
      findings.push("过度理解 RAG：RAG 可以降低幻觉风险，但不能彻底消除幻觉。");
    }
    if (containsLoose(text, "数据越多一定越好") || containsLoose(text, "数据质量不重要")) {
      findings.push("忽略数据质量：规模和质量都会影响模型效果。");
    }
    if (containsLoose(text, "K=3") && containsLoose(text, "三句话")) {
      findings.push("误解检索参数 K：K 通常表示检索片段数量，不是答案句数。");
    }

    return findings;
  }

  toMemoryEntry(concept: string, description: string, example: string, existing?: LearnerMisconception): LearnerMisconception {
    const timestamp = nowIso();
    return {
      concept,
      description,
      firstSeenAt: existing?.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
      count: (existing?.count ?? 0) + 1,
      examples: [...(existing?.examples ?? []), example].slice(-5)
    };
  }
}
