import type { EngineKind } from "./EngineBenchmarkTypes.ts";

export type EngineProviderConfig = {
  engine?: EngineKind;
  baseUrl?: string;
  metricsUrl?: string;
  model?: string;
  apiKey?: string;
};

export function normalizeEngineKind(value: unknown): EngineKind {
  if (value === "vllm" || value === "sglang" || value === "openai-compatible" || value === "unknown") return value;
  return "openai-compatible";
}

export function inferEngineFromMetricNames(names: string[]): "vllm" | "sglang" | "unknown" {
  if (names.some((name) => name.startsWith("vllm:"))) return "vllm";
  if (names.some((name) => name.startsWith("sglang:"))) return "sglang";
  return "unknown";
}
