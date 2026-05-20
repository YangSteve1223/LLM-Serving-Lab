# PD Simulation Results

Initial synthetic run assumptions:

- Source: synthetic Learning Assistant workload
- Requests: 200
- QPS: 4
- SLO: TTFT 800 ms, TPOT 80 ms, E2E 8000 ms
- Workers: 1 prefill, 1 decode, 1 monolithic
- Token counts: deterministic heuristic estimates
- Timing coefficients: default simulator constants

The numbers below are illustrative simulator outputs, not real GPU measurements.

Run:

```bash
npm run simulate:pd
```

Latest generated files:

- `reports/pd-simulation.json`
- `reports/pd-simulation.md`

The generated markdown report contains the current policy comparison table for `monolithic_shared`, `pd_disaggregated`, and `hybrid`.
