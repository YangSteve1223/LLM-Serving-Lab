# PD-Aware Synthetic Serving Simulation

Measurement mode: simulated.

This report is produced by a simplified trace-driven simulator. These are trace-driven what-if estimates, not real GPU measurements. TTFT, TPOT/ITL, estimatedGoodputUnderSLO, utilization, and KV-transfer values are estimated from heuristic token counts and configured coefficients; they are not real GPU or remote API measurements.

| Policy | Requests | estimatedGoodputUnderSLO | TTFT P50/P90/P99 ms | TPOT P50/P90/P99 ms | E2E P50/P90/P99 ms | Utilization |
| --- | ---: | ---: | --- | --- | --- | --- |
| monolithic_shared | 200 | 0.5% | 351155.1 / 637708.5 / 703131.9 | 21.7 / 22.1 / 22.3 | 358404.6 / 644958 / 705586.3 | mono 106.9% |
| pd_disaggregated | 200 | 1.5% | 1475.3 / 2409.6 / 2644.9 | 18.4 / 18.7 / 18.9 | 273975.5 / 492830.6 / 538964.6 | prefill 9.6%, decode 109.1% |
| hybrid | 200 | 1% | 250.3 / 373.1 / 403.6 | 18.4 / 18.7 / 18.9 | 385058.1 / 552749.7 / 553309.7 | prefill 8%, decode 107.9% |

## Why Estimated Goodput Can Be Low

- This synthetic scenario can overload the decode side depending on qps, worker count, and token mix.
- PD-style separation can improve TTFT while E2E remains poor if decode workers are saturated.
- Treat this as a what-if stress scenario, not a claim about real GPU performance.

## Notes

- monolithic_shared: Simplified shared-pool baseline: prefill and decode contend on the same workers with an interference penalty.
- pd_disaggregated: Simplified trace-driven PD simulator: prefill queue, KV transfer, then decode queue. TTFT includes estimated prefill plus KV transfer overhead.
- hybrid: Simplified hybrid policy: cache-aware prefill and SLO-aware decode prioritization are approximated deterministically. This is not a reproduction of any specific paper; it is for workload-level what-if analysis.

