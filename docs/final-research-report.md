# LEARN_AGENT: A Cache-Aware and PD-Aware Educational Agent Serving Lab

## 1. Abstract

LEARN_AGENT is not a production serving engine. It is an educational-agent workload and research harness for studying application-level workload shaping for LLM serving. The system begins with a PPT-aware learning assistant, then adds safe serving traces, heuristic token accounting, context budget planning, cache-aware prompt canonicalization, a trace-driven PD simulator, and an optional bridge to vLLM/SGLang/OpenAI-compatible endpoints. Without a GPU endpoint, it does not claim real PD disaggregation or real engine SLO results.

## 2. Motivation

Educational agents are context-heavy. A single answer may depend on the current slide, teacher script, course outline, learner profile, chat history, retrieved evidence, citation rules, and grounding policy. This structure creates high prefill cost, but it also creates repeated stable prefixes across many questions from the same lesson. That makes education-agent workloads naturally relevant to prefix caching, prompt canonicalization, and prefill/decode optimization.

The project owner currently has limited hardware access, so the project deliberately separates what is actual, estimated, simulated, and unavailable. Trace-driven simulation and an optional engine bridge provide a realistic path from local research artifact to future GPU-backed experiments.

## 3. System Overview

The system has six layers:

| Layer | Role | Key files |
| --- | --- | --- |
| Education agent core | Understand learning context, retrieve evidence, decide answerability, generate grounded answers. | `LearningAssistantAgent.ts`, `types.ts` |
| Serving trace layer | Record phase latency, token estimates, selected evidence cost, and safe request metadata. | `ServingTrace.ts`, `PhaseTimer.ts`, `TokenEstimator.ts`, `RequestTraceStore.ts` |
| PD-aware simulator | Compare monolithic, disaggregated, and hybrid serving policies with deterministic what-if metrics. | `PDServingSimulator.ts`, `PDReportRenderer.ts` |
| Context budget planner | Suggest safer lower-prefill policies without silently weakening grounding. | `ContextBudgetPlanner.ts` |
| Cache-aware prompt canonicalization | Split prompt into stable prefix and dynamic suffix, hash components, and estimate cache reuse. | `CacheAwarePromptBuilder.ts`, `PromptComponentHasher.ts` |
| SOTA engine bridge | Optionally replay workloads against vLLM/SGLang/OpenAI-compatible endpoints and parse metrics. | `StreamingOpenAICompatibleClient.ts`, `EngineMetricsClient.ts`, adapters |

## 4. Education Agent Workload

The agent differs from a plain chatbot because it is embedded in a learning context. It sees material pages, teacher scripts, outlines, learner state, chat history, and local wiki evidence. It also produces structured outputs: citations, confidence, decision trace, generation debug, evidence debug, retrieval debug, and answer generation mode.

Grounding is central. Formula, budget, exact numeric, experiment, and proper-noun definition questions require clear evidence. If evidence is insufficient, the system should refuse or ask for clarification instead of inventing.

## 5. Serving Trace Layer

The trace layer records performance-relevant structure without storing private content. It tracks local phase timings such as context analysis, question analysis, retrieval, evidence selection, answerability, prompt build, LLM wall-clock, and total latency. It also records token estimates for current page, teacher script, outline, neighbor pages, knowledge base evidence, prefill, decode, cacheable prefix, and non-cacheable suffix.

Traces do not persist raw prompts, raw answers, or API keys. Query identity is represented by hash, and evidence cost is aggregated by source type.

## 6. PD-aware Simulator

The PD simulator is a simplified deterministic what-if model. It accepts synthetic requests or real traces converted into workload items with arrival time, prefill tokens, decode tokens, and cacheable prefix tokens.

It compares:

| Policy | Meaning |
| --- | --- |
| `monolithic_shared` | Prefill and decode share the same worker pool and contend for resources. |
| `pd_disaggregated` | Prefill queue, estimated KV transfer, then decode queue. |
| `hybrid` | Simplified cache-aware prefill and SLO-aware decode prioritization. |

The simulator reports estimated TTFT, TPOT/ITL, E2E latency, utilization, queueing, and estimatedGoodputUnderSLO. These are trace-driven estimates, not real GPU measurements.

## 7. Cache-aware Prompt Canonicalization

Cache-aware prompt canonicalization asks: can the application assemble prompts so repeated lesson context becomes byte-stable and reusable by prefix caching engines?

The prompt is split into components such as system rules, course policy, material outline, current page, teacher script, selected evidence, learner profile, chat history, question, and output contract. Stable components should form a stablePrefixHash that does not change across questions on the same page. Dynamic components stay in the suffix.

`cache_first` may send more tokens in one request because it uses a canonical layout. That is not automatically good. The report therefore includes originalPromptTokens, canonicalPromptTokens, rawPromptTokensSent, stablePrefixTokens, dynamicSuffixTokens, cacheablePrefixTokensEstimate, estimated savings at cache hit rates, and break-even cache hit rate.

## 8. SOTA Engine Bridge

The bridge does not replace vLLM or SGLang. It lets the same educational-agent workload be replayed against real engines later.

It includes:

- an OpenAI-compatible streaming client for `/v1/chat/completions`;
- SSE parsing for `data:` chunks and `[DONE]`;
- client-observed TTFT, ITL/TPOT, and E2E metrics when streaming works;
- fallback to full response wall-clock without inventing TTFT/ITL;
- Prometheus metrics parsing;
- vLLM and SGLang metric adapters;
- replay benchmark policies: full, evidence_top_k, current_page_only, cache_first.

## 9. Metrics: Actual vs Estimated vs Simulated vs Unavailable

| Metric | Current default source | Meaning |
| --- | --- | --- |
| Application trace latency | Actual local wall-clock | Measured around TypeScript pipeline phases. |
| Token estimates | Heuristic | Deterministic approximation, not tokenizer-exact. |
| Dry-run TTFT/ITL/E2E | Unavailable | No endpoint is called. |
| Streaming TTFT/ITL/E2E | Actual client-observed | Available only with streaming endpoint. |
| vLLM/SGLang cache metrics | Actual engine metrics | Available only if `/metrics` is running and exposes relevant names. |
| PD simulation | Simulated/estimated | What-if model from token counts and coefficients. |
| Quality proxy | Heuristic | Confidence/refusal/citation statistics, not human evaluation. |
| Human answer quality | Not measured | Requires separate rubric or human study. |

## 10. Current Results

The latest verification reports show:

- `npm run test:serving` passes.
- `npm test` passes.
- `npm run simulate:pd` generates estimated/simulated reports.
- `npm run benchmark:engine` passes dry-run with no endpoint.
- `npm run verify:final` passes and performs a safety scan.
- Dry-run latency fields are `n/a` by design.
- Dry-run workload success is not actual SLO goodput.
- Reports do not store raw prompts, raw answers, or API keys.

## 11. Findings

1. The workload has stable page-scoped context, so cache-aware prompt layout is a plausible research direction.
2. PD simulation can show TTFT improvement while E2E remains poor if decode capacity is saturated.
3. `cache_first` requires real prefix-cache validation; dry-run alone cannot prove speedup.
4. `current_page_only` can reduce sent context, but may reduce citation coverage for cross-page or knowledge-base questions.
5. `evidence_top_k` may improve grounding focus, but formatting overhead means token reduction is not guaranteed.

## 12. Limitations

- No GPU endpoint in the current environment.
- No real PD disaggregation experiment yet.
- Token estimation is heuristic.
- Quality proxy is not human evaluation.
- Prometheus histogram interpretation is approximate.
- OpenAI-compatible usage tokens may differ from engine tokenizer.
- Dry-run cannot measure TTFT, ITL, E2E, prefix-cache hit rate, or actual goodput under SLO.

## 13. Future Work

1. Add an exact tokenizer for the target model.
2. Run a small local vLLM or SGLang endpoint on borrowed GPU.
3. Collect repeated-prefix education traces from real lessons.
4. Compare full vs cache_first on real prefix cache metrics.
5. If two GPUs become available, test vLLM/LMCache or SGLang PD disaggregation.
6. Add human evaluation for answer quality and grounding usefulness.
7. Turn simulator-vs-engine differences into a research-style ablation table.

## 14. Conclusion

LEARN_AGENT is ready to freeze as an engineering artifact. The next step is to study the code and the underlying serving systems, then return to experimentation only when real engine hardware is available.
