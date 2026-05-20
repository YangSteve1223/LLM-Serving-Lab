/**
 * Trace-driven Prefill/Decode serving simulator.
 *
 * This is a deterministic what-if model, not a GPU benchmark. It helps reason
 * about queues, TTFT, TPOT, E2E latency, and decode saturation before a real
 * vLLM/SGLang PD setup is available.
 */
import type { PDWorkloadRequest, PDSimulationConfig, PDSimulationResult, ServingPhaseTrace } from "./ServingTrace.ts";

export const DEFAULT_PD_SIM_CONFIG: Required<Omit<PDSimulationConfig, "slo">> = {
  prefillWorkers: 1,
  decodeWorkers: 1,
  monolithicWorkers: 1,
  prefillBaseMs: 25,
  decodeBaseMs: 10,
  kvBaseMs: 5,
  prefillMsPerToken: Number(process.env.SERVING_PREFILL_MS_PER_TOKEN ?? 0.18),
  decodeMsPerToken: Number(process.env.SERVING_DECODE_MS_PER_TOKEN ?? 18),
  kvMsPerToken: Number(process.env.SERVING_KV_MS_PER_TOKEN ?? 0.015),
  interferencePenalty: 1.18
};

type RequestRun = {
  ttft: number;
  tpot: number;
  e2e: number;
  prefillQueue: number;
  decodeQueue: number;
  prefillBusy: number;
  decodeBusy: number;
  monoBusy: number;
};

export class PDServingSimulator {
  simulatePDForTrace(trace: Pick<ServingPhaseTrace, "tokenEstimate">, config: PDSimulationConfig = {}) {
    const cfg = mergeConfig(config);
    const prefillTokens = trace.tokenEstimate.estimatedPrefillTokens;
    const decodeTokens = trace.tokenEstimate.estimatedDecodeTokens;
    const prefillMs = cfg.prefillBaseMs + prefillTokens * cfg.prefillMsPerToken;
    const decodeMs = cfg.decodeBaseMs + decodeTokens * cfg.decodeMsPerToken;
    const kvTransferMs = cfg.kvBaseMs + prefillTokens * cfg.kvMsPerToken;
    return {
      prefillMs: round(prefillMs),
      decodeMs: round(decodeMs),
      kvTransferMs: round(kvTransferMs),
      estimatedTTFTMs: round(prefillMs + kvTransferMs),
      estimatedTPOTMs: decodeTokens > 0 ? round(decodeMs / decodeTokens) : 0,
      note: "simulated/estimated from heuristic token counts and configured coefficients; not real remote API TTFT or ITL"
    };
  }

  comparePolicies(workload: PDWorkloadRequest[], config: PDSimulationConfig = {}): PDSimulationResult[] {
    return [
      this.simulateMonolithic(workload, config),
      this.simulatePDDisaggregated(workload, config),
      this.simulateHybrid(workload, config)
    ];
  }

  tracesToWorkload(traces: ServingPhaseTrace[], qps = 2): PDWorkloadRequest[] {
    const interval = qps > 0 ? 1000 / qps : 500;
    return traces.map((trace, index) => ({
      id: trace.requestId,
      arrivalMs: index * interval,
      prefillTokens: trace.tokenEstimate.estimatedPrefillTokens,
      decodeTokens: Math.max(1, trace.tokenEstimate.estimatedDecodeTokens),
      cacheablePrefixTokens: trace.tokenEstimate.cacheablePrefixTokens,
      priority: "interactive"
    }));
  }

  buildSyntheticWorkload(requestCount: number, qps: number): PDWorkloadRequest[] {
    const interval = qps > 0 ? 1000 / qps : 500;
    return Array.from({ length: requestCount }, (_, index) => {
      const phase = index % 5;
      const prefillTokens = 650 + phase * 280 + (index % 7) * 35;
      const decodeTokens = 70 + (index % 4) * 45 + (phase === 4 ? 120 : 0);
      return {
        id: `synthetic-${index + 1}`,
        arrivalMs: round(index * interval),
        prefillTokens,
        decodeTokens,
        cacheablePrefixTokens: Math.floor(prefillTokens * (phase <= 2 ? 0.62 : 0.38)),
        priority: phase === 4 ? "background" : "interactive"
      };
    });
  }

  simulateMonolithic(workload: PDWorkloadRequest[], config: PDSimulationConfig = {}): PDSimulationResult {
    const cfg = mergeConfig(config);
    const workers = Array.from({ length: cfg.monolithicWorkers }, () => 0);
    const runs: RequestRun[] = [];
    for (const request of sorted(workload)) {
      const workerIndex = minIndex(workers);
      const prefillMs = servicePrefill(request, cfg) * cfg.interferencePenalty;
      const decodeMs = serviceDecode(request, cfg) * cfg.interferencePenalty;
      const start = Math.max(request.arrivalMs, workers[workerIndex]);
      const prefillDone = start + prefillMs;
      const done = prefillDone + decodeMs;
      workers[workerIndex] = done;
      runs.push({
        ttft: prefillDone - request.arrivalMs,
        tpot: request.decodeTokens > 0 ? decodeMs / request.decodeTokens : 0,
        e2e: done - request.arrivalMs,
        prefillQueue: start - request.arrivalMs,
        decodeQueue: 0,
        prefillBusy: prefillMs,
        decodeBusy: decodeMs,
        monoBusy: prefillMs + decodeMs
      });
    }
    return summarize("monolithic_shared", workload, runs, cfg, [
      "Simplified shared-pool baseline: prefill and decode contend on the same workers with an interference penalty."
    ]);
  }

  simulatePDDisaggregated(workload: PDWorkloadRequest[], config: PDSimulationConfig = {}): PDSimulationResult {
    const cfg = mergeConfig(config);
    const prefillWorkers = Array.from({ length: cfg.prefillWorkers }, () => 0);
    const decodeWorkers = Array.from({ length: cfg.decodeWorkers }, () => 0);
    const runs = runPD(workload, cfg, prefillWorkers, decodeWorkers, false);
    return summarize("pd_disaggregated", workload, runs, cfg, [
      "Simplified trace-driven PD simulator: prefill queue, KV transfer, then decode queue.",
      "TTFT includes estimated prefill plus KV transfer overhead."
    ]);
  }

  simulateHybrid(workload: PDWorkloadRequest[], config: PDSimulationConfig = {}): PDSimulationResult {
    const cfg = mergeConfig(config);
    const prefillWorkers = Array.from({ length: Math.max(1, cfg.prefillWorkers) }, () => 0);
    const decodeWorkers = Array.from({ length: Math.max(1, cfg.decodeWorkers) }, () => 0);
    const runs = runPD(workload, cfg, prefillWorkers, decodeWorkers, true);
    return summarize("hybrid", workload, runs, cfg, [
      "Simplified hybrid policy: cache-aware prefill and SLO-aware decode prioritization are approximated deterministically.",
      "This is not a reproduction of any specific paper; it is for workload-level what-if analysis."
    ]);
  }
}

function runPD(
  workload: PDWorkloadRequest[],
  cfg: Required<Omit<PDSimulationConfig, "slo">>,
  prefillWorkers: number[],
  decodeWorkers: number[],
  hybrid: boolean
): RequestRun[] {
  const requests = sorted(workload);
  const prefillDone = requests.map((request) => {
    const workerIndex = minIndex(prefillWorkers);
    const cacheDiscount = hybrid ? Math.min((request.cacheablePrefixTokens ?? 0) * cfg.prefillMsPerToken * 0.35, servicePrefill(request, cfg) * 0.3) : 0;
    const prefillMs = Math.max(cfg.prefillBaseMs, servicePrefill(request, cfg) - cacheDiscount);
    const start = Math.max(request.arrivalMs, prefillWorkers[workerIndex]);
    const done = start + prefillMs;
    prefillWorkers[workerIndex] = done;
    return { request, start, done, prefillMs };
  });

  const decodeReady = prefillDone
    .map((item) => ({
      ...item,
      ready: item.done + serviceKv(item.request, cfg)
    }))
    .sort((a, b) => {
      if (!hybrid) return a.ready - b.ready;
      const aRisk = decodeRisk(a.request, cfg);
      const bRisk = decodeRisk(b.request, cfg);
      return bRisk - aRisk || a.ready - b.ready;
    });

  const runs: RequestRun[] = [];
  for (const item of decodeReady) {
    const workerIndex = minIndex(decodeWorkers);
    const decodeMs = serviceDecode(item.request, cfg);
    const start = Math.max(item.ready, decodeWorkers[workerIndex]);
    const done = start + decodeMs;
    decodeWorkers[workerIndex] = done;
    runs.push({
      ttft: item.ready - item.request.arrivalMs,
      tpot: item.request.decodeTokens > 0 ? decodeMs / item.request.decodeTokens : 0,
      e2e: done - item.request.arrivalMs,
      prefillQueue: item.start - item.request.arrivalMs,
      decodeQueue: start - item.ready,
      prefillBusy: item.prefillMs,
      decodeBusy: decodeMs,
      monoBusy: 0
    });
  }
  return runs;
}

function summarize(
  policyName: PDSimulationResult["policyName"],
  workload: PDWorkloadRequest[],
  runs: RequestRun[],
  cfg: Required<Omit<PDSimulationConfig, "slo">>,
  notes: string[]
): PDSimulationResult {
  const horizon = Math.max(1, ...runs.map((run, index) => workload[index]?.arrivalMs ?? 0), ...runs.map((run) => run.e2e));
  const slo = (cfg as PDSimulationConfig).slo ?? {};
  const good = runs.filter((run) => {
    const ttftOk = slo.ttftMs === undefined || run.ttft <= slo.ttftMs;
    const tpotOk = slo.tpotMs === undefined || run.tpot <= slo.tpotMs;
    const e2eOk = slo.e2eMs === undefined || run.e2e <= slo.e2eMs;
    return ttftOk && tpotOk && e2eOk;
  }).length;
  const prefillBusy = sum(runs.map((run) => run.prefillBusy));
  const decodeBusy = sum(runs.map((run) => run.decodeBusy));
  const monoBusy = sum(runs.map((run) => run.monoBusy));
  return {
    policyName,
    requestCount: workload.length,
    goodput: workload.length ? round(good / workload.length) : 0,
    latency: {
      ttftP50: percentile(runs.map((run) => run.ttft), 50),
      ttftP90: percentile(runs.map((run) => run.ttft), 90),
      ttftP99: percentile(runs.map((run) => run.ttft), 99),
      tpotP50: percentile(runs.map((run) => run.tpot), 50),
      tpotP90: percentile(runs.map((run) => run.tpot), 90),
      tpotP99: percentile(runs.map((run) => run.tpot), 99),
      e2eP50: percentile(runs.map((run) => run.e2e), 50),
      e2eP90: percentile(runs.map((run) => run.e2e), 90),
      e2eP99: percentile(runs.map((run) => run.e2e), 99)
    },
    utilization: {
      prefillUtilization: policyName === "monolithic_shared" ? 0 : round(prefillBusy / Math.max(1, horizon * cfg.prefillWorkers)),
      decodeUtilization: policyName === "monolithic_shared" ? 0 : round(decodeBusy / Math.max(1, horizon * cfg.decodeWorkers)),
      monolithicUtilization: policyName === "monolithic_shared" ? round(monoBusy / Math.max(1, horizon * cfg.monolithicWorkers)) : undefined
    },
    queueing: {
      prefillQueueP90: percentile(runs.map((run) => run.prefillQueue), 90),
      decodeQueueP90: percentile(runs.map((run) => run.decodeQueue), 90)
    },
    notes
  };
}

function mergeConfig(config: PDSimulationConfig): Required<Omit<PDSimulationConfig, "slo">> & Pick<PDSimulationConfig, "slo"> {
  return { ...DEFAULT_PD_SIM_CONFIG, ...config };
}

function sorted(workload: PDWorkloadRequest[]): PDWorkloadRequest[] {
  return [...workload].sort((a, b) => a.arrivalMs - b.arrivalMs || a.id.localeCompare(b.id));
}

function servicePrefill(request: PDWorkloadRequest, cfg: Required<Omit<PDSimulationConfig, "slo">>): number {
  return cfg.prefillBaseMs + request.prefillTokens * cfg.prefillMsPerToken;
}

function serviceDecode(request: PDWorkloadRequest, cfg: Required<Omit<PDSimulationConfig, "slo">>): number {
  const longDecodePenalty = Math.max(0, request.decodeTokens - 128) * cfg.decodeMsPerToken * 0.08;
  return cfg.decodeBaseMs + request.decodeTokens * cfg.decodeMsPerToken + longDecodePenalty;
}

function serviceKv(request: PDWorkloadRequest, cfg: Required<Omit<PDSimulationConfig, "slo">>): number {
  return cfg.kvBaseMs + request.prefillTokens * cfg.kvMsPerToken;
}

function decodeRisk(request: PDWorkloadRequest, cfg: Required<Omit<PDSimulationConfig, "slo">>): number {
  return serviceDecode(request, cfg) + (request.priority === "interactive" ? 100 : 0);
}

function minIndex(values: number[]): number {
  let best = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < values[best]) best = index;
  }
  return best;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sortedValues = [...values].sort((a, b) => a - b);
  const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return round(sortedValues[index]);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

export const pdServingSimulator = new PDServingSimulator();
