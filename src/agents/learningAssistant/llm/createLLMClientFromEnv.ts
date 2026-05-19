import { KimiLLMClient } from "./KimiLLMClient.ts";
import { OpenAICompatibleLLMClient } from "./OpenAICompatibleLLMClient.ts";
import type { LLMClient } from "../types.ts";

export type EnvLike = Record<string, string | undefined>;

export type EnvLLMConfig = {
  provider: "kimi" | "openai-compatible";
  model: string;
  baseUrl: string;
};

export type EnvLLMClientResult = {
  client?: LLMClient;
  config?: EnvLLMConfig;
  reason?: string;
};

export function createLLMClientFromEnv(env: EnvLike = process.env): EnvLLMClientResult {
  const provider = normalizeProvider(env.LEARNING_ASSISTANT_LLM_PROVIDER ?? env.LLM_PROVIDER);
  const kimiKey = firstNonEmpty(env.KIMI_API_KEY, env.MOONSHOT_API_KEY);
  const genericKey = firstNonEmpty(env.LLM_API_KEY, env.OPENAI_COMPATIBLE_API_KEY);

  if (provider === "off") {
    return { reason: "LLM provider disabled by environment" };
  }

  if (provider === "kimi" || (!provider && kimiKey)) {
    if (!kimiKey) return { reason: "KIMI_API_KEY or MOONSHOT_API_KEY is not set" };
    const model = env.KIMI_MODEL ?? env.MOONSHOT_MODEL ?? "kimi-k2.5";
    const baseUrl = env.KIMI_BASE_URL ?? env.MOONSHOT_BASE_URL ?? "https://api.moonshot.cn/v1";
    return {
      client: new KimiLLMClient({
        apiKey: kimiKey,
        model,
        baseUrl,
        temperature: parseNumber(env.LLM_TEMPERATURE),
        maxTokens: parseNumber(env.LLM_MAX_TOKENS),
        timeoutMs: parseNumber(env.LLM_TIMEOUT_MS)
      }),
      config: {
        provider: "kimi",
        model,
        baseUrl
      }
    };
  }

  if (provider === "openai-compatible" || genericKey) {
    if (!genericKey) return { reason: "LLM_API_KEY or OPENAI_COMPATIBLE_API_KEY is not set" };
    const model = env.LLM_MODEL ?? "gpt-4o-mini";
    const baseUrl = env.LLM_BASE_URL ?? "https://api.openai.com/v1";
    return {
      client: new OpenAICompatibleLLMClient({
        apiKey: genericKey,
        model,
        baseUrl,
        temperature: parseNumber(env.LLM_TEMPERATURE),
        maxTokens: parseNumber(env.LLM_MAX_TOKENS),
        timeoutMs: parseNumber(env.LLM_TIMEOUT_MS)
      }),
      config: {
        provider: "openai-compatible",
        model,
        baseUrl
      }
    };
  }

  return { reason: "No LLM API key configured" };
}

function normalizeProvider(value: string | undefined): "kimi" | "openai-compatible" | "off" | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["kimi", "moonshot"].includes(normalized)) return "kimi";
  if (["openai-compatible", "openai_compatible", "openai", "generic"].includes(normalized)) {
    return "openai-compatible";
  }
  if (["off", "none", "disabled"].includes(normalized)) return "off";
  throw new Error(`Unsupported LLM provider: ${value}`);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value?.trim())?.trim();
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
