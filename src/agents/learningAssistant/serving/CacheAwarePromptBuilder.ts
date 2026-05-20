/**
 * Cache-aware prompt planner.
 *
 * The builder separates stable prefix from dynamic suffix and removes volatile
 * fields such as request IDs/timestamps from the prefix. cache_first may send
 * more tokens once, so reports include break-even cache-hit analysis.
 */
import { assistantSystemPrompt } from "../prompts/assistantSystemPrompt.ts";
import type { EvidenceCandidate, LearningContext } from "../types.ts";
import { TokenEstimator } from "./TokenEstimator.ts";
import { hashText, stableJson } from "./PromptComponentHasher.ts";
import { normalizePromptCanonicalizationMode, type PromptCanonicalizationMode } from "./PromptCanonicalizationPolicy.ts";

export type PromptComponent = {
  name:
    | "system"
    | "course_policy"
    | "material_outline"
    | "current_page"
    | "teacher_script"
    | "neighbor_pages"
    | "selected_evidence"
    | "learner_profile"
    | "chat_history"
    | "question"
    | "format_contract";
  text: string;
  estimatedTokens: number;
  hash: string;
  cacheable: boolean;
  volatility: "stable" | "page_scoped" | "turn_scoped" | "request_scoped";
};

export type CacheAwarePromptPlan = {
  canonicalPrompt: string;
  originalPromptHash: string;
  canonicalPromptHash: string;
  stablePrefixHash: string;
  stablePrefixTokens: number;
  dynamicSuffixTokens: number;
  components: PromptComponent[];
  cachePrediction: {
    cacheablePrefixTokensEstimate: number;
    repeatedPrefixLikely: boolean;
    reason: string;
  };
  applied: boolean;
  mode: PromptCanonicalizationMode;
};

export class CacheAwarePromptBuilder {
  private estimator = new TokenEstimator();

  plan(input: {
    originalPrompt: string;
    query: string;
    context: LearningContext;
    selectedEvidence?: EvidenceCandidate[];
    mode?: PromptCanonicalizationMode;
  }): CacheAwarePromptPlan {
    const mode = normalizePromptCanonicalizationMode(input.mode);
    const components = this.components(input);
    const stablePrefix = components.filter((component) => component.cacheable).map(formatComponent).join("\n\n");
    const dynamicSuffix = components.filter((component) => !component.cacheable).map(formatComponent).join("\n\n");
    const canonicalPrompt = [stablePrefix, dynamicSuffix].filter(Boolean).join("\n\n--- dynamic request ---\n\n");
    const stablePrefixTokens = components.filter((component) => component.cacheable).reduce((sum, component) => sum + component.estimatedTokens, 0);
    const dynamicSuffixTokens = components.filter((component) => !component.cacheable).reduce((sum, component) => sum + component.estimatedTokens, 0);
    return {
      canonicalPrompt,
      originalPromptHash: hashText(input.originalPrompt),
      canonicalPromptHash: hashText(canonicalPrompt),
      stablePrefixHash: hashText(stablePrefix),
      stablePrefixTokens,
      dynamicSuffixTokens,
      components,
      cachePrediction: {
        cacheablePrefixTokensEstimate: stablePrefixTokens,
        repeatedPrefixLikely: Boolean(input.context.material?.id && input.context.currentPage?.pageIndex),
        reason: "stable system/course/page components are ordered before turn-scoped evidence, learner state, history, and question"
      },
      applied: mode === "cache_first",
      mode
    };
  }

  private components(input: { originalPrompt: string; query: string; context: LearningContext; selectedEvidence?: EvidenceCandidate[] }): PromptComponent[] {
    const context = input.context;
    return [
      this.component("system", assistantSystemPrompt, true, "stable"),
      this.component(
        "course_policy",
        [
          "Grounding/refusal/citation rules are mandatory.",
          "Use selected evidence for course-grounded answers.",
          "If evidence is insufficient, refuse to invent formulas, numbers, budgets, or proprietary claims.",
          "Citations must support the answer."
        ].join("\n"),
        true,
        "stable"
      ),
      this.component("material_outline", stableJson(context.outline ?? {}), true, "stable"),
      this.component(
        "current_page",
        stableJson({
          materialId: context.material?.id,
          pageIndex: context.currentPage?.pageIndex,
          title: context.currentPage?.semanticTitle ?? context.currentPage?.title,
          text: context.currentPage?.text
        }),
        true,
        "page_scoped"
      ),
      this.component("teacher_script", stableJson(context.teacherScript ?? {}), true, "page_scoped"),
      this.component("neighbor_pages", stableJson(context.neighborPages ?? {}), false, "turn_scoped"),
      this.component(
        "selected_evidence",
        stableJson((input.selectedEvidence ?? []).map((item) => ({ sourceType: item.sourceType, sourceId: item.sourceId, pageIndex: item.pageIndex, title: item.title, sectionTitle: item.sectionTitle, chunkId: item.chunkId, text: item.text }))),
        false,
        "turn_scoped"
      ),
      this.component("learner_profile", stableJson(context.learner ?? {}), false, "turn_scoped"),
      this.component("chat_history", stableJson(context.chatHistory ?? []), false, "turn_scoped"),
      this.component("question", input.query, false, "request_scoped"),
      this.component(
        "format_contract",
        "Return a concise student-facing answer. Keep uncertainty explicit. Preserve citation and refusal requirements.",
        false,
        "stable"
      )
    ];
  }

  private component(name: PromptComponent["name"], text: string, cacheable: boolean, volatility: PromptComponent["volatility"]): PromptComponent {
    const clean = stripRequestVolatileText(text);
    return {
      name,
      text: clean,
      estimatedTokens: this.estimator.estimateTokens(clean),
      hash: hashText(clean),
      cacheable,
      volatility
    };
  }
}

export function stripRequestVolatileText(text: string): string {
  return text
    .replace(/\brequestId\b\s*[:=]\s*[\w-]+/gi, "requestId:<removed>")
    .replace(/\btimestamp\b\s*[:=]\s*[\w:.+-]+/gi, "timestamp:<removed>")
    .replace(/\bcreatedAt\b\s*[:=]\s*[\w:.+-]+/gi, "createdAt:<removed>")
    .trim();
}

function formatComponent(component: PromptComponent): string {
  return [`<<<${component.name}>>>`, component.text, `<<<end:${component.name}>>>`].join("\n");
}

export const cacheAwarePromptBuilder = new CacheAwarePromptBuilder();
