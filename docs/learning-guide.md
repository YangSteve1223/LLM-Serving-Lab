# LEARN_AGENT Learning Guide

This guide is for the project owner after the final freeze. The goal is to stop adding features for a while and learn the system deeply enough to explain it to a professor, interviewer, or future research collaborator.

## 1. Seven-Day Reading Plan

### Day 1: Education Agent Architecture

Read:

- `examples/learning-assistant-ui/server.ts`
- `src/agents/learningAssistant/LearningAssistantAgent.ts`
- `src/agents/learningAssistant/types.ts`

Focus:

- How `/api/ask` builds context.
- How `LearningAssistantAgent.answer()` separates context analysis, question analysis, learner modeling, policy planning, retrieval, evidence selection, answerability, prompt build, and generation.

Exercise: manually trace one `/api/ask` request from server to response.

### Day 2: Evidence and Grounding

Read:

- `src/agents/learningAssistant/grounding/EvidenceSelector.ts`
- `src/agents/learningAssistant/grounding/AnswerabilityChecker.ts`
- `src/agents/learningAssistant/skills/KnowledgeRetrievalSkill.ts`

Focus:

- Why a learning assistant should refuse unsupported exact claims.
- How citations differ from decorative references.
- Why answerability is a product and safety feature, not just an evaluation field.

Exercise: write one question that should be answered from current page and one that should be refused.

### Day 3: Token Estimation and Serving Trace

Read:

- `src/agents/learningAssistant/serving/TokenEstimator.ts`
- `src/agents/learningAssistant/serving/PhaseTimer.ts`
- `src/agents/learningAssistant/serving/ServingTrace.ts`
- `src/agents/learningAssistant/serving/RequestTraceStore.ts`

Focus:

- Prefill tokens vs decode tokens.
- Cacheable prefix tokens vs non-cacheable tokens.
- Why traces should not store raw prompts, raw answers, or API keys.

Exercise: explain `estimatedPrefillTokens`, `estimatedDecodeTokens`, and `cacheablePrefixTokens` in your own words.

### Day 4: PD Simulator

Read:

- `src/agents/learningAssistant/serving/PDServingSimulator.ts`
- `src/agents/learningAssistant/serving/PDReportRenderer.ts`
- `scripts/run-pd-simulation.ts`

Focus:

- monolithic_shared vs pd_disaggregated vs hybrid.
- Why TTFT can improve while E2E remains bad.
- Why simulated goodput is not real GPU goodput.

Exercise: change qps and worker counts, then explain why decode queue grows or shrinks.

### Day 5: Cache-Aware Prompt Builder

Read:

- `src/agents/learningAssistant/serving/PromptComponentHasher.ts`
- `src/agents/learningAssistant/serving/CacheAwarePromptBuilder.ts`
- `tests/serving/engine/cache-aware-prompt-builder.test.ts`

Focus:

- Stable prefix.
- Dynamic suffix.
- Component hashing.
- Why requestId and timestamp must not enter stable prefix.

Exercise: compare stablePrefixHash under same page/different question.

### Day 6: Engine Bridge

Read:

- `src/agents/learningAssistant/serving/engines/StreamingOpenAICompatibleClient.ts`
- `src/agents/learningAssistant/serving/engines/SSEParser.ts`
- `src/agents/learningAssistant/serving/engines/PrometheusMetricsParser.ts`
- `src/agents/learningAssistant/serving/engines/VllmMetricsAdapter.ts`
- `src/agents/learningAssistant/serving/engines/SglangMetricsAdapter.ts`
- `scripts/run-engine-benchmark.ts`

Focus:

- Why streaming is required for TTFT/ITL.
- Why full-response wall-clock is not equivalent to token-level latency.
- How vLLM/SGLang metrics are best-effort and version-dependent.

Exercise: explain why dry-run has no TTFT.

### Day 7: Research Narrative

Read:

- `docs/final-research-report.md`
- `docs/LEARN_AGENT_项目完整说明书.md`

Exercise: write and rehearse a 5-minute answer to three questions:

1. What problem does this project study?
2. What does it actually measure today?
3. What remains future work?

## 2. Twelve-Week Deep Learning Plan

### Weeks 1-2: Project Body

Topics: TypeScript, Node.js API server, agent pipeline, RAG, evidence, citations.

Exercise: draw the `/api/ask` call chain and annotate where each debug field is produced.

### Weeks 3-4: LLM Serving Basics

Topics: prefill, decode, TTFT, ITL, TPOT, E2E latency, KV cache, batching, queueing, SLO, goodput.

Exercise: run `npm run simulate:pd`, change qps/workers, and write one paragraph about queueing behavior.

### Weeks 5-6: Prefix Caching and Prompt Engineering

Topics: stable prefix, dynamic suffix, prefix cache hit, prompt canonicalization, RadixAttention.

Exercise: compare `full` and `cache_first` in `reports/engine-benchmark.md`; explain why cache_first may send more tokens.

### Weeks 7-8: vLLM and SGLang

Topics: vLLM PagedAttention, continuous batching, chunked prefill, prefix caching metrics, SGLang RadixAttention, SGLang scheduler.

Exercise: read the engine bridge and list which metrics require a real `/metrics` endpoint.

### Weeks 9-10: PD Disaggregation

Topics: DistServe, prefill/decode resource separation, KV transfer, LMCache, NIXL, Mooncake-style KV-cache-centric serving.

Exercise: write a one-page note on why KV transfer can improve resource separation but still add TTFT overhead.

### Weeks 11-12: Research Expression

Topics: experiment reports, actual vs estimated vs simulated, ablation design, benchmark honesty, oral explanation.

Exercise: prepare a 2-minute and 5-minute project presentation. Include one limitation slide.

## 3. Glossary

| Term | Meaning |
| --- | --- |
| Agent | A system that uses context and tools to decide actions and return structured results. |
| RAG | Retrieval-Augmented Generation. |
| Evidence | Source material selected to support an answer. |
| Citation | A visible reference to supporting evidence. |
| Grounding | Keeping answers tied to evidence instead of unsupported generation. |
| Answerability | Whether available context is enough to answer safely. |
| Confidence | A coarse signal about answer reliability. |
| Decision trace | Structured explanation of how the agent chose evidence and policy. |
| Prefill | Processing prompt tokens and building KV cache. |
| Decode | Generating output tokens one by one. |
| TTFT | Time to first token. |
| ITL | Inter-token latency. |
| TPOT | Time per output token. |
| E2E latency | Total request completion time. |
| KV cache | Transformer key/value cache reused during decoding. |
| Prefix caching | Reusing KV cache for repeated prompt prefixes. |
| Stable prefix | Prompt prefix expected to be byte-stable across requests. |
| Dynamic suffix | Request-specific prompt part. |
| Prompt canonicalization | Stable ordering and formatting of prompt components. |
| PagedAttention | vLLM KV-cache paging design. |
| RadixAttention | SGLang prefix-sharing design idea. |
| Continuous batching | Runtime batching of active requests. |
| Chunked prefill | Breaking prefill into chunks for scheduling. |
| PD disaggregation | Separating prefill and decode resources. |
| KV transfer | Moving KV cache from prefill side to decode side. |
| SLO | Service-level objective. |
| Goodput | Fraction of requests that meet SLO; dry-run does not measure actual goodput. |
| vLLM | High-performance LLM inference engine. |
| SGLang | Serving/programming framework with efficient structured generation. |
| LMCache | KV-cache reuse/offload system. |
| NIXL | NVIDIA Inference Xfer Library, often discussed for KV transfer. |
| Prometheus metrics | Text-format monitoring metrics exposed by engines. |
| Dry-run | Workload generation without calling a real endpoint. |
| Simulator | What-if model from assumptions and traces. |
| Quality proxy | Heuristic signals such as citations/confidence/refusal, not human evaluation. |

## 4. Common Pitfalls

- Do not say simulator metrics are real GPU metrics.
- Do not say dry-run goodput is actual goodput.
- Do not say cache_first is faster before running a real prefix-cache engine.
- Do not compare heuristic token estimates directly with exact tokenizer counts.
- Do not optimize context length at the cost of answer grounding.
- Do not claim human answer quality without a human or rubric evaluation.

## 5. Two-Minute Explanation Script

I started from an educational assistant that can read the current PPT page, teacher script, outline, learner profile, chat history, and local evidence. Then I noticed this workload is naturally long-context and repeated: the same lesson page appears across many student questions, so prompt assembly affects prefill cost and prefix cache reuse.

Because I do not currently have GPU resources, I did not fake real PD results. Instead, I built a research harness: safe serving traces, heuristic token accounting, a trace-driven PD simulator, cache-aware prompt canonicalization, and an optional vLLM/SGLang engine bridge. The main research question is how application-level prompt and context design can become cache-aware and PD-aware.

I label dry-run, simulated, estimated, and actual metrics separately. Today the project is a rigorous engineering artifact; with GPU access, the next step is to run the same workload against real vLLM/SGLang endpoints and validate prefix cache and streaming latency metrics.

## 6. Suggested Learning Resources

Study these topics next:

- vLLM PagedAttention and metrics.
- SGLang RadixAttention.
- DistServe and disaggregated serving.
- LMCache and KV cache reuse.
- NIXL and KV transfer.
- Prometheus metrics and SLO analysis.
- Queueing basics for serving systems.
- Experimental design and ablation studies.

## 7. With GPU Later

When a GPU endpoint is available:

1. Start a vLLM or SGLang OpenAI-compatible server with streaming enabled.
2. Enable metrics if supported.
3. Run `BASE_URL=... MODEL=... npm run benchmark:vllm` or `benchmark:sglang`.
4. Compare full vs cache_first on actual TTFT/ITL/E2E and prefix cache metrics.
5. Calibrate the simulator with real benchmark output.
6. Only then discuss real engine performance.
