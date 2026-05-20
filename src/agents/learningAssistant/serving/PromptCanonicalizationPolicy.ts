/**
 * Prompt canonicalization policy types.
 *
 * cache_first can be useful for prefix caching experiments, but observe_only is
 * the default so prompt layout changes do not silently affect answer behavior.
 */
export type PromptCanonicalizationMode = "off" | "observe_only" | "cache_first";

export function normalizePromptCanonicalizationMode(value: unknown): PromptCanonicalizationMode {
  if (value === "off" || value === "observe_only" || value === "cache_first") return value;
  const env = process.env.PROMPT_CANONICALIZATION_MODE;
  if (env === "off" || env === "observe_only" || env === "cache_first") return env;
  return "observe_only";
}

export type ContextReplayPolicy = "full" | "evidence_top_k" | "current_page_only" | "cache_first";
