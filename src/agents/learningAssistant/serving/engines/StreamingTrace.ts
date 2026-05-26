/**
 * Streaming latency summarizer.
 *
 * It converts chunk timestamps into TTFT and ITL percentiles when actual chunks
 * exist; unavailable timing stays unavailable rather than simulated.
 */
import { exactTokenEstimator } from "../ExactTokenEstimator.ts";
import { round, percentile } from "../utils/MathUtils.ts";

export type StreamingTraceInput = {
  requestStartMs: number;
  firstChunkMs?: number;
  firstTokenMs?: number;
  perChunkTimestamps: number[];
  lastChunkMs?: number;
  outputText: string;
  usagePromptTokens?: number;
  usageCompletionTokens?: number;
  providerRequestId?: string;
  actualStreaming: boolean;
  note?: string;
};

export type ActualStreamingTrace = {
  actualStreaming: boolean;
  requestStartMs?: number;
  firstChunkMs?: number;
  firstTokenMs?: number;
  perChunkTimestamps?: number[];
  lastChunkMs?: number;
  e2eMs?: number;
  ttftMs?: number;
  itlMs?: number[];
  meanItlMs?: number;
  p50ItlMs?: number;
  p90ItlMs?: number;
  p99ItlMs?: number;
  chunkCount?: number;
  outputTokenEstimate?: number;
  outputCharCount?: number;
  usagePromptTokens?: number;
  usageCompletionTokens?: number;
  providerRequestId?: string;
  note?: string;
};

export function buildActualStreamingTrace(input: StreamingTraceInput): ActualStreamingTrace {
  const firstTokenMs = input.firstTokenMs ?? input.firstChunkMs;
  const lastChunkMs = input.lastChunkMs ?? input.perChunkTimestamps.at(-1);
  const itlMs = computeItl(input.perChunkTimestamps);
  return {
    actualStreaming: input.actualStreaming,
    requestStartMs: round(input.requestStartMs),
    firstChunkMs: input.firstChunkMs === undefined ? undefined : round(input.firstChunkMs),
    firstTokenMs: firstTokenMs === undefined ? undefined : round(firstTokenMs),
    perChunkTimestamps: input.actualStreaming ? input.perChunkTimestamps.map(round) : undefined,
    lastChunkMs: lastChunkMs === undefined ? undefined : round(lastChunkMs),
    e2eMs: lastChunkMs === undefined ? undefined : round(lastChunkMs - input.requestStartMs),
    ttftMs: input.actualStreaming && firstTokenMs !== undefined ? round(firstTokenMs - input.requestStartMs) : undefined,
    itlMs: input.actualStreaming ? itlMs.map(round) : undefined,
    meanItlMs: input.actualStreaming ? mean(itlMs) : undefined,
    p50ItlMs: input.actualStreaming ? percentile(itlMs, 50) : undefined,
    p90ItlMs: input.actualStreaming ? percentile(itlMs, 90) : undefined,
    p99ItlMs: input.actualStreaming ? percentile(itlMs, 99) : undefined,
    chunkCount: input.perChunkTimestamps.length,
    outputTokenEstimate: exactTokenEstimator.estimate(input.outputText).tokenCount,
    outputCharCount: input.outputText.length,
    usagePromptTokens: input.usagePromptTokens,
    usageCompletionTokens: input.usageCompletionTokens,
    providerRequestId: input.providerRequestId,
    note: input.note
  };
}

function computeItl(timestamps: number[]): number[] {
  const values: number[] = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    values.push(Math.max(0, timestamps[index] - timestamps[index - 1]));
  }
  return values;
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
