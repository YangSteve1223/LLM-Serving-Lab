# SOTA Engine Bridge Benchmark

Generated at: 2026-05-20T06:51:51.279Z

## Engine Config

- Engine: openai-compatible
- Base URL configured: no
- Model: not configured
- Source: synthetic
- Dry run: yes
- Warning: Dry-run validates workload shape and prompt component statistics only. It does not measure real TTFT, ITL, E2E, or SLO goodput.

## Workload Summary

- Requests: 40
- Policies: full, evidence_top_k, current_page_only, cache_first

## Policy Results

| Policy | Requests | Workload success | Measurement mode | Actual goodput under SLO | Sent tokens avg/p90 | Original tokens avg/p90 | Canonical tokens avg/p90 | Stable prefix avg/p90 | Dynamic suffix avg/p90 | Break-even cache hit | TTFT p50/p90/p99 | ITL p50/p90/p99 | E2E p50/p90/p99 | Cache delta | Notes |
| --- | ---: | ---: | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full | 10 | 100% | dry_run_unmeasured | n/a | 83.2 / 88.0 | 83.2 / 88.0 | 630.6 / 642.0 | 377.8 / 385.0 | 125.5 / 130.0 | >145% | n/a / n/a / n/a | n/a / n/a / n/a | n/a / n/a / n/a | n/a | Heuristic token accounting; not tokenizer-exact.; rawPromptTokensSent reflects the prompt shape for this context policy.; Break-even cache hit rate is above 100%; not worthwhile under this token model unless other engine effects dominate. |
| evidence_top_k | 10 | 100% | dry_run_unmeasured | n/a | 96.5 / 101.0 | 86.2 / 91.0 | 630.6 / 642.0 | 377.8 / 385.0 | 125.5 / 130.0 | >144% | n/a / n/a / n/a | n/a / n/a / n/a | n/a / n/a / n/a | n/a | Heuristic token accounting; not tokenizer-exact.; rawPromptTokensSent reflects the prompt shape for this context policy.; Break-even cache hit rate is above 100%; not worthwhile under this token model unless other engine effects dominate. |
| current_page_only | 10 | 100% | dry_run_unmeasured | n/a | 78.5 / 83.0 | 86.9 / 92.0 | 630.6 / 642.0 | 377.8 / 385.0 | 125.5 / 130.0 | >144% | n/a / n/a / n/a | n/a / n/a / n/a | n/a / n/a / n/a | n/a | Heuristic token accounting; not tokenizer-exact.; rawPromptTokensSent reflects the prompt shape for this context policy.; Break-even cache hit rate is above 100%; not worthwhile under this token model unless other engine effects dominate. |
| cache_first | 10 | 100% | dry_run_unmeasured | n/a | 630.6 / 642.0 | 84.9 / 90.0 | 630.6 / 642.0 | 377.8 / 385.0 | 125.5 / 130.0 | >145% | n/a / n/a / n/a | n/a / n/a / n/a | n/a / n/a / n/a | n/a | Heuristic token accounting; not tokenizer-exact.; cache_first may send a longer canonical prompt to increase stable prefix reuse.; Break-even cache hit rate is above 100%; not worthwhile under this token model unless other engine effects dominate. |

## Latency Availability

- full: ttft=unavailable, itl=unavailable, e2e=unavailable, actualGoodputUnderSLO=n/a, estimatedGoodputUnderSLO=n/a
- evidence_top_k: ttft=unavailable, itl=unavailable, e2e=unavailable, actualGoodputUnderSLO=n/a, estimatedGoodputUnderSLO=n/a
- current_page_only: ttft=unavailable, itl=unavailable, e2e=unavailable, actualGoodputUnderSLO=n/a, estimatedGoodputUnderSLO=n/a
- cache_first: ttft=unavailable, itl=unavailable, e2e=unavailable, actualGoodputUnderSLO=n/a, estimatedGoodputUnderSLO=n/a

## Interpretation

- Dry-run did not call a real engine, so TTFT/ITL/E2E fields are intentionally empty and actualGoodputUnderSLO is n/a.
- cache_first may intentionally send a longer canonical prompt to maximize stable prefix reuse.
- Without a real prefix-cache engine, token savings are predictions only; cache_first is a candidate to test on vLLM/SGLang, not a proven optimization.

## Notes

- Reports intentionally exclude raw prompts, raw answers, and API keys.
- Dry-run validates workload shape and prompt component statistics only. It does not measure real TTFT, ITL, E2E, or SLO goodput.
- cache_first may intentionally send a longer canonical prompt to maximize stable prefix reuse; without a real prefix-cache engine, token savings are predicted only.
- OpenAI-compatible usage tokens may differ from the engine tokenizer.
