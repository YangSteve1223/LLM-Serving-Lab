# SOTA Engine Bridge

This project is not a replacement for vLLM or SGLang. The education agent provides a realistic context-heavy workload: current PPT page, teacher script, outline, learner profile, chat history, selected evidence, and grounding rules. vLLM/SGLang provide the real serving engine.

The bridge adds an optional benchmark harness around that workload:

- OpenAI-compatible streaming `/v1/chat/completions` client.
- Real TTFT, ITL/TPOT, and E2E latency when the endpoint supports SSE streaming.
- Prometheus `/metrics` scraping for vLLM and SGLang.
- Cache-aware prompt canonicalization for prefix caching and RadixAttention style reuse.
- Trace replay across `full`, `evidence_top_k`, `current_page_only`, and `cache_first` context policies.

## Example vLLM Setup

Reference only; this repository does not require a GPU to run tests.

```bash
vllm serve <model> --enable-prefix-caching --host 127.0.0.1 --port 8000
```

Then run:

```bash
BASE_URL=http://127.0.0.1:8000/v1 MODEL=<model> npm run benchmark:vllm
```

If metrics are exposed:

```bash
node scripts/run-engine-benchmark.ts --engine vllm --base-url http://127.0.0.1:8000/v1 --metrics-url http://127.0.0.1:8000/metrics --model <model> --source synthetic --requests 50 --qps 1 --concurrency 4 --policies full,evidence_top_k,current_page_only,cache_first --stream
```

## Example SGLang Setup

Reference only:

```bash
python -m sglang.launch_server --model-path <model> --host 127.0.0.1 --port 8000 --enable-metrics
```

Then run:

```bash
BASE_URL=http://127.0.0.1:8000/v1 MODEL=<model> npm run benchmark:sglang
```

## How To Run This Later With Borrowed GPU

These commands are reference examples only. They are not required for final verification.

For vLLM, start a single OpenAI-compatible endpoint with prefix caching enabled:

```bash
vllm serve <model> --enable-prefix-caching --host 127.0.0.1 --port 8000
```

Then run:

```bash
BASE_URL=http://127.0.0.1:8000/v1 MODEL=<model> npm run benchmark:vllm
```

For SGLang, start an endpoint with metrics enabled:

```bash
python -m sglang.launch_server --model-path <model> --host 127.0.0.1 --port 8000 --enable-metrics
```

Then run:

```bash
BASE_URL=http://127.0.0.1:8000/v1 MODEL=<model> npm run benchmark:sglang
```

If the endpoint does not stream, TTFT/ITL remain unavailable. If `/metrics` is unavailable, prefix-cache and engine queue metrics remain unavailable. The dry-run benchmark is still useful for workload and prompt accounting checks.

## Offline Dry Run

No endpoint is required:

```bash
npm run benchmark:engine
```

This writes:

- `reports/engine-benchmark.json`
- `reports/engine-benchmark.md`

Dry-run reports include workload shape and prompt component statistics only. TTFT/ITL/E2E are intentionally empty.

## Metrics

- TTFT: request start to first generated token. Real only for streaming endpoints.
- ITL/TPOT: inter-token latency from streaming chunk timestamps.
- E2E: request start to final chunk or full response end.
- Prefix cache hit rate: parsed from engine metrics when exposed.
- `prompt_tokens_cached`: parsed for vLLM when available.
- Goodput under SLO: fraction of requests meeting TTFT, TPOT, and E2E thresholds.
- Quality proxy: aggregate confidence/refusal/citation stats. It is not human grading.

## Limitations

- If an endpoint falls back to full response, real TTFT/ITL are unavailable and the report marks `actualStreaming=false`.
- Prometheus histograms are parsed locally; accurate fleet-level quantiles should still be computed by Prometheus in production.
- OpenAI-compatible usage tokens may not match the engine tokenizer.
- Without a GPU endpoint, only dry-run and the existing simulator are available.
- Cache-aware prompt canonicalization defaults to observe-only and should be validated against answer quality before applying in production.

## Next Steps

1. Run vLLM/SGLang on a single GPU and collect repeated-prefix education traces.
2. Compare `full` vs `cache_first` prompt layout under prefix caching.
3. Calibrate the PD simulator from `reports/engine-benchmark.json`.
4. If two GPUs are available, evaluate vLLM/LMCache or SGLang disaggregated prefill/decode.
5. Convert the report into research-style tables with confidence intervals.
