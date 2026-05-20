/**
 * OpenAI-compatible streaming client used by the optional engine bridge.
 *
 * It records real client-observed TTFT/ITL only for stream=true responses. If
 * streaming fails and a full response is used, the trace marks actualStreaming
 * false and avoids fake token-level latency.
 */
import { performance } from "node:perf_hooks";
import type { ChatMessage } from "../../types.ts";
import { SSEParser, isDoneEvent } from "./SSEParser.ts";
import { buildActualStreamingTrace, type ActualStreamingTrace } from "./StreamingTrace.ts";

export type StreamingOpenAICompatibleClientOptions = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
};

export type StreamingCompletionResult = {
  outputText: string;
  actualStreamingTrace: ActualStreamingTrace;
  rawUsage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export class StreamingOpenAICompatibleClient {
  private options: StreamingOpenAICompatibleClientOptions;

  constructor(options: StreamingOpenAICompatibleClientOptions) {
    this.options = options;
  }

  async chat(messages: Array<Pick<ChatMessage, "role" | "content">>, requestOptions: { stream?: boolean; prompt?: string } = {}): Promise<StreamingCompletionResult> {
    if (requestOptions.stream === false) return this.fullResponse(messages);
    try {
      return await this.streamingResponse(messages);
    } catch (error) {
      const fallback = await this.fullResponse(messages);
      return {
        ...fallback,
        actualStreamingTrace: {
          ...fallback.actualStreamingTrace,
          actualStreaming: false,
          note: `streaming failed or unsupported; used full-response fallback (${error instanceof Error ? error.message : "unknown error"})`
        }
      };
    }
  }

  private async streamingResponse(messages: Array<Pick<ChatMessage, "role" | "content">>): Promise<StreamingCompletionResult> {
    const requestStartMs = performance.now();
    const response = await fetch(this.chatCompletionsUrl(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.options.model,
        messages,
        stream: true,
        max_tokens: this.options.maxTokens,
        temperature: this.options.temperature
      }),
      signal: timeoutSignal(this.options.timeoutMs)
    });
    if (!response.ok || !response.body) throw new Error(`stream request failed: HTTP ${response.status}`);

    const parser = new SSEParser();
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    const chunks: string[] = [];
    const perChunkTimestamps: number[] = [];
    let firstChunkMs: number | undefined;
    let firstTokenMs: number | undefined;
    let lastChunkMs: number | undefined;
    let usagePromptTokens: number | undefined;
    let usageCompletionTokens: number | undefined;
    let providerRequestId = response.headers.get("x-request-id") ?? response.headers.get("x-openai-request-id") ?? undefined;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      const now = performance.now();
      firstChunkMs ??= now;
      for (const event of parser.push(text)) {
        if (isDoneEvent(event)) {
          lastChunkMs = performance.now();
          continue;
        }
        const parsed = parseJson(event.data);
        if (!parsed) continue;
        const piece = extractDeltaText(parsed);
        providerRequestId = typeof parsed.id === "string" ? parsed.id : providerRequestId;
        const usage = parsed.usage as Record<string, unknown> | undefined;
        usagePromptTokens = numberField(usage, "prompt_tokens") ?? usagePromptTokens;
        usageCompletionTokens = numberField(usage, "completion_tokens") ?? usageCompletionTokens;
        if (piece) {
          chunks.push(piece);
          const tokenNow = performance.now();
          firstTokenMs ??= tokenNow;
          perChunkTimestamps.push(tokenNow);
          lastChunkMs = tokenNow;
        }
      }
    }
    for (const event of parser.flush()) {
      if (isDoneEvent(event)) continue;
      const parsed = parseJson(event.data);
      const piece = parsed ? extractDeltaText(parsed) : "";
      if (piece) {
        chunks.push(piece);
        const tokenNow = performance.now();
        firstTokenMs ??= tokenNow;
        perChunkTimestamps.push(tokenNow);
        lastChunkMs = tokenNow;
      }
    }
    lastChunkMs ??= performance.now();
    const outputText = chunks.join("");
    return {
      outputText,
      actualStreamingTrace: buildActualStreamingTrace({
        requestStartMs,
        firstChunkMs,
        firstTokenMs,
        perChunkTimestamps,
        lastChunkMs,
        outputText,
        usagePromptTokens,
        usageCompletionTokens,
        providerRequestId,
        actualStreaming: true,
        note: "real streaming trace from OpenAI-compatible SSE endpoint"
      }),
      rawUsage:
        usagePromptTokens !== undefined || usageCompletionTokens !== undefined
          ? { prompt_tokens: usagePromptTokens, completion_tokens: usageCompletionTokens }
          : undefined
    };
  }

  private async fullResponse(messages: Array<Pick<ChatMessage, "role" | "content">>): Promise<StreamingCompletionResult> {
    const requestStartMs = performance.now();
    const response = await fetch(this.chatCompletionsUrl(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.options.model,
        messages,
        stream: false,
        max_tokens: this.options.maxTokens,
        temperature: this.options.temperature
      }),
      signal: timeoutSignal(this.options.timeoutMs)
    });
    if (!response.ok) throw new Error(`completion request failed: HTTP ${response.status}`);
    const providerRequestId = response.headers.get("x-request-id") ?? response.headers.get("x-openai-request-id") ?? undefined;
    const json = (await response.json()) as Record<string, unknown>;
    const outputText = extractFullText(json);
    const usage = json.usage as Record<string, unknown> | undefined;
    const lastChunkMs = performance.now();
    return {
      outputText,
      actualStreamingTrace: buildActualStreamingTrace({
        requestStartMs,
        perChunkTimestamps: [],
        lastChunkMs,
        outputText,
        usagePromptTokens: numberField(usage, "prompt_tokens"),
        usageCompletionTokens: numberField(usage, "completion_tokens"),
        providerRequestId: typeof json.id === "string" ? json.id : providerRequestId,
        actualStreaming: false,
        note: "full-response fallback; real TTFT/ITL were not measured"
      }),
      rawUsage: usage as StreamingCompletionResult["rawUsage"]
    };
  }

  private chatCompletionsUrl(): string {
    return `${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;
    return headers;
  }
}

function extractDeltaText(parsed: Record<string, unknown>): string {
  const choices = Array.isArray(parsed.choices) ? (parsed.choices as Array<Record<string, unknown>>) : [];
  const first = choices[0];
  if (!first) return "";
  const delta = first.delta as Record<string, unknown> | undefined;
  if (typeof delta?.content === "string") return delta.content;
  if (typeof first.text === "string") return first.text;
  return "";
}

function extractFullText(parsed: Record<string, unknown>): string {
  const choices = Array.isArray(parsed.choices) ? (parsed.choices as Array<Record<string, unknown>>) : [];
  const first = choices[0];
  const message = first?.message as Record<string, unknown> | undefined;
  if (typeof message?.content === "string") return message.content;
  if (typeof first?.text === "string") return first.text;
  return "";
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function timeoutSignal(timeoutMs: number | undefined): AbortSignal | undefined {
  if (!timeoutMs || !Number.isFinite(timeoutMs)) return undefined;
  return AbortSignal.timeout(timeoutMs);
}
