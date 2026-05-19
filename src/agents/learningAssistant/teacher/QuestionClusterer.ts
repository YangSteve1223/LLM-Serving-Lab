import type { ClassSessionData, TeacherInsightReport } from "./types.ts";
import { normalize } from "../learningLoop/learningLoopUtils.ts";

export class QuestionClusterer {
  cluster(session: ClassSessionData): TeacherInsightReport["highFrequencyQuestions"] {
    const groups = new Map<string, { question: string; count: number; relatedConcepts: Set<string> }>();
    for (const student of session.students) {
      for (const question of student.questions) {
        const key = this.keyFor(question);
        const group = groups.get(key) ?? { question, count: 0, relatedConcepts: new Set<string>() };
        group.count += 1;
        for (const concept of [...student.weakConcepts, ...student.misconceptions]) group.relatedConcepts.add(concept);
        groups.set(key, group);
      }
    }
    return [...groups.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((item) => ({
        question: item.question,
        count: item.count,
        relatedConcepts: [...item.relatedConcepts].slice(0, 5)
      }));
  }

  private keyFor(question: string): string {
    const normalized = normalize(question);
    if (/算法.*算力|算力.*算法/.test(normalized)) return "算法-算力区别";
    if (/flops|pflops|gflops|换算/.test(normalized)) return "FLOPS换算";
    if (/rag|检索|证据/.test(normalized)) return "RAG证据";
    return normalized.slice(0, 24);
  }
}
