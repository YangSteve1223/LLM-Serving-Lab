import { OpenAICompatibleLLMClient, type OpenAICompatibleLLMClientOptions } from "./OpenAICompatibleLLMClient.ts";

export type KimiLLMClientOptions = Omit<OpenAICompatibleLLMClientOptions, "apiKey" | "model" | "baseUrl"> & {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  thinking?: "enabled" | "disabled";
};

export class KimiLLMClient extends OpenAICompatibleLLMClient {
  constructor(options: KimiLLMClientOptions) {
    const model = options.model ?? "kimi-k2.5";
    super({
      ...options,
      baseUrl: options.baseUrl ?? "https://api.moonshot.cn/v1",
      model,
      temperature: normalizeKimiTemperature(model, options.temperature),
      extraBody: {
        ...(options.extraBody ?? {}),
        ...kimiThinkingBody(model, options.thinking)
      }
    });
    this.providerName = "kimi";
    this.modelName = model;
  }
}

function normalizeKimiTemperature(model: string, temperature: number | undefined): number | undefined {
  if (/^kimi-k2\.(5|6)$/i.test(model)) return undefined;
  return temperature;
}

function kimiThinkingBody(model: string, thinking: "enabled" | "disabled" | undefined): Record<string, unknown> {
  if (!/^kimi-k2\.(5|6)$/i.test(model)) return {};
  return { thinking: { type: thinking ?? "disabled" } };
}
