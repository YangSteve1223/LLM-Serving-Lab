# PD-Aware Serving Lab

## What Prefill And Decode Mean

LLM inference has two broad phases:

- Prefill: the model reads the prompt/context and builds the internal KV cache. Long course context, PPT pages, teacher scripts, outlines, and retrieved evidence mainly affect this phase.
- Decode: the model generates output tokens one by one. Long answers mainly affect this phase.

Real Prefill-Decode disaggregation usually needs an inference stack such as vLLM or another local serving runtime with KV cache transfer. This repository does not claim to run real disaggregated GPU serving yet. The current implementation is a trace-driven simulator and context-budget observability layer.

## Why This Project Is A Good Workload

Learning Assistant requests are context-heavy. A single answer can combine:

- current PPT page text
- teacher script or speaker notes
- deck outline
- neighbor pages
- learner profile
- chat history
- local wiki/RAG evidence

That makes prefill cost visible and tunable. The same material/page can also generate repeated learner questions, which makes cacheable prefix estimation useful for future KV reuse experiments.

## What Is Measured

The system records real wall-clock timings for local phases and full-response LLM calls:

- context analysis
- question analysis
- policy planning
- retrieval
- evidence selection
- answerability
- prompt build
- LLM wall-clock latency when a provider is called
- total request time

The system estimates, but does not directly measure, these serving metrics:

- simulated TTFT
- simulated TPOT/ITL
- estimated prefill token cost
- estimated decode token cost
- estimated KV transfer overhead
- cacheable prefix tokens

These estimates are deterministic heuristics. They are useful for comparing workload shapes and optimization policies, not for claiming real GPU performance.

## API Usage

Start the UI server:

```bash
npm run ui
```

Ask a few questions through the UI or `/api/ask`, then inspect recent traces:

```bash
curl "http://127.0.0.1:4173/api/serving/traces?limit=20"
```

Run a simulation from recent traces:

```bash
curl -X POST "http://127.0.0.1:4173/api/serving/simulate" ^
  -H "content-type: application/json" ^
  -d "{\"source\":\"recent_traces\",\"qps\":2,\"slo\":{\"ttftMs\":800,\"tpotMs\":80,\"e2eMs\":8000},\"prefillWorkers\":1,\"decodeWorkers\":1}"
```

Run a synthetic CLI workload:

```bash
npm run simulate:pd
```

Outputs:

- `reports/serving-traces.jsonl`
- `reports/pd-simulation.json`
- `reports/pd-simulation.md`

## Optimization Modes

`SERVING_OPTIMIZATION_MODE=observe_only` is the default. It records traces and returns budget suggestions without changing answer behavior.

`SERVING_OPTIMIZATION_MODE=adaptive` applies conservative context budget actions, such as keeping top evidence or current-page evidence. It does not remove citation metadata, and it avoids aggressive compression for formulas, budgets, precise numeric questions, and course-grounded answers.

`SERVING_OPTIMIZATION_MODE=off` leaves only basic trace generation.

## Simulator Policies

- `monolithic_shared`: prefill and decode share one worker pool, with a simple interference penalty.
- `pd_disaggregated`: prefill workers and decode workers are separated, with a KV transfer step between phases.
- `hybrid`: a simplified SLO-aware policy that applies cache-aware prefill and decode-risk ordering.

## Reading The Report

Use the report to compare:

- TTFT P50/P90/P99: estimated time before first output token.
- TPOT/ITL P50/P90/P99: estimated per-token decode time.
- E2E P50/P90/P99: estimated end-to-end latency.
- Goodput: fraction of requests satisfying the configured SLO.
- Utilization: simplified worker busy-time estimate.
- KV transfer: estimated overhead between prefill and decode.

## Next Research Steps

1. Add exact tokenizer support for the target model.
2. Extend `LLMClient` with streaming to measure true TTFT and inter-token latency.
3. Connect to local vLLM or LMCache-style disaggregated prefill.
4. Use real course QA traces for SLO-aware context budgeting.
5. Produce paper-style experiment tables for serving policy comparisons.

## Simulator vs Real Engine Bridge

The PD simulator remains a what-if tool: it estimates TTFT, TPOT/ITL, queueing, utilization, and KV-transfer overhead from trace token counts and configurable coefficients.

The SOTA Engine Bridge is the optional real-engine path. It can call an OpenAI-compatible streaming endpoint, scrape vLLM/SGLang Prometheus metrics, and compare context policies with real TTFT/ITL/E2E when the endpoint supports SSE streaming. Without a GPU endpoint, `npm run benchmark:engine` still runs in dry-run mode and reports workload/prompt statistics only.

Use the simulator to explore scheduling and SLO hypotheses. Use the engine bridge to calibrate those hypotheses against actual vLLM/SGLang behavior.
