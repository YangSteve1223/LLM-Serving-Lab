import type { Skill, SkillInput, SkillOutput } from "../types.ts";

export class KnowledgeRetrievalSkill implements Skill {
  name = "KnowledgeRetrievalSkill";
  description = "Retrieve relevant chunks from a local markdown wiki or knowledge base.";

  async canHandle(input: SkillInput): Promise<boolean> {
    return Boolean(input.kb) && Boolean(input.policy.shouldRetrieveKnowledge);
  }

  async run(input: SkillInput): Promise<SkillOutput> {
    if (!input.kb) {
      return {
        content: "No knowledge base configured.",
        evidence: [],
        metadata: { reason: "missing_kb" },
        status: "failed"
      };
    }

    const retrieval = input.kb.retrieveWithDiagnostics
      ? await input.kb.retrieveWithDiagnostics(input.query, input.context, { topK: 5 })
      : {
          status: "success" as const,
          query: input.query,
          chunks: await input.kb.retrieve(input.query, input.context, { topK: 5 }),
          relevanceThreshold: 0,
          evidenceSufficient: true
        };
    const evidence = retrieval.chunks;
    return {
      content:
        evidence.length > 0
          ? `Retrieved ${evidence.length} relevant knowledge chunk(s).`
          : "No reliable knowledge chunks found.",
      evidence,
      metadata: {
        evidenceCount: evidence.length,
        retrieval
      },
      status: retrieval.status
    };
  }
}
