import { OpenAICompatibleLLMClient, type OpenAICompatibleLLMClientOptions } from "./OpenAICompatibleLLMClient.ts";

export type DeepSeekLLMClientOptions = Omit<OpenAICompatibleLLMClientOptions, "apiKey" | "model" | "baseUrl"> & {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /**
   * Whether to enable DeepSeek's reasoning mode (for deepseek-reasoner model)
   */
  reasoning?: boolean;
};

/**
 * DeepSeek LLM Client
 * 
 * Supports models:
 * - deepseek-chat (default)
 * - deepseek-coder
 * - deepseek-reasoner (with reasoning enabled)
 */
export class DeepSeekLLMClient extends OpenAICompatibleLLMClient {
  constructor(options: DeepSeekLLMClientOptions) {
    const model = options.model ?? "deepseek-chat";
    super({
      ...options,
      baseUrl: options.baseUrl ?? "https://api.deepseek.com",
      model,
      temperature: normalizeDeepSeekTemperature(model, options.temperature),
      extraBody: {
        ...(options.extraBody ?? {}),
        ...deepSeekReasoningBody(model, options.reasoning)
      }
    });
    this.providerName = "deepseek";
    this.modelName = model;
  }
}

function normalizeDeepSeekTemperature(model: string, temperature: number | undefined): number | undefined {
  // deepseek-reasoner typically works best without temperature or with low temperature
  if (model.includes("reasoner")) {
    return temperature === undefined ? 1.0 : temperature;
  }
  return temperature;
}

function deepSeekReasoningBody(model: string, reasoning: boolean | undefined): Record<string, unknown> {
  // deepseek-reasoner model supports reasoning parameter
  if (model.includes("reasoner") && reasoning === true) {
    return { reasoning: true };
  }
  return {};
}
