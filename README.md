# LLM Serving Lab

**LLM Inference Service Research Platform** - PD Separation, Scheduler, Token Estimation, Cache Optimization

[![Node.js >=24.0.0](https://img.shields.io/badge/node-%3E%3D24.0.0-brightgreen)](https://nodejs.org/)

## Overview

LLM Serving Lab is a research platform for studying and optimizing Large Language Model (LLM) inference serving. It provides comprehensive simulation, benchmarking, and calibration tools for modern serving architectures.

### Key Features

- **Prefill/Decode (PD) Separation Simulation** - Model disaggregated serving with hierarchical KV cache transfer
- **Continuous Batching Scheduler** - Iteration-level scheduling with FCFS, SJF, and SLO-aware policies
- **Exact Token Estimation** - BPE-based token counting with tiktoken integration
- **Cache-Aware Prompt Builder** - Prefix caching optimization with hash-based cache keys
- **DeepSeek Latency Prober** - Real API benchmarking with streaming metrics (TTFT, ITL, TPOT, E2E)
- **Simulator Calibration** - Four-stage calibration pipeline for accuracy validation

## Architecture

```
Request → PromptBuilding → TokenEstimation → Scheduling → Simulation → TraceCollection → Report
```

### Core Modules

| Module | Description |
|--------|-------------|
| `EnhancedPDServingSimulator` | PD separation with KV transfer modeling |
| `ContinuousBatchingScheduler` | Dynamic batching with multiple policies |
| `ExactTokenEstimator` | Accurate BPE token estimation |
| `CacheAwarePromptBuilder` | Semantic deduplication + cache keys |
| `DeepSeekLatencyProber` | Real API latency measurement |
| `CalibrationPipeline` | Simulator accuracy calibration |

## Installation

```bash
npm install
```

## Quick Start

### Run PD Simulation

```bash
npm run simulate
```

### Generate Full Report

```bash
npm run report
```

### Run with DeepSeek Benchmark

```bash
DEEPSEEK_API_KEY=your_api_key npm run report:full
```

### UI Server

```bash
npm run ui
# Visit http://127.0.0.1:4173
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run simulate` | Run PD separation simulation |
| `npm run benchmark` | Run engine benchmark (dry-run) |
| `npm run calibrate` | Run calibration pipeline |
| `npm run report` | Generate full research report |
| `npm run report:full` | Full report with DeepSeek API |
| `npm run verify` | Run tests + generate report |
| `npm test` | Run test suite |
| `npm run ui` | Start UI server |

### Test Commands

| Command | Description |
|---------|-------------|
| `npm run test:serving` | Serving module tests |
| `npm run test:enhanced-pd` | Enhanced PD simulator tests |
| `npm run test:continuous-batching` | Scheduler tests |
| `npm run test:exact-token` | Token estimator tests |
| `npm run test:pd-infra` | All PD infrastructure tests |

## API Endpoints

### Serving Simulation

```
POST /api/v1/simulate       - Execute PD simulation
POST /api/v1/compare        - Compare PD strategies
POST /api/v1/pipeline       - End-to-end processing
GET  /api/v1/report         - Get simulation report
GET  /api/v1/calibration   - Get calibration results
GET  /api/v1/dashboard      - Dashboard data
```

### Legacy Endpoints

```
POST /api/serving/simulate  - Legacy PD simulation
POST /api/serving/replay     - Engine replay
GET  /api/serving/traces     - Serving traces
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DEEPSEEK_API_KEY` | DeepSeek API key for benchmarking | - |
| `PORT` | UI server port | 4173 |
| `SERVING_OPTIMIZATION_MODE` | Serving mode: off/observe_only/adaptive | observe_only |
| `SERVING_SLO_TTFT_MS` | TTFT SLO target (ms) | 1000 |
| `SERVING_SLO_TPOT_MS` | TPOT SLO target (ms) | 100 |

### SLO Targets

| Metric | Target | Tolerance |
|--------|--------|-----------|
| TTFT (Time To First Token) | 1000ms | ±15% |
| TPOT (Time Per Output Token) | 100ms | ±10% |
| Throughput | Variable | ±20% |

## DeepSeek API Benchmarking

Run real API latency measurements:

```bash
export DEEPSEEK_API_KEY="your_api_key"
npm run benchmark:deepseek
```

### Measured Metrics

- **TTFT** - Time To First Token
- **ITL** - Inter-Token Latency array
- **TPOT** - Time Per Output Token
- **E2E** - End-to-End latency
- **Throughput** - Tokens per second

### Test Scenarios

| Input Tokens | Output Tokens | Concurrency |
|--------------|---------------|-------------|
| 128 | 128 | 1, 5, 10 |
| 512 | 128, 512 | 1, 5 |
| 2048 | 128, 512 | 1 |
| 4096 | 128 | 1 |

## Calibration

Four-stage calibration pipeline:

1. **Component Calibration** - Prefill throughput, decode latency, chunked prefill
2. **Scheduling Calibration** - FCFS fairness, SJF priority, SLO-aware boundaries
3. **Cache Calibration** - Hash collision rate, block reuse gains
4. **E2E Validation** - Simulator vs real API comparison

```bash
npm run calibrate
```

Results saved to: `reports/calibration-report.md`

## Project Structure

```
LEARN_AGENT/
├── src/agents/learningAssistant/
│   └── serving/
│       ├── ServingPipeline.ts          # End-to-end pipeline
│       ├── EnhancedPDServingSimulator.ts # PD separation model
│       ├── ContinuousBatchingScheduler.ts # Dynamic batching
│       ├── ExactTokenEstimator.ts       # Token counting
│       ├── CacheAwarePromptBuilder.ts   # Cache optimization
│       ├── benchmark/
│       │   └── DeepSeekLatencyProber.ts # API benchmarking
│       └── calibration/
│           └── CalibrationPipeline.ts   # Simulator calibration
├── examples/
│   └── learning-assistant-ui/
│       └── server.ts                    # API server
├── scripts/
│   └── generate-full-report.ts         # Report generator
├── tests/
│   └── serving/
│       ├── pipeline/                    # Pipeline tests
│       └── calibration/                 # Calibration tests
└── reports/
    ├── deepseek-latency-baseline.json  # Benchmark data
    └── calibration-report.md           # Calibration report
```

## Research Topics

### PD Separation

- Hierarchical KV cache transfer modeling
- Chunked prefill scheduling (SARATHI-style)
- Heterogeneous resource allocation

### Scheduling

- Iteration-level continuous batching
- FCFS, SJF, SLO-aware policies
- Priority inversion handling

### Caching

- Semantic prompt deduplication
- Hash-based cache keys
- Block reuse optimization

## License

Private research platform.

## Contributing

See internal documentation for contribution guidelines.
