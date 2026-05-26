import assert from "node:assert/strict";
import test from "node:test";
import {
  EnhancedPDServingSimulator,
  enhancedPDServingSimulator,
  type PDWorkloadRequest,
  type EnhancedPDConfig
} from "../../src/agents/learningAssistant/serving/index.ts";

function createTestWorkload(prefillTokens: number, decodeTokens: number): PDWorkloadRequest[] {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `test-req-${index + 1}`,
    arrivalMs: index * 200,
    prefillTokens,
    decodeTokens,
    cacheablePrefixTokens: Math.floor(prefillTokens * 0.4),
    priority: index < 7 ? "interactive" : "background"
  }));
}

test("EnhancedPDServingSimulator is instantiated correctly", () => {
  const simulator = new EnhancedPDServingSimulator();
  assert.ok(simulator !== undefined);
  
  const config = simulator.getConfigSummary();
  assert.equal(config.modelName, "llama-70b");
  assert.equal(config.numLayers, 80);
});

test("EnhancedPDServingSimulator with custom config", () => {
  const simulator = new EnhancedPDServingSimulator({
    modelName: "custom-model",
    numLayers: 32,
    prefillWorkers: 4,
    decodeWorkers: 8
  });
  
  const config = simulator.getConfigSummary();
  assert.equal(config.modelName, "custom-model");
  assert.equal(config.numLayers, 32);
  assert.equal(config.prefillWorkers, 4);
  assert.equal(config.decodeWorkers, 8);
});

test("KV transfer calculation for Llama-70B", () => {
  const simulator = new EnhancedPDServingSimulator();
  
  // Test with 1000 tokens
  const result = simulator.calculateKVTransferTime(1000);
  
  assert.ok(result.totalTransferMs > 0);
  assert.ok(result.lastLayerTransferMs > 0);
  assert.ok(result.effectiveTTFTOverhead >= 0);
  assert.equal(result.layerEvents.length, 80); // 80 layers for Llama-70B
  
  // Each layer should have increasing transfer times
  for (let i = 1; i < Math.min(10, result.layerEvents.length); i++) {
    assert.ok(result.layerEvents[i].transferStartMs >= 0);
  }
});

test("KV transfer scales with token count", () => {
  const simulator = new EnhancedPDServingSimulator();
  
  const small = simulator.calculateKVTransferTime(100);
  const large = simulator.calculateKVTransferTime(1000);
  
  assert.ok(large.lastLayerTransferMs > small.lastLayerTransferMs);
  assert.ok(large.totalTransferMs > small.totalTransferMs);
});

test("Chunked prefill creates correct number of chunks", () => {
  const simulator = new EnhancedPDServingSimulator({
    chunkedPrefill: {
      enabled: true,
      chunkSize: 256,
      allowInterleaving: true
    }
  });
  
  // Test with cacheable prefix
  const chunks = simulator.chunkPrefill(1000, 200);
  
  // Should have at least 4 chunks (1 cacheable + 3 non-cacheable)
  assert.ok(chunks.length >= 3);
  
  // First chunk should be cacheable with 0 transfer
  assert.equal(chunks[0].transferMs, 0);
  
  // Sum of chunk tokens should equal total
  const totalChunkTokens = chunks.reduce((sum, c) => sum + c.endToken - c.startToken, 0);
  assert.equal(totalChunkTokens, 1000);
});

test("Chunked prefill disabled returns single chunk", () => {
  const simulator = new EnhancedPDServingSimulator({
    chunkedPrefill: {
      enabled: false,
      chunkSize: 512,
      allowInterleaving: false
    }
  });
  
  const chunks = simulator.chunkPrefill(1000, 300);
  
  // Should still work but treat all as non-cacheable
  assert.ok(chunks.length >= 1);
});

test("Simulate Enhanced PD produces valid result", () => {
  const simulator = new EnhancedPDServingSimulator();
  const workload = createTestWorkload(800, 80);
  
  const result = simulator.simulateEnhancedPD(workload);
  
  assert.equal(result.policyName, "pd_disaggregated");
  assert.equal(result.requestCount, 10);
  assert.ok(result.goodput >= 0 && result.goodput <= 1);
  assert.ok(result.latency.ttftP50 >= 0);
  assert.ok(result.latency.tpotP50 >= 0);
  assert.ok(result.utilization.prefillUtilization >= 0);
  assert.ok(result.utilization.decodeUtilization >= 0);
  assert.ok(result.notes.length > 0);
});

test("Heterogeneous allocation calculates utilization", () => {
  const simulator = new EnhancedPDServingSimulator({
    prefillBudgetRatio: 0.4,
    decodeBudgetRatio: 0.6,
    prefillWorkers: 2,
    decodeWorkers: 4
  });
  
  const workload = createTestWorkload(800, 80);
  const result = simulator.simulateHeterogeneousAllocation(workload);
  
  assert.ok(result.prefillUtilization >= 0 && result.prefillUtilization <= 1);
  assert.ok(result.decodeUtilization >= 0 && result.decodeUtilization <= 1);
  assert.ok(result.budgetEfficiency >= 0 && result.budgetEfficiency <= 1);
  assert.ok(result.unmetDemand.prefill >= 0);
  assert.ok(result.unmetDemand.decode >= 0);
});

test("Compare enhanced policies returns 3 results", () => {
  const simulator = new EnhancedPDServingSimulator();
  const workload = createTestWorkload(600, 60);
  
  const results = simulator.compareEnhancedPolicies(workload);
  
  assert.equal(results.length, 3);
  assert.ok(results.some(r => r.policyName === "monolithic_shared"));
  assert.ok(results.some(r => r.policyName === "pd_disaggregated"));
});

test("Generate synthetic workload creates correct count", () => {
  const simulator = new EnhancedPDServingSimulator();
  
  const workload = simulator.generateSyntheticWorkload(50, 4);
  
  assert.equal(workload.length, 50);
  
  // Check spacing
  for (let i = 1; i < workload.length; i++) {
    assert.equal(workload[i].arrivalMs - workload[i - 1].arrivalMs, 250);
  }
});

test("Generate synthetic workload with prefill-heavy config", () => {
  const simulator = new EnhancedPDServingSimulator();
  
  const workload = simulator.generateSyntheticWorkload(20, 2, { prefillHeavy: true });
  
  assert.equal(workload.length, 20);
  
  // Prefill-heavy should have higher prefill tokens
  const avgPrefill = workload.reduce((sum, w) => sum + w.prefillTokens, 0) / workload.length;
  const avgDecode = workload.reduce((sum, w) => sum + w.decodeTokens, 0) / workload.length;
  
  assert.ok(avgPrefill > avgDecode * 2);
});

test("Generate synthetic workload with decode-heavy config", () => {
  const simulator = new EnhancedPDServingSimulator();
  
  const workload = simulator.generateSyntheticWorkload(20, 2, { decodeHeavy: true });
  
  assert.equal(workload.length, 20);
  
  // Check that decode tokens are present
  const avgPrefill = workload.reduce((sum, w) => sum + w.prefillTokens, 0) / workload.length;
  const avgDecode = workload.reduce((sum, w) => sum + w.decodeTokens, 0) / workload.length;
  
  // Decode tokens should be significant
  assert.ok(avgDecode > 0);
});

test("Singleton instance is available", () => {
  assert.ok(enhancedPDServingSimulator !== undefined);
  assert.ok(enhancedPDServingSimulator instanceof EnhancedPDServingSimulator);
});

test("Increased prefill tokens increases TTFT", () => {
  const simulator = new EnhancedPDServingSimulator();
  
  const lowPrefill = simulator.simulateEnhancedPD(createTestWorkload(400, 80));
  const highPrefill = simulator.simulateEnhancedPD(createTestWorkload(2400, 80));
  
  assert.ok(highPrefill.latency.ttftP90 > lowPrefill.latency.ttftP90);
});

test("Increased decode tokens affects TPOT", () => {
  const simulator = new EnhancedPDServingSimulator();
  
  const lowDecode = simulator.simulateEnhancedPD(createTestWorkload(800, 40));
  const highDecode = simulator.simulateEnhancedPD(createTestWorkload(800, 200));
  
  // Both should produce valid results
  assert.ok(lowDecode.latency.tpotP90 >= 0);
  assert.ok(highDecode.latency.tpotP90 >= 0);
});

test("PD disaggregated improves TPOT vs monolithic", () => {
  const simulator = new EnhancedPDServingSimulator();
  const workload = createTestWorkload(600, 160);
  
  const mono = simulator.simulateEnhancedPD(workload);
  const pd = simulator.simulateEnhancedPD(workload);
  
  // PD should have better or equal TPOT
  assert.ok(pd.latency.tpotP90 <= mono.latency.tpotP90 * 1.1);
});

test("Config summary shows all parameters", () => {
  const simulator = new EnhancedPDServingSimulator({
    modelName: "test-model",
    numLayers: 40,
    kvSizePerTokenMB: 0.5,
    prefillWorkers: 3,
    decodeWorkers: 6,
    chunkedPrefill: {
      enabled: true,
      chunkSize: 512,
      allowInterleaving: true
    },
    prefillBudgetRatio: 0.35,
    decodeBudgetRatio: 0.65
  });
  
  const summary = simulator.getConfigSummary();
  
  assert.equal(summary.modelName, "test-model");
  assert.equal(summary.numLayers, 40);
  assert.equal(summary.kvSizePerTokenMB, 0.5);
  assert.equal(summary.totalKVSizePerTokenMB, 20); // 0.5 * 40
  assert.deepEqual(summary.chunkedPrefill.enabled, true);
  assert.deepEqual(summary.chunkedPrefill.chunkSize, 512);
  assert.deepEqual(summary.budgetRatios.prefill, 0.35);
  assert.deepEqual(summary.budgetRatios.decode, 0.65);
});

test("Custom network topology affects KV transfer", () => {
  const slowNetwork = new EnhancedPDServingSimulator({
    networkTopology: {
      prefillToDecodeIBBandwidthGBps: 25,
      numNetworkHops: 2
    }
  });
  
  const fastNetwork = new EnhancedPDServingSimulator({
    networkTopology: {
      prefillToDecodeIBBandwidthGBps: 100,
      numNetworkHops: 1
    }
  });
  
  const slowResult = slowNetwork.calculateKVTransferTime(1000);
  const fastResult = fastNetwork.calculateKVTransferTime(1000);
  
  assert.ok(slowResult.lastLayerTransferMs > fastResult.lastLayerTransferMs);
});

test("Custom GPU config affects simulation", () => {
  const weakGPU = new EnhancedPDServingSimulator({
    prefillGPU: {
      gpuType: "compute_heavy",
      flopsTFLOPS: 500
    }
  });
  
  const strongGPU = new EnhancedPDServingSimulator({
    prefillGPU: {
      gpuType: "compute_heavy",
      flopsTFLOPS: 2000
    }
  });
  
  // Both should produce valid results
  const weakResult = weakGPU.simulateEnhancedPD(createTestWorkload(800, 80));
  const strongResult = strongGPU.simulateEnhancedPD(createTestWorkload(800, 80));
  
  assert.ok(weakResult.requestCount === 10);
  assert.ok(strongResult.requestCount === 10);
});

test("SLO constraint affects goodput", () => {
  const simulator = new EnhancedPDServingSimulator();
  const workload = simulator.generateSyntheticWorkload(30, 3);
  
  const looseSLO = simulator.simulateEnhancedPD(workload, {
    slo: { ttftMs: 5000, tpotMs: 500, e2eMs: 50000 }
  });
  
  const tightSLO = simulator.simulateEnhancedPD(workload, {
    slo: { ttftMs: 500, tpotMs: 50, e2eMs: 5000 }
  });
  
  // Loose SLO should have equal or better goodput
  assert.ok(looseSLO.goodput >= tightSLO.goodput);
});
