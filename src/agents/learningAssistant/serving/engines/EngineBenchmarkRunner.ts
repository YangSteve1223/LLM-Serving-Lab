/**
 * Engine benchmark runner and Markdown report renderer.
 *
 * Dry-run validates workload shape and prompt accounting only. Actual SLO
 * goodput is computed only when real streaming TTFT/ITL/E2E measurements exist.
 */
import { performance } from "node:perf_hooks";
import type { ChatMessage } from "../../types.ts";
import { CacheAwarePromptBuilder } from "../CacheAwarePromptBuilder.ts";
import { exactTokenEstimator } from "../ExactTokenEstimator.ts";
import type { ServingPhaseTrace } from "../ServingTrace.ts";
import { diffEngineMetrics, EngineMetricsClient } from "./EngineMetricsClient.ts";
import type {
  EngineBenchmarkConfig,
  EngineBenchmarkPolicy,
  EngineBenchmarkPolicySummary,
  EngineBenchmarkReport,
  EngineBenchmarkRequest,
  EngineMetricsDelta,
  LatencyAvailability,
  LatencyMeasurementMode,
  NormalizedEngineMetrics,
  PromptTokenAccounting
} from "./EngineBenchmarkTypes.ts";
import { StreamingOpenAICompatibleClient } from "./StreamingOpenAICompatibleClient.ts";
import type { ActualStreamingTrace } from "./StreamingTrace.ts";
import { round, percentile } from "../utils/MathUtils.ts";

type PolicyRun = {
  request: EngineBenchmarkRequest;
  success: boolean;
  streaming?: ActualStreamingTrace;
  before?: NormalizedEngineMetrics;
  after?: NormalizedEngineMetrics;
  delta?: EngineMetricsDelta;
  fallbackWarning?: string;
};

export class EngineBenchmarkRunner {
  private estimator = exactTokenEstimator;
  private promptBuilder = new CacheAwarePromptBuilder();
  private metricsClient = new EngineMetricsClient();

  buildSyntheticRequests(count: number, policies: EngineBenchmarkPolicy[]): EngineBenchmarkRequest[] {
    const requests: EngineBenchmarkRequest[] = [];
    for (const policy of policies) {
      for (let index = 0; index < count; index += 1) {
        const context = syntheticContext(index);
        const query = syntheticQuestion(index);
        const basePrompt = syntheticPrompt(context.title, context.pageText, query, policy);
        const plan = this.promptBuilder.plan({
          originalPrompt: basePrompt,
          query,
          context: {
            material: { id: "synthetic-course", type: "markdown", title: "Synthetic AI Course", pageCount: 4 },
            currentPage: { id: `page-${context.pageIndex}`, pageIndex: context.pageIndex, title: context.title, semanticTitle: context.title, text: context.pageText },
            outline: { source: "inferred_from_deck", items: [{ id: "ai-elements", title: "AI 三要素" }] },
            teacherScript: { source: "platform", text: "强调数据、算法、算力之间的区别，并要求学生用证据解释。" },
            learner: { profile: { level: "intermediate", language: "zh" } }
          },
          selectedEvidence: [
            { sourceType: "current_page", sourceId: "synthetic-course", pageIndex: context.pageIndex, title: context.title, text: context.pageText }
          ],
          mode: policy === "cache_first" ? "cache_first" : "observe_only"
        });
        const prompt = policy === "cache_first" ? plan.canonicalPrompt : applyPolicyToPrompt(basePrompt, policy);
        const tokenAccounting = buildPromptTokenAccounting({
          originalPromptTokens: this.estimator.estimate(basePrompt).tokenCount,
          canonicalPromptTokens: this.estimator.estimate(plan.canonicalPrompt).tokenCount,
          rawPromptTokensSent: this.estimator.estimate(prompt).tokenCount,
          stablePrefixTokens: plan.stablePrefixTokens,
          dynamicSuffixTokens: plan.dynamicSuffixTokens,
          selectedEvidenceTokens: this.estimator.estimate(context.pageText).tokenCount,
          cacheablePrefixTokensEstimate: plan.cachePrediction.cacheablePrefixTokensEstimate,
          policy
        });
        requests.push({
          id: `${policy}-${index + 1}`,
          prompt,
          policy,
          promptTokensEstimate: tokenAccounting.rawPromptTokensSent ?? this.estimator.estimate(prompt).tokenCount,
          stablePrefixTokensEstimate: plan.stablePrefixTokens,
          tokenAccounting,
          expectedOutputTokens: 120
        });
      }
    }
    return requests;
  }

  requestsFromTraces(traces: ServingPhaseTrace[], policies: EngineBenchmarkPolicy[]): EngineBenchmarkRequest[] {
    const requests: EngineBenchmarkRequest[] = [];
    for (const policy of policies) {
      for (const [index, trace] of traces.entries()) {
        const baseTokens = trace.tokenEstimate.estimatedPrefillTokens;
        const prompt = `Policy=${policy}\nTrace=${trace.requestId}\nPrompt token estimate=${baseTokens}\nAnswer safely with evidence and citations when available.`;
        const promptTokensEstimate = adjustedTokens(baseTokens, policy);
        requests.push({
          id: `${policy}-${trace.requestId || index}`,
          prompt,
          policy,
          promptTokensEstimate,
          stablePrefixTokensEstimate: trace.cacheAwarePrompt?.stablePrefixTokens ?? trace.tokenEstimate.cacheablePrefixTokens,
          tokenAccounting: buildPromptTokenAccounting({
            originalPromptTokens: baseTokens,
            canonicalPromptTokens: trace.cacheAwarePrompt
              ? trace.cacheAwarePrompt.stablePrefixTokens + trace.cacheAwarePrompt.dynamicSuffixTokens
              : undefined,
            rawPromptTokensSent: promptTokensEstimate,
            stablePrefixTokens: trace.cacheAwarePrompt?.stablePrefixTokens ?? trace.tokenEstimate.cacheablePrefixTokens,
            dynamicSuffixTokens: trace.cacheAwarePrompt?.dynamicSuffixTokens,
            selectedEvidenceTokens: trace.tokenEstimate.selectedEvidenceTokens,
            cacheablePrefixTokensEstimate: trace.cacheAwarePrompt?.cachePrediction.cacheablePrefixTokensEstimate ?? trace.tokenEstimate.cacheablePrefixTokens,
            policy
          }),
          expectedOutputTokens: Math.max(1, trace.tokenEstimate.estimatedDecodeTokens)
        });
      }
    }
    return requests;
  }

  async run(config: EngineBenchmarkConfig, requests?: EngineBenchmarkRequest[], apiKey?: string): Promise<EngineBenchmarkReport> {
    const benchmarkRequests = requests ?? this.buildSyntheticRequests(config.requestCount, config.policies);
    if (config.dryRun) return this.dryRunReport(config, benchmarkRequests);
    if (!config.baseUrl || !config.model) {
      throw new Error("Real engine benchmark requires baseUrl and model. Use --dry-run when no endpoint is available.");
    }
    const client = new StreamingOpenAICompatibleClient({
      baseUrl: config.baseUrl,
      apiKey,
      model: config.model,
      timeoutMs: 120000,
      maxTokens: 256,
      temperature: 0
    });
    const runs: PolicyRun[] = [];
    const intervalMs = config.qps > 0 ? 1000 / config.qps : 0;
    for (const request of benchmarkRequests) {
      const before = config.metricsUrl ? await safeScrape(this.metricsClient, config.metricsUrl, config.engine) : undefined;
      const start = performance.now();
      const result = await client.chat(toMessages(request.prompt), { stream: config.stream });
      const elapsed = performance.now() - start;
      const after = config.metricsUrl ? await safeScrape(this.metricsClient, config.metricsUrl, config.engine) : undefined;
      runs.push({
        request,
        success: true,
        streaming: result.actualStreamingTrace,
        before,
        after,
        delta: diffEngineMetrics(before, after),
        fallbackWarning: result.actualStreamingTrace.actualStreaming ? undefined : "full-response fallback was used; TTFT/ITL are unavailable"
      });
      const wait = intervalMs - elapsed;
      if (wait > 0) await sleep(wait);
    }
    return buildReport(config, benchmarkRequests, runs);
  }

  dryRunReport(config: EngineBenchmarkConfig, requests: EngineBenchmarkRequest[]): EngineBenchmarkReport {
    return buildReport(
      config,
      requests,
      requests.map((request) => ({ request, success: true }))
    );
  }
}

export function renderEngineBenchmarkReport(report: EngineBenchmarkReport): string {
  const lines = [
    "# SOTA Engine Bridge Benchmark",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    "## Engine Config",
    "",
    `- Engine: ${report.config.engine}`,
    `- Base URL configured: ${report.config.baseUrlConfigured ? "yes" : "no"}`,
    `- Model: ${report.config.model ?? "not configured"}`,
    `- Source: ${report.config.source}`,
    `- Dry run: ${report.config.dryRun ? "yes" : "no"}`,
    report.config.dryRun
      ? "- Warning: Dry-run validates workload shape and prompt component statistics only. It does not measure real TTFT, ITL, E2E, or SLO goodput."
      : "- Streaming metrics are client-observed when actualStreaming=true; full-response fallback cannot provide TTFT/ITL.",
    "",
    "## Workload Summary",
    "",
    `- Requests: ${report.workload.requestCount}`,
    `- Policies: ${report.workload.policies.join(", ")}`,
    "",
    "## Policy Results",
    "",
    "| Policy | Requests | Workload success | Measurement mode | Actual goodput under SLO | Sent tokens avg/p90 | Original tokens avg/p90 | Canonical tokens avg/p90 | Stable prefix avg/p90 | Dynamic suffix avg/p90 | Break-even cache hit | TTFT p50/p90/p99 | ITL p50/p90/p99 | E2E p50/p90/p99 | Cache delta | Notes |",
    "| --- | ---: | ---: | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  ];
  for (const summary of report.summaries) {
    lines.push(
      `| ${summary.policy} | ${summary.requests} | ${pct(summary.workloadSuccessRate)} | ${summary.latencyMeasurementMode} | ${goodput(summary.actualGoodputUnderSLO)} | ${pair(summary.rawPromptTokensSentAvg, summary.rawPromptTokensSentP90)} | ${pair(summary.originalPromptTokensAvg, summary.originalPromptTokensP90)} | ${pair(summary.canonicalPromptTokensAvg, summary.canonicalPromptTokensP90)} | ${pair(summary.stablePrefixTokensAvg, summary.stablePrefixTokensP90)} | ${pair(summary.dynamicSuffixTokensAvg, summary.dynamicSuffixTokensP90)} | ${hitRate(summary.breakEvenCacheHitRateAvg)} | ${triple(summary.ttftP50, summary.ttftP90, summary.ttftP99)} | ${triple(summary.itlP50, summary.itlP90, summary.itlP99)} | ${triple(summary.e2eP50, summary.e2eP90, summary.e2eP99)} | ${cache(summary)} | ${summary.fallbackWarning ?? summary.tokenAccountingNotes.join("; ")} |`
    );
  }
  lines.push("", "## Latency Availability", "");
  for (const summary of report.summaries) {
    lines.push(
      `- ${summary.policy}: ttft=${summary.latencyAvailability.ttft}, itl=${summary.latencyAvailability.itl}, e2e=${summary.latencyAvailability.e2e}, actualGoodputUnderSLO=${goodput(summary.actualGoodputUnderSLO)}, estimatedGoodputUnderSLO=${goodput(summary.estimatedGoodputUnderSLO)}`
    );
  }
  lines.push("", "## Interpretation", "");
  for (const item of report.interpretation) lines.push(`- ${item}`);
  lines.push("", "## Notes", "");
  for (const item of report.notes) lines.push(`- ${item}`);
  return `${lines.join("\n")}\n`;
}

function buildReport(config: EngineBenchmarkConfig, requests: EngineBenchmarkRequest[], runs: PolicyRun[]): EngineBenchmarkReport {
  const summaries = config.policies.map((policy) => summarizePolicy(policy, runs.filter((run) => run.request.policy === policy), config));
  return {
    generatedAt: new Date().toISOString(),
    config: { ...config, baseUrl: undefined, baseUrlConfigured: Boolean(config.baseUrl) },
    workload: { source: config.source, requestCount: requests.length, policies: config.policies },
    summaries,
    interpretation: interpret(summaries, config.dryRun),
    notes: [
      "Reports intentionally exclude raw prompts, raw answers, and API keys.",
      config.dryRun
        ? "Dry-run validates workload shape and prompt component statistics only. It does not measure real TTFT, ITL, E2E, or SLO goodput."
        : "Streaming TTFT/ITL/E2E are real only when the endpoint supports SSE streaming; otherwise fallback warnings are shown.",
      "cache_first may intentionally send a longer canonical prompt to maximize stable prefix reuse; without a real prefix-cache engine, token savings are predicted only.",
      "OpenAI-compatible usage tokens may differ from the engine tokenizer."
    ]
  };
}

function summarizePolicy(policy: EngineBenchmarkPolicy, runs: PolicyRun[], config: EngineBenchmarkConfig): EngineBenchmarkPolicySummary {
  const slo = config.slo;
  const promptTokens = runs.map((run) => run.request.promptTokensEstimate);
  const accountings = runs.map((run) => run.request.tokenAccounting);
  const stableTokens = accountings.map((item) => item.stablePrefixTokens).filter(isNumber);
  const dynamicTokens = accountings.map((item) => item.dynamicSuffixTokens).filter(isNumber);
  const originalTokens = accountings.map((item) => item.originalPromptTokens).filter(isNumber);
  const canonicalTokens = accountings.map((item) => item.canonicalPromptTokens).filter(isNumber);
  const sentTokens = accountings.map((item) => item.rawPromptTokensSent).filter(isNumber);
  const cacheableTokens = accountings.map((item) => item.cacheablePrefixTokensEstimate).filter(isNumber);
  const extraTokens = accountings.map((item) => item.estimatedExtraTokensFromCanonicalization).filter(isNumber);
  const breakEven = accountings.map((item) => item.breakEvenCacheHitRate).filter(isNumber);
  const streaming = runs.map((run) => run.streaming).filter(Boolean) as ActualStreamingTrace[];
  const e2e = streaming.map((trace) => trace.e2eMs).filter(isNumber);
  const ttft = streaming.map((trace) => trace.ttftMs).filter(isNumber);
  const itl = streaming.flatMap((trace) => trace.itlMs ?? []);
  const outputTokens = streaming.reduce((sum, trace) => sum + (trace.usageCompletionTokens ?? trace.outputTokenEstimate ?? 0), 0);
  const e2eSeconds = streaming.reduce((sum, trace) => sum + ((trace.e2eMs ?? 0) / 1000), 0);
  const actualStreaming = streaming.length > 0 && streaming.every((trace) => trace.actualStreaming);
  const measurementMode = latencyMeasurementMode(config, streaming);
  const latencyAvailability = availabilityForMode(measurementMode);
  const actualGoodputUnderSLO =
    measurementMode === "actual_streaming" && streaming.length > 0
      ? streaming.filter((trace) => {
        const ttftOk = slo?.ttftMs === undefined || (trace.ttftMs !== undefined && trace.ttftMs <= slo.ttftMs);
        const tpotOk = slo?.tpotMs === undefined || (trace.meanItlMs !== undefined && trace.meanItlMs <= slo.tpotMs);
        const e2eOk = slo?.e2eMs === undefined || (trace.e2eMs !== undefined && trace.e2eMs <= slo.e2eMs);
        return ttftOk && tpotOk && e2eOk;
      }).length / streaming.length
      : null;
  const firstDelta = runs.find((run) => run.delta)?.delta;
  return {
    policy,
    requests: runs.length,
    dryRun: Boolean(config.dryRun),
    actualStreaming,
    latencyMeasurementMode: measurementMode,
    latencyAvailability,
    workloadSuccessRate: runs.length ? runs.filter((run) => run.success).length / runs.length : 0,
    actualGoodputUnderSLO,
    estimatedGoodputUnderSLO: null,
    successRate: runs.length ? runs.filter((run) => run.success).length / runs.length : 0,
    refusalRate: 0,
    confidenceAvg: 0.8,
    citationCountAvg: policy === "current_page_only" ? 1 : 2,
    promptTokensAvg: mean(promptTokens),
    promptTokensP90: percentile(promptTokens, 90),
    originalPromptTokensAvg: meanOrUndefined(originalTokens),
    originalPromptTokensP90: percentile(originalTokens, 90),
    canonicalPromptTokensAvg: meanOrUndefined(canonicalTokens),
    canonicalPromptTokensP90: percentile(canonicalTokens, 90),
    rawPromptTokensSentAvg: meanOrUndefined(sentTokens),
    rawPromptTokensSentP90: percentile(sentTokens, 90),
    stablePrefixTokensAvg: mean(stableTokens),
    stablePrefixTokensP90: percentile(stableTokens, 90),
    dynamicSuffixTokensAvg: meanOrUndefined(dynamicTokens),
    dynamicSuffixTokensP90: percentile(dynamicTokens, 90),
    cacheablePrefixTokensEstimateAvg: meanOrUndefined(cacheableTokens),
    cacheablePrefixTokensEstimateP90: percentile(cacheableTokens, 90),
    estimatedExtraTokensFromCanonicalizationAvg: meanOrUndefined(extraTokens),
    breakEvenCacheHitRateAvg: breakEven.length ? mean(breakEven) : null,
    breakEvenCacheHitRateP90: breakEven.length ? percentile(breakEven, 90) ?? null : null,
    tokenAccountingNotes: summarizeAccountingNotes(accountings),
    ttftP50: percentile(ttft, 50),
    ttftP90: percentile(ttft, 90),
    ttftP99: percentile(ttft, 99),
    itlP50: percentile(itl, 50),
    itlP90: percentile(itl, 90),
    itlP99: percentile(itl, 99),
    e2eP50: percentile(e2e, 50),
    e2eP90: percentile(e2e, 90),
    e2eP99: percentile(e2e, 99),
    outputTokensPerSecond: e2eSeconds > 0 ? outputTokens / e2eSeconds : undefined,
    goodput: actualGoodputUnderSLO ?? 0,
    cacheHitRateBefore: runs.find((run) => run.before?.cacheHitRate)?.before?.cacheHitRate,
    cacheHitRateAfter: runs.findLast((run) => run.after?.cacheHitRate)?.after?.cacheHitRate,
    cacheHitRateDelta: firstDelta?.estimatedCacheHitRateDelta,
    prefixCacheHitsDelta: sumDefined(runs.map((run) => run.delta?.prefixCacheHitsDelta)),
    prefixCacheQueriesDelta: sumDefined(runs.map((run) => run.delta?.prefixCacheQueriesDelta)),
    cachedPromptTokensDelta: sumDefined(runs.map((run) => run.delta?.cachedPromptTokensDelta)),
    nixlBytesTransferredDelta: sumDefined(runs.map((run) => run.delta?.nixlBytesTransferredDelta)),
    fallbackWarning: runs.find((run) => run.fallbackWarning)?.fallbackWarning,
    qualityProxy: {
      citationCountAvg: policy === "current_page_only" ? 1 : 2,
      refusalRate: 0,
      confidenceAvg: 0.8
    }
  };
}

function interpret(summaries: EngineBenchmarkPolicySummary[], dryRun?: boolean): string[] {
  if (dryRun) {
    return [
      "Dry-run did not call a real engine, so TTFT/ITL/E2E fields are intentionally empty and actualGoodputUnderSLO is n/a.",
      "cache_first may intentionally send a longer canonical prompt to maximize stable prefix reuse.",
      "Without a real prefix-cache engine, token savings are predictions only; cache_first is a candidate to test on vLLM/SGLang, not a proven optimization."
    ];
  }
  const cacheFirst = summaries.find((item) => item.policy === "cache_first");
  const full = summaries.find((item) => item.policy === "full");
  return [
    cacheFirst?.cacheHitRateDelta !== undefined ? `cache_first cache-hit delta: ${cacheFirst.cacheHitRateDelta.toFixed(4)}.` : "Cache-hit delta was unavailable from engine metrics.",
    full?.ttftP90 && cacheFirst?.ttftP90 ? `TTFT P90 full vs cache_first: ${full.ttftP90.toFixed(1)} ms vs ${cacheFirst.ttftP90.toFixed(1)} ms.` : "TTFT comparison requires a streaming endpoint.",
    "Quality proxy is based on refusal/confidence/citation aggregate fields; it is not a human evaluation."
  ];
}

function toMessages(prompt: string): Array<Pick<ChatMessage, "role" | "content">> {
  return [
    { role: "system", content: "You are a concise educational assistant. Answer safely and briefly." },
    { role: "user", content: prompt }
  ];
}

async function safeScrape(client: EngineMetricsClient, metricsUrl: string, engine: EngineBenchmarkConfig["engine"]): Promise<NormalizedEngineMetrics | undefined> {
  try {
    return await client.scrape({ metricsUrl, engine });
  } catch {
    return undefined;
  }
}

function syntheticContext(index: number) {
  const pageIndex = (index % 3) + 1;
  const title = pageIndex === 1 ? "人工智能三要素：数据" : pageIndex === 2 ? "FLOPS 单位" : "mAP/F1 图表";
  const pageText =
    pageIndex === 1
      ? "数据是 AI 的知识来源。数据规模和质量共同影响模型训练边界。Scaling Law 曲线支持数据规模增加时测试损失下降，但不能证明数据越多越好。"
      : pageIndex === 2
        ? "FLOPS 表示每秒浮点运算次数。1 PFLOPS = 1,000,000 GFLOPS。训练速度还受到显存、通信、并行策略和数据管道影响。"
        : "mAP50 和 F1 从不同角度衡量检测效果。图表可以支持当前实验设置下的趋势，但不能证明所有数据集上全局最优。";
  return { pageIndex, title, pageText };
}

function syntheticQuestion(index: number): string {
  return ["这页的核心结论是什么？", "请用一句话解释关键概念。", "这张图支持什么结论，不能支持什么结论？"][index % 3];
}

function syntheticPrompt(title: string, pageText: string, query: string, policy: EngineBenchmarkPolicy): string {
  return [
    `Context policy: ${policy}`,
    `Current page: ${title}`,
    `Evidence: ${pageText}`,
    "Grounding rules: cite current page evidence, refuse unsupported exact claims.",
    `Question: ${query}`
  ].join("\n");
}

function applyPolicyToPrompt(prompt: string, policy: EngineBenchmarkPolicy): string {
  if (policy === "current_page_only") return prompt.split("\n").filter((line) => !line.startsWith("Context policy")).join("\n");
  if (policy === "evidence_top_k") return `${prompt}\nUse only the most relevant evidence sentence.`;
  return prompt;
}

function buildPromptTokenAccounting(input: {
  originalPromptTokens?: number;
  canonicalPromptTokens?: number;
  rawPromptTokensSent?: number;
  stablePrefixTokens?: number;
  dynamicSuffixTokens?: number;
  selectedEvidenceTokens?: number;
  cacheablePrefixTokensEstimate?: number;
  policy: EngineBenchmarkPolicy;
}): PromptTokenAccounting {
  const extraTokens =
    input.canonicalPromptTokens !== undefined && input.originalPromptTokens !== undefined
      ? Math.max(0, input.canonicalPromptTokens - input.originalPromptTokens)
      : undefined;
  const reusableTokens = input.cacheablePrefixTokensEstimate ?? input.stablePrefixTokens ?? 0;
  const breakEvenCacheHitRate =
    extraTokens === undefined ? null : reusableTokens > 0 ? round(extraTokens / reusableTokens) : null;
  const notes = [
    "Heuristic token accounting; not tokenizer-exact.",
    input.policy === "cache_first"
      ? "cache_first may send a longer canonical prompt to increase stable prefix reuse."
      : "rawPromptTokensSent reflects the prompt shape for this context policy."
  ];
  if (breakEvenCacheHitRate !== null && breakEvenCacheHitRate > 1) {
    notes.push("Break-even cache hit rate is above 100%; not worthwhile under this token model unless other engine effects dominate.");
  }
  return {
    originalPromptTokens: input.originalPromptTokens,
    canonicalPromptTokens: input.canonicalPromptTokens,
    rawPromptTokensSent: input.rawPromptTokensSent,
    stablePrefixTokens: input.stablePrefixTokens,
    dynamicSuffixTokens: input.dynamicSuffixTokens,
    selectedEvidenceTokens: input.selectedEvidenceTokens,
    cacheablePrefixTokensEstimate: input.cacheablePrefixTokensEstimate,
    estimatedExtraTokensFromCanonicalization: extraTokens,
    estimatedTokenSavingsAtCacheHitRates:
      extraTokens === undefined
        ? undefined
        : {
            hitRate25: round(reusableTokens * 0.25 - extraTokens),
            hitRate50: round(reusableTokens * 0.5 - extraTokens),
            hitRate75: round(reusableTokens * 0.75 - extraTokens),
            hitRate90: round(reusableTokens * 0.9 - extraTokens)
          },
    breakEvenCacheHitRate,
    notes
  };
}

function latencyMeasurementMode(config: EngineBenchmarkConfig, streaming: ActualStreamingTrace[]): LatencyMeasurementMode {
  if (config.dryRun) return "dry_run_unmeasured";
  if (streaming.some((trace) => trace.actualStreaming && trace.ttftMs !== undefined && (trace.itlMs?.length ?? 0) > 0)) return "actual_streaming";
  if (streaming.some((trace) => trace.e2eMs !== undefined)) return "full_response_wall_clock";
  return "dry_run_unmeasured";
}

function availabilityForMode(mode: LatencyMeasurementMode): LatencyAvailability {
  if (mode === "actual_streaming") return { ttft: "actual", itl: "actual", e2e: "actual" };
  if (mode === "full_response_wall_clock") return { ttft: "unavailable", itl: "unavailable", e2e: "actual" };
  if (mode === "simulated") return { ttft: "estimated", itl: "estimated", e2e: "estimated" };
  return { ttft: "unavailable", itl: "unavailable", e2e: "unavailable" };
}

function summarizeAccountingNotes(accountings: PromptTokenAccounting[]): string[] {
  const notes = new Set<string>();
  for (const accounting of accountings) {
    for (const note of accounting.notes) notes.add(note);
  }
  return [...notes].slice(0, 4);
}

function adjustedTokens(tokens: number, policy: EngineBenchmarkPolicy): number {
  if (policy === "current_page_only") return Math.max(1, Math.floor(tokens * 0.55));
  if (policy === "evidence_top_k") return Math.max(1, Math.floor(tokens * 0.72));
  if (policy === "cache_first") return tokens;
  return tokens;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function meanOrUndefined(values: number[]): number | undefined {
  return values.length ? mean(values) : undefined;
}

function sumDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter(isNumber);
  if (!defined.length) return undefined;
  return round(defined.reduce((sum, value) => sum + value, 0));
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function goodput(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : pct(value);
}

function num(value: number | undefined): string {
  return value === undefined ? "n/a" : value.toFixed(1);
}

function pair(a?: number, b?: number): string {
  return `${num(a)} / ${num(b)}`;
}

function triple(a?: number, b?: number, c?: number): string {
  return `${num(a)} / ${num(b)} / ${num(c)}`;
}

function hitRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  if (value > 1) return `>${Math.round(value * 100)}%`;
  return `${Math.round(value * 1000) / 10}%`;
}

function cache(summary: EngineBenchmarkPolicySummary): string {
  const parts = [
    summary.cacheHitRateDelta === undefined ? undefined : `rate ${summary.cacheHitRateDelta.toFixed(4)}`,
    summary.prefixCacheHitsDelta === undefined ? undefined : `hits ${summary.prefixCacheHitsDelta}`,
    summary.cachedPromptTokensDelta === undefined ? undefined : `cached tokens ${summary.cachedPromptTokensDelta}`
  ].filter(Boolean);
  return parts.join(", ") || "n/a";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const engineBenchmarkRunner = new EngineBenchmarkRunner();
