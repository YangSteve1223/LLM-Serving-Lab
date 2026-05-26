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

## Enhanced PD Simulator (feat/pd-infra)

The enhanced PD simulator (`src/agents/learningAssistant/serving/EnhancedPDServingSimulator.ts`) adds advanced cost modeling:

### Key Features

1. **Hierarchical KV Cache Transfer Modeling**
   - Layer-by-layer pipelined KV transfer simulation
   - Model-specific KV size estimation (e.g., Llama-70B: 0.64MB/token/layer)
   - Bandwidth-aware transfer time calculation

2. **Chunked Prefill Scheduling (SARATHI-style)**
   - Breaks long prefill into configurable chunks (default: 512 tokens)
   - Eliminates head-of-line blocking
   - Better GPU utilization through interleaving

3. **Heterogeneous Resource Allocation**
   - Prefill: compute-heavy GPU allocation
   - Decode: memory-heavy GPU allocation
   - Configurable budget ratios

### Usage

```typescript
import { EnhancedPDServingSimulator } from './serving/index.ts';

const simulator = new EnhancedPDServingSimulator({
  modelName: 'llama-70b',
  numLayers: 80,
  kvSizePerTokenMB: 0.64,
  chunkedPrefill: { enabled: true, chunkSize: 512, allowInterleaving: true },
  prefillBudgetRatio: 0.4,
  decodeBudgetRatio: 0.6
});

// Run enhanced simulation
const result = simulator.simulateEnhancedPD(workload);

// Compare policies
const results = simulator.compareEnhancedPolicies(workload);
```

## Continuous Batching Scheduler

The continuous batching scheduler (`src/agents/learningAssistant/serving/ContinuousBatchingScheduler.ts`) provides iteration-level scheduling:

### Features

- **Three scheduling policies**: FCFS, SJF, SLO-aware
- **Dynamic request management**: Add/remove requests from batch at each step
- **SLO-aware decisions**: TTFT/TPOT/E2E constraints
- **Integration with PD Simulator**: Validate scheduling policies

### Usage

```typescript
import { ContinuousBatchingScheduler } from './serving/index.ts';

const scheduler = new ContinuousBatchingScheduler();

scheduler.configure({
  maxBatchSize: 16,
  stepBudgetMs: 100,
  policy: 'slo_aware'
});

// Run scheduling simulation
const result = scheduler.runScheduling(workload, 'slo_aware');

// Compare all policies
const results = scheduler.comparePolicies(workload);
```

## Exact Token Estimator

The exact token estimator (`src/agents/learningAssistant/serving/ExactTokenEstimator.ts`) provides multiple tokenization methods:

### Features

- **Heuristic estimation**: Original method
- **BPE tokenization**: Lightweight byte-pair encoding
- **Tiktoken-style**: Approximated tiktoken behavior
- **Model-specific**: GPT-4, LLaMA, etc.
- **Comparison interface**: Error analysis across methods

### Usage

```typescript
import { ExactTokenEstimator, estimateTokensExact } from './serving/index.ts';

// Quick estimation
const count = estimateTokensExact('Hello world', 'tiktoken');

// Full comparison
const estimator = new ExactTokenEstimator({ estimatorType: 'tiktoken' });
const comparison = estimator.compare('Your text here');
```

## Report Rendering

Enhanced reports with detailed analysis:

```typescript
import { 
  renderEnhancedPDReport,
  renderContinuousBatchingReport,
  renderKVTransferAnalysis,
  renderChunkedPrefillAnalysis
} from './serving/index.ts';

// Generate reports
const pdReport = renderEnhancedPDReport(results, config);
const cbReport = renderContinuousBatchingReport(cbResults);
const kvAnalysis = renderKVTransferAnalysis(80, 0.64, 1000, 50);
```

## Testing

Run the PD-infra tests:

```bash
npm run test:pd-infra    # All new tests
npm run test:enhanced-pd  # Enhanced simulator tests
npm run test:continuous-batching # Scheduler tests
npm run test:exact-token  # Token estimator tests
```
