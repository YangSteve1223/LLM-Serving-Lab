import type { ClassSessionData, TeacherInsightReport } from "./types.ts";

export class MisconceptionAggregator {
  aggregateCommonConfusions(session: ClassSessionData): TeacherInsightReport["commonConfusions"] {
    const groups = new Map<string, { concept: string; learners: Set<string>; examples: string[] }>();
    for (const student of session.students) {
      for (const misconception of student.misconceptions) {
        const concept = conceptFromMisconception(misconception);
        const group = groups.get(concept) ?? { concept, learners: new Set<string>(), examples: [] };
        group.learners.add(student.learnerId);
        group.examples.push(misconception);
        groups.set(concept, group);
      }
    }
    return [...groups.values()]
      .sort((a, b) => b.learners.size - a.learners.size)
      .map((item) => ({
        concept: item.concept,
        studentCount: item.learners.size,
        examples: [...new Set(item.examples)].slice(0, 4)
      }));
  }

  rankWeakConcepts(session: ClassSessionData): TeacherInsightReport["weakConceptRanking"] {
    const counts = new Map<string, number>();
    for (const student of session.students) {
      for (const concept of new Set(student.weakConcepts)) counts.set(concept, (counts.get(concept) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([concept, count]) => ({ concept, count }));
  }
}

function conceptFromMisconception(text: string): string {
  if (/算力|算法/.test(text)) return "算法与算力的区别";
  if (/RAG|幻觉|检索/.test(text)) return "RAG 与证据可靠性";
  if (/FLOPS|PFLOPS|GFLOPS/.test(text)) return "算力单位换算";
  return text.slice(0, 24);
}
