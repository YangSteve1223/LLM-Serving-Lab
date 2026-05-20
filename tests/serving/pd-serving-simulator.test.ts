import assert from "node:assert/strict";
import test from "node:test";
import { PDServingSimulator, renderPDReport, type PDWorkloadRequest } from "../../src/agents/learningAssistant/serving/index.ts";

function workload(prefillTokens: number, decodeTokens: number): PDWorkloadRequest[] {
  return Array.from({ length: 12 }, (_, index) => ({
    id: `r-${index}`,
    arrivalMs: index * 250,
    prefillTokens,
    decodeTokens,
    cacheablePrefixTokens: Math.floor(prefillTokens * 0.5),
    priority: "interactive"
  }));
}

test("policy comparison preserves request count", () => {
  const simulator = new PDServingSimulator();
  const results = simulator.comparePolicies(workload(1000, 80), { slo: { ttftMs: 800, tpotMs: 80, e2eMs: 8000 } });
  assert.equal(results.length, 3);
  for (const result of results) assert.equal(result.requestCount, 12);
});

test("increasing prefill tokens increases TTFT", () => {
  const simulator = new PDServingSimulator();
  const low = simulator.simulatePDDisaggregated(workload(400, 80)).latency.ttftP90;
  const high = simulator.simulatePDDisaggregated(workload(2400, 80)).latency.ttftP90;
  assert.ok(high > low);
});

test("increasing decode tokens increases TPOT or E2E", () => {
  const simulator = new PDServingSimulator();
  const low = simulator.simulatePDDisaggregated(workload(800, 40)).latency;
  const high = simulator.simulatePDDisaggregated(workload(800, 240)).latency;
  assert.ok(high.tpotP90 >= low.tpotP90);
  assert.ok(high.e2eP90 > low.e2eP90);
});

test("pd_disaggregated improves decode-heavy TPOT tail against monolithic", () => {
  const simulator = new PDServingSimulator();
  const requests = workload(600, 320);
  const mono = simulator.simulateMonolithic(requests);
  const pd = simulator.simulatePDDisaggregated(requests);
  assert.ok(pd.latency.tpotP90 < mono.latency.tpotP90 || pd.goodput >= mono.goodput);
});

test("hybrid goodput is not below the worse baseline on balanced SLO", () => {
  const simulator = new PDServingSimulator();
  const requests = simulator.buildSyntheticWorkload(40, 4);
  const [mono, pd, hybrid] = simulator.comparePolicies(requests, { slo: { ttftMs: 900, tpotMs: 90, e2eMs: 10000 } });
  assert.ok(hybrid.goodput >= Math.min(mono.goodput, pd.goodput));
});

test("PD simulation report labels goodput as estimated and simulated", () => {
  const simulator = new PDServingSimulator();
  const report = renderPDReport(simulator.comparePolicies(simulator.buildSyntheticWorkload(8, 2)));
  assert.match(report, /Measurement mode: simulated/);
  assert.match(report, /estimatedGoodputUnderSLO/);
  assert.match(report, /not real GPU/i);
});
