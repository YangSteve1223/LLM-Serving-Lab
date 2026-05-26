import assert from "node:assert/strict";
import test from "node:test";
import {
  renderEnhancedPDReport,
  renderContinuousBatchingReport,
  renderKVTransferAnalysis,
  renderChunkedPrefillAnalysis,
  renderHeterogeneousAllocationAnalysis,
  type PDSimulationResult,
  type ContinuousBatchingResult
} from "../../src/agents/learningAssistant/serving/index.ts";

function createMockPDResults(): PDSimulationResult[] {
  return [
    {
      policyName: "monolithic_shared",
      requestCount: 50,
      goodput: 0.72,
      latency: {
        ttftP50: 150, ttftP90: 280, ttftP99: 450,
        tpotP50: 45, tpotP90: 78, tpotP99: 120,
        e2eP50: 1200, e2eP90: 2100, e2eP99: 3500
      },
      utilization: {
        prefillUtilization: 0,
        decodeUtilization: 0,
        monolithicUtilization: 0.85
      },
      queueing: {},
      notes: ["Baseline monolithic serving"]
    },
    {
      policyName: "pd_disaggregated",
      requestCount: 50,
      goodput: 0.88,
      latency: {
        ttftP50: 120, ttftP90: 220, ttftP99: 380,
        tpotP50: 38, tpotP90: 65, tpotP99: 95,
        e2eP50: 1100, e2eP90: 1900, e2eP99: 3200
      },
      utilization: {
        prefillUtilization: 0.75,
        decodeUtilization: 0.82
      },
      queueing: {
        prefillQueueP90: 45,
        decodeQueueP90: 35
      },
      notes: ["PD disaggregation with KV transfer"]
    },
    {
      policyName: "pd_disaggregated",
      requestCount: 50,
      goodput: 0.92,
      latency: {
        ttftP50: 95, ttftP90: 180, ttftP99: 320,
        tpotP50: 35, tpotP90: 58, tpotP99: 88,
        e2eP50: 950, e2eP90: 1650, e2eP99: 2800
      },
      utilization: {
        prefillUtilization: 0.68,
        decodeUtilization: 0.78
      },
      queueing: {
        prefillQueueP90: 32,
        decodeQueueP90: 28
      },
      notes: [
        "Enhanced PD simulation with KV pipelining (80 layers)",
        "Model: llama-70b, KV size: 0.64MB/token/layer",
        "Chunked prefill: enabled (chunk=512)",
        "Heterogeneous allocation: prefill=40%, decode=60%"
      ]
    }
  ];
}

function createMockCBResults(): ContinuousBatchingResult[] {
  return [
    {
      policyName: "fcfs",
      requestCount: 40,
      goodput: 0.78,
      latency: {
        ttftP50: 140, ttftP90: 260, ttftP99: 420,
        tpotP50: 42, tpotP90: 72, tpotP99: 110,
        e2eP50: 1150, e2eP90: 2000, e2eP99: 3400
      },
      schedulingDecisions: [],
      batchStats: {
        avgBatchSize: 4.2,
        maxBatchSize: 8,
        prefillChunksProcessed: 120,
        decodeStepsExecuted: 1800
      },
      notes: ["FCFS policy"]
    },
    {
      policyName: "sjf",
      requestCount: 40,
      goodput: 0.85,
      latency: {
        ttftP50: 125, ttftP90: 235, ttftP99: 390,
        tpotP50: 40, tpotP90: 68, tpotP99: 102,
        e2eP50: 1050, e2eP90: 1850, e2eP99: 3100
      },
      schedulingDecisions: [],
      batchStats: {
        avgBatchSize: 5.1,
        maxBatchSize: 8,
        prefillChunksProcessed: 135,
        decodeStepsExecuted: 1900
      },
      notes: ["SJF policy"]
    },
    {
      policyName: "slo_aware",
      requestCount: 40,
      goodput: 0.91,
      latency: {
        ttftP50: 110, ttftP90: 205, ttftP99: 355,
        tpotP50: 38, tpotP90: 62, tpotP99: 95,
        e2eP50: 980, e2eP90: 1700, e2eP99: 2900
      },
      schedulingDecisions: [],
      batchStats: {
        avgBatchSize: 5.8,
        maxBatchSize: 8,
        prefillChunksProcessed: 148,
        decodeStepsExecuted: 2050
      },
      notes: ["SLO-aware policy"]
    }
  ];
}

test("renderEnhancedPDReport generates valid markdown", () => {
  const results = createMockPDResults();
  const report = renderEnhancedPDReport(results);
  
  assert.ok(report.includes("# Enhanced PD-Aware Serving Simulation"));
  assert.ok(report.includes("Measurement mode: simulated"));
  assert.ok(report.includes("Policy Comparison"));
});

test("renderEnhancedPDReport includes all policies", () => {
  const results = createMockPDResults();
  const report = renderEnhancedPDReport(results);
  
  for (const result of results) {
    assert.ok(report.includes(result.policyName));
  }
});

test("renderEnhancedPDReport includes latency metrics", () => {
  const results = createMockPDResults();
  const report = renderEnhancedPDReport(results);
  
  assert.ok(report.includes("TTFT P50/P90/P99"));
  assert.ok(report.includes("TPOT P50/P90/P99"));
  assert.ok(report.includes("E2E P50/P90/P99"));
});

test("renderEnhancedPDReport includes utilization", () => {
  const results = createMockPDResults();
  const report = renderEnhancedPDReport(results);
  
  assert.ok(report.includes("Utilization"));
});

test("renderEnhancedPDReport includes queueing analysis", () => {
  const results = createMockPDResults();
  const report = renderEnhancedPDReport(results);
  
  assert.ok(report.includes("Queueing Analysis"));
  assert.ok(report.includes("Prefill Queue P90"));
  assert.ok(report.includes("Decode Queue P90"));
});

test("renderEnhancedPDReport includes key observations", () => {
  const results = createMockPDResults();
  const report = renderEnhancedPDReport(results);
  
  assert.ok(report.includes("Key Observations"));
  assert.ok(report.includes("Best Goodput"));
  assert.ok(report.includes("Best TTFT"));
  assert.ok(report.includes("Best TPOT"));
});

test("renderEnhancedPDReport includes implementation notes", () => {
  const results = createMockPDResults();
  const report = renderEnhancedPDReport(results);
  
  assert.ok(report.includes("Implementation Notes"));
  assert.ok(report.includes("Baseline monolithic serving"));
});

test("renderEnhancedPDReport with custom title", () => {
  const results = createMockPDResults();
  const report = renderEnhancedPDReport(results, "Custom PD Report Title");
  
  assert.ok(report.includes("Custom PD Report Title"));
});

test("renderContinuousBatchingReport generates valid markdown", () => {
  const results = createMockCBResults();
  const report = renderContinuousBatchingReport(results);
  
  assert.ok(report.includes("# Continuous Batching Scheduler Comparison"));
  assert.ok(report.includes("Measurement mode: simulated"));
  assert.ok(report.includes("Policy Comparison"));
});

test("renderContinuousBatchingReport includes all policies", () => {
  const results = createMockCBResults();
  const report = renderContinuousBatchingReport(results);
  
  assert.ok(report.includes("fcfs"));
  assert.ok(report.includes("sjf"));
  assert.ok(report.includes("slo_aware"));
});

test("renderContinuousBatchingReport includes batch statistics", () => {
  const results = createMockCBResults();
  const report = renderContinuousBatchingReport(results);
  
  assert.ok(report.includes("Batch Statistics"));
  assert.ok(report.includes("Avg Batch Size"));
  assert.ok(report.includes("Max Batch Size"));
  assert.ok(report.includes("Prefill Chunks"));
  assert.ok(report.includes("Decode Steps"));
});

test("renderContinuousBatchingReport includes policy analysis", () => {
  const results = createMockCBResults();
  const report = renderContinuousBatchingReport(results);
  
  assert.ok(report.includes("Policy Analysis"));
  assert.ok(report.includes("FCFS") || report.includes("fcfs"));
});

test("renderContinuousBatchingReport includes performance comparison", () => {
  const results = createMockCBResults();
  const report = renderContinuousBatchingReport(results);
  
  assert.ok(report.includes("Performance Comparison"));
  assert.ok(report.includes("Best Goodput"));
});

test("renderKVTransferAnalysis generates valid markdown", () => {
  const report = renderKVTransferAnalysis(80, 0.64, 1000, 50);
  
  assert.ok(report.includes("# KV Transfer Analysis"));
  assert.ok(report.includes("Llama-70B"));
  assert.ok(report.includes("80 layers"));
  assert.ok(report.includes("0.64 MB"));
  assert.ok(report.includes("1000"));
  assert.ok(report.includes("50 GB/s"));
});

test("renderKVTransferAnalysis includes transfer time breakdown", () => {
  const report = renderKVTransferAnalysis(80, 0.64, 1000, 50);
  
  assert.ok(report.includes("Transfer Time Breakdown"));
  assert.ok(report.includes("Total KV Size"));
  assert.ok(report.includes("Base Transfer Time"));
  assert.ok(report.includes("Per-Layer"));
});

test("renderKVTransferAnalysis includes pipeline timeline", () => {
  const report = renderKVTransferAnalysis(80, 0.64, 1000, 50);
  
  assert.ok(report.includes("Pipelined Transfer Timeline"));
  assert.ok(report.includes("layer-by-layer"));
  assert.ok(report.includes("Pipeline Overhead"));
});

test("renderKVTransferAnalysis includes per-layer table", () => {
  const report = renderKVTransferAnalysis(80, 0.64, 1000, 50);
  
  assert.ok(report.includes("Layer"));
  assert.ok(report.includes("Transfer Start"));
  assert.ok(report.includes("Transfer End"));
  assert.ok(report.includes("Duration"));
});

test("renderChunkedPrefillAnalysis generates valid markdown", () => {
  const report = renderChunkedPrefillAnalysis(2000, 500, 512);
  
  assert.ok(report.includes("# Chunked Prefill Analysis"));
  assert.ok(report.includes("2000"));
  assert.ok(report.includes("500"));
  assert.ok(report.includes("512"));
});

test("renderChunkedPrefillAnalysis includes chunk breakdown", () => {
  const report = renderChunkedPrefillAnalysis(2000, 500, 512);
  
  assert.ok(report.includes("Chunk Breakdown"));
  assert.ok(report.includes("Chunk #"));
  assert.ok(report.includes("Tokens"));
  assert.ok(report.includes("Type"));
});

test("renderChunkedPrefillAnalysis includes benefits", () => {
  const report = renderChunkedPrefillAnalysis(2000, 500, 512);
  
  assert.ok(report.includes("SARATHI-style"));
  assert.ok(report.includes("Head-of-Line Blocking"));
  assert.ok(report.includes("GPU Utilization"));
});

test("renderHeterogeneousAllocationAnalysis generates valid markdown", () => {
  const report = renderHeterogeneousAllocationAnalysis(0.4, 0.6, 0.75, 0.82);
  
  assert.ok(report.includes("# Heterogeneous Resource Allocation"));
  assert.ok(report.includes("Budget Configuration"));
  assert.ok(report.includes("Prefill"));
  assert.ok(report.includes("Decode"));
});

test("renderHeterogeneousAllocationAnalysis includes utilization", () => {
  const report = renderHeterogeneousAllocationAnalysis(0.4, 0.6, 0.75, 0.82);
  
  assert.ok(report.includes("Utilization Analysis"));
  assert.ok(report.includes("Utilization"));
  assert.ok(report.includes("Status"));
});

test("renderHeterogeneousAllocationAnalysis shows warnings for high utilization", () => {
  const report = renderHeterogeneousAllocationAnalysis(0.4, 0.6, 0.95, 0.92);
  
  assert.ok(report.includes("High"));
});

test("renderHeterogeneousAllocationAnalysis shows recommendations", () => {
  const report = renderHeterogeneousAllocationAnalysis(0.4, 0.6, 0.95, 0.92);
  
  assert.ok(report.includes("Recommendations"));
  assert.ok(report.includes("adding more"));
});

test("Report formatting preserves percentages", () => {
  const results = createMockPDResults();
  const report = renderEnhancedPDReport(results);
  
  // Check that percentages are properly formatted
  assert.ok(report.includes("72.0%") || report.includes("72%"));
  assert.ok(report.includes("88.0%") || report.includes("88%"));
  assert.ok(report.includes("92.0%") || report.includes("92%"));
});

test("Empty results produce valid report", () => {
  const results: PDSimulationResult[] = [];
  const report = renderEnhancedPDReport(results);
  
  // Should produce valid markdown
  assert.ok(report.length > 0);
});

test("Continuous batching report with empty results", () => {
  const results: ContinuousBatchingResult[] = [];
  const report = renderContinuousBatchingReport(results);
  
  // Should produce valid markdown
  assert.ok(report.length > 0);
});
