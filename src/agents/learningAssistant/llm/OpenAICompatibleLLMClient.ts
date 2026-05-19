import type { ChatMessage, LLMClient } from "../types.ts";

export type OpenAICompatibleLLMClientOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  defaultHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  fetchFn?: typeof fetch;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
    text?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
  };
};

export class OpenAICompatibleLLMClient implements LLMClient {
  providerName = "openai-compatible";
  modelName: string;
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private temperature?: number;
  private maxTokens?: number;
  private timeoutMs: number;
  private maxRetries: number;
  private retryDelayMs: number;
  private defaultHeaders: Record<string, string>;
  private extraBody: Record<string, unknown>;
  private fetchFn: typeof fetch;

  constructor(options: OpenAICompatibleLLMClientOptions) {
    if (!options.apiKey?.trim()) throw new Error("LLM apiKey is required");
    if (!options.model?.trim()) throw new Error("LLM model is required");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.modelName = options.model;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://api.openai.com/v1");
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 1200;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.extraBody = options.extraBody ?? {};
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async generate(
    messages: ChatMessage[],
    options: Record<string, unknown> = {}
  ): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.generateOnce(messages, options);
      } catch (error) {
        lastError = error;
        if (attempt >= this.maxRetries || !isRetryableLlmError(error)) throw error;
        await sleep(this.retryDelayMs * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("LLM request failed");
  }

  private async generateOnce(
    messages: ChatMessage[],
    options: Record<string, unknown> = {}
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const body: Record<string, unknown> = {
        model: String(options.model ?? this.model),
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content
        })),
        ...this.extraBody
      };

      const temperature = numberOption(options.temperature, this.temperature);
      const maxTokens = numberOption(options.maxTokens ?? options.max_tokens, this.maxTokens);
      if (temperature !== undefined) body.temperature = temperature;
      if (maxTokens !== undefined) body.max_tokens = maxTokens;

      const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          ...this.defaultHeaders
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const text = await response.text();
      const data = parseJson(text);

      if (!response.ok) {
        const message =
          data?.error?.message ??
          text.slice(0, 500) ??
          `HTTP ${response.status}`;
        throw new Error(`LLM request failed (${response.status}): ${message}`);
      }

      const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text;
      if (!content?.trim()) throw new Error("LLM response did not contain message content");
      return content.trim();
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function numberOption(value: unknown, fallback?: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function parseJson(text: string): ChatCompletionResponse | undefined {
  try {
    return JSON.parse(text) as ChatCompletionResponse;
  } catch {
    return undefined;
  }
}

function isRetryableLlmError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("(429)") || message.includes("(503)") || message.includes("overloaded") || message.includes("rate limit");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
