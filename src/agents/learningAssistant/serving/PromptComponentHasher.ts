/**
 * Stable hash helper for prompt components.
 *
 * Hashes let us observe whether the same material/page keeps a byte-stable
 * prefix across different questions, which is the precondition for prefix cache
 * reuse in engines such as vLLM or SGLang.
 */
import { createHash } from "node:crypto";

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortValue(item)])
  );
}
