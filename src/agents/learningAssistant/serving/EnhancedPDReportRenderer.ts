/**
 * Enhanced Markdown renderer for PD simulation results.
 * 
 * Features:
 * - Detailed policy comparison with heterogeneous allocation stats
 * - Chunked prefill analysis
 * - KV transfer pipeline visualization
 * - SLO compliance metrics
 * - Batch statistics for continuous batching
 */
import type {
  PDSimulationResult,
  ContinuousBatchingResult,
  EnhancedPDConfig,
  ContinuousBatchingPolicy
} from "./ServingTrace.ts";
import { round } from "./utils/MathUtils.ts";

/**
 * Render enhanced PD simulation report.
 */
export function renderEnhancedPDReport(
  results: PDSimulationResult[],
  title = "Enhanced PD-Aware Serving Simulation",
  config?: EnhancedPDConfig
): string {
  const lines = [
    `# ${title}`,
    "",
    "**Measurement mode: simulated**",
    "",
    "This report is produced by an enhanced trace-driven simulator with:",
    "- Hierarchical KV Cache pipelined transfer modeling",
    "- SARATHI-style chunked prefill scheduling",
    "- Heterogeneous resource allocation (compute-heavy prefill / memory-heavy decode)",
    "- Model-specific KV size estimation (e.g., Llama-70B: 0.64MB/token/layer)",
    "",
    "**Disclaimer**: These are trace-driven what-if estimates, not real GPU measurements.",
    "",
    "## Configuration Summary",
    ""
  ];

  // Add configuration if provided
  if (config) {
    lines.push(...renderConfigSummary(config));
    lines.push("");
  }

  lines.push(
    "## Policy Comparison",
    "",
    "| Policy | Requests | Goodput | TTFT P50/P90/P99 (ms) | TPOT P50/P90/P99 (ms) | E2E P50/P90/P99 (ms) | Utilization |",
    "| --- | ---: | ---: | --- | --- | --- | --- |"
  );

  for (const result of results) {
    lines.push(
      `| ${result.policyName} | ${result.requestCount} | ${formatPct(result.goodput)} | ${triple(result.latency.ttftP50, result.latency.ttftP90, result.latency.ttftP99)} | ${triple(result.latency.tpotP50, result.latency.tpotP90, result.latency.tpotP99)} | ${triple(result.latency.e2eP50, result.latency.e2eP90, result.latency.e2eP99)} | ${formatUtil(result)} |`
    );
  }

  lines.push("", "## Queueing Analysis", "");
  lines.push("| Policy | Prefill Queue P90 (ms) | Decode Queue P90 (ms) |");
  lines.push("| --- | ---: | ---: |");
  
  for (const result of results) {
    const prefillQueue = result.queueing.prefillQueueP90?.toFixed(1) ?? "N/A";
    const decodeQueue = result.queueing.decodeQueueP90?.toFixed(1) ?? "N/A";
    lines.push(`| ${result.policyName} | ${prefillQueue} | ${decodeQueue} |`);
  }

  lines.push("", "## Key Observations", "");
  
  // Analyze results
  // Handle empty results
  if (results.length === 0) {
    lines.push("", "## Key Observations", "");
    lines.push("- No results to compare.");
    lines.push("", "## Implementation Notes", "");
    lines.push("- No results available.");
    return `${lines.join("\n")}\n`;
  }
  
  const bestGoodput = results.reduce((best, r) => r.goodput > best.goodput ? r : best, results[0]);
  const bestTTFT = results.reduce((best, r) => r.latency.ttftP90 < best.latency.ttftP90 ? r : best, results[0]);
  const bestTPOT = results.reduce((best, r) => r.latency.tpotP90 < best.latency.tpotP90 ? r : best, results[0]);
  
  lines.push(
    `- **Best Goodput**: ${bestGoodput.policyName} (${formatPct(bestGoodput.goodput)})`,
    `- **Best TTFT**: ${bestTTFT.policyName} (P90: ${bestTTFT.latency.ttftP90.toFixed(1)}ms)`,
    `- **Best TPOT**: ${bestTPOT.policyName} (P90: ${bestTPOT.latency.tpotP90.toFixed(1)}ms)`,
    ""
  );

  lines.push("## Implementation Notes", "");
  for (const result of results) {
    lines.push(`### ${result.policyName}`);
    for (const note of result.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Render continuous batching report.
 */
export function renderContinuousBatchingReport(
  results: ContinuousBatchingResult[],
  title = "Continuous Batching Scheduler Comparison"
): string {
  const lines = [
    `# ${title}`,
    "",
    "**Measurement mode: simulated**",
    "",
    "This report compares continuous batching scheduling policies:",
    "- **FCFS** (First-Come, First-Served): Arrival time is priority",
    "- **SJF** (Shortest Job First): Total remaining work is priority",
    "- **SLO-aware**: TTFT/TPOT/E2E risk score determines priority",
    "",
    "## Policy Comparison",
    "",
    "| Policy | Requests | Goodput | TTFT P50/P90/P99 (ms) | TPOT P50/P90/P99 (ms) | E2E P50/P90/P99 (ms) |",
    "| --- | ---: | ---: | --- | --- | --- |"
  ];

  // Handle empty results
  if (results.length === 0) {
    lines.push("| (no results) | 0 | 0% | - | - | - |");
    lines.push("", "## Policy Analysis", "");
    lines.push("- No results available.");
    lines.push("", "## Performance Comparison");
    lines.push("- No results to compare.");
    return `${lines.join("\n")}\n`;
  }

  for (const result of results) {
    lines.push(
      `| ${result.policyName} | ${result.requestCount} | ${formatPct(result.goodput)} | ${triple(result.latency.ttftP50, result.latency.ttftP90, result.latency.ttftP99)} | ${triple(result.latency.tpotP50, result.latency.tpotP90, result.latency.tpotP99)} | ${triple(result.latency.e2eP50, result.latency.e2eP90, result.latency.e2eP99)} |`
    );
  }

  lines.push("", "## Batch Statistics", "");
  lines.push("| Policy | Avg Batch Size | Max Batch Size | Prefill Chunks | Decode Steps |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  
  for (const result of results) {
    lines.push(
      `| ${result.policyName} | ${result.batchStats.avgBatchSize} | ${result.batchStats.maxBatchSize} | ${result.batchStats.prefillChunksProcessed} | ${result.batchStats.decodeStepsExecuted} |`
    );
  }

  lines.push("", "## Policy Analysis", "");
  
  for (const result of results) {
    lines.push(`### ${result.policyName.toUpperCase()}`);
    lines.push(`- Goodput: ${formatPct(result.goodput)}`);
    lines.push(`- TTFT P90: ${result.latency.ttftP90.toFixed(1)}ms`);
    lines.push(`- TPOT P90: ${result.latency.tpotP90.toFixed(1)}ms`);
    lines.push(`- E2E P90: ${result.latency.e2eP90.toFixed(1)}ms`);
    lines.push(`- Scheduling decisions: ${result.schedulingDecisions.length}`);
    lines.push("");
    
    for (const note of result.notes) {
      if (note.startsWith("Policy:") || note.startsWith("Max batch") || note.startsWith("Step budget")) {
        lines.push(`- ${note}`);
      }
    }
    lines.push("");
  }

  // Performance comparison
  lines.push("## Performance Comparison");
  const sortedByGoodput = [...results].sort((a, b) => b.goodput - a.goodput);
  const best = sortedByGoodput[0];
  
  lines.push(`**Best Goodput**: ${best.policyName} with ${formatPct(best.goodput)}`);
  lines.push("");
  
  // Calculate relative improvements
  if (results.length > 1) {
    const worst = sortedByGoodput[sortedByGoodput.length - 1];
    const goodputImprovement = ((best.goodput - worst.goodput) / Math.max(0.01, worst.goodput) * 100).toFixed(1);
    const ttftImprovement = ((worst.latency.ttftP90 - best.latency.ttftP90) / Math.max(1, worst.latency.ttftP90) * 100).toFixed(1);
    
    lines.push(
      `- Goodput improvement (best vs worst): ${goodputImprovement}%`,
      `- TTFT improvement (best vs worst): ${ttftImprovement}%`
    );
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Render KV transfer analysis.
 */
export function renderKVTransferAnalysis(
  numLayers: number,
  kvSizePerTokenMB: number,
  prefillTokens: number,
  bandwidthGBps: number
): string {
  const lines = [
    "# KV Transfer Analysis",
    "",
    `**Model**: Llama-70B (${numLayers} layers)`,
    `**KV Size per Token per Layer**: ${kvSizePerTokenMB} MB`,
    `**Total KV per Token**: ${(kvSizePerTokenMB * numLayers).toFixed(2)} MB`,
    `**Prefill Tokens**: ${prefillTokens}`,
    `**Interconnect Bandwidth**: ${bandwidthGBps} GB/s`,
    "",
    "## Transfer Time Breakdown",
    ""
  ];

  const totalKVSizeMB = kvSizePerTokenMB * numLayers * prefillTokens;
  const baseTransferMs = (totalKVSizeMB / bandwidthGBps) * 1000;
  const perLayerKVSizeMB = kvSizePerTokenMB * prefillTokens;
  const perLayerTransferMs = (perLayerKVSizeMB / bandwidthGBps) * 1000;

  lines.push(
    `| Metric | Value |`,
    `| --- | ---: |`,
    `| Total KV Size | ${totalKVSizeMB.toFixed(2)} MB |`,
    `| Base Transfer Time (sequential) | ${baseTransferMs.toFixed(2)} ms |`,
    `| Per-Layer KV Size | ${perLayerKVSizeMB.toFixed(2)} MB |`,
    `| Per-Layer Transfer Time | ${perLayerTransferMs.toFixed(2)} ms |`,
    `| Pipeline Overhead (${numLayers} layers) | ${(perLayerTransferMs * (numLayers - 1)).toFixed(2)} ms |`,
    ""
  );

  lines.push("## Pipelined Transfer Timeline", "");
  lines.push("");
  lines.push("With layer-by-layer pipelining:");
  lines.push(`- Transfer starts immediately after each layer computes`);
  lines.push(`- Effective last-layer transfer: ~${perLayerTransferMs.toFixed(2)} ms`);
  lines.push(`- Pipeline overlap saves: ~${(baseTransferMs - perLayerTransferMs).toFixed(2)} ms`);
  lines.push("");

  // Per-layer table (first 10 and last 10)
  lines.push("| Layer | Transfer Start (ms) | Transfer End (ms) | Duration (ms) |");
  lines.push("| --- | ---: | ---: | ---: |");

  const layerComputeMs = 0.3; // Approximate layer compute time
  for (let layer = 0; layer < Math.min(10, numLayers); layer++) {
    const startMs = layer * (layerComputeMs + perLayerTransferMs / numLayers);
    const endMs = startMs + perLayerTransferMs;
    lines.push(`| ${layer} | ${startMs.toFixed(2)} | ${endMs.toFixed(2)} | ${perLayerTransferMs.toFixed(2)} |`);
  }

  if (numLayers > 20) {
    lines.push("| ... | ... | ... | ... |");
    for (let layer = numLayers - 10; layer < numLayers; layer++) {
      const startMs = layer * (layerComputeMs + perLayerTransferMs / numLayers);
      const endMs = startMs + perLayerTransferMs;
      lines.push(`| ${layer} | ${startMs.toFixed(2)} | ${endMs.toFixed(2)} | ${perLayerTransferMs.toFixed(2)} |`);
    }
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Render chunked prefill analysis.
 */
export function renderChunkedPrefillAnalysis(
  prefillTokens: number,
  cacheableTokens: number,
  chunkSize: number
): string {
  const lines = [
    "# Chunked Prefill Analysis",
    "",
    `**Total Prefill Tokens**: ${prefillTokens}`,
    `**Cacheable Tokens**: ${cacheableTokens}`,
    `**Non-cacheable Tokens**: ${prefillTokens - cacheableTokens}`,
    `**Chunk Size**: ${chunkSize}`,
    "",
    "## Chunk Breakdown",
    ""
  ];

  const chunks: Array<{ index: number; tokens: number; type: string }> = [];
  
  // First chunk: cacheable prefix
  if (cacheableTokens > 0) {
    chunks.push({ index: 0, tokens: cacheableTokens, type: "cacheable" });
  }
  
  // Remaining chunks: non-cacheable
  let remaining = prefillTokens - cacheableTokens;
  let idx = chunks.length;
  while (remaining > 0) {
    const chunkTokens = Math.min(chunkSize, remaining);
    chunks.push({ index: idx++, tokens: chunkTokens, type: "non-cacheable" });
    remaining -= chunkTokens;
  }

  lines.push("| Chunk # | Tokens | Type |");
  lines.push("| --- | ---: | --- |");
  for (const chunk of chunks) {
    lines.push(`| ${chunk.index} | ${chunk.tokens} | ${chunk.type} |`);
  }

  lines.push("");
  lines.push("## Benefits of Chunked Prefill (SARATHI-style)");
  lines.push("");
  lines.push("1. **Eliminates Head-of-Line Blocking**: Long prefill requests don't block short ones");
  lines.push("2. **Better GPU Utilization**: Short chunks can be interleaved with decode steps");
  lines.push("3. **Improved TTFT for Waiting Requests**: Requests behind long prefills can start decode sooner");
  lines.push("4. **Fairness**: Short requests don't suffer from long request delays");
  lines.push("");
  lines.push(`**Total Chunks**: ${chunks.length}`);
  lines.push(`**Cacheable Reduction**: ${cacheableTokens > 0 ? `First ${cacheableTokens} tokens use cache (35% faster)` : "No cache hits"}`);

  return `${lines.join("\n")}\n`;
}

/**
 * Render heterogeneous allocation analysis.
 */
export function renderHeterogeneousAllocationAnalysis(
  prefillBudgetRatio: number,
  decodeBudgetRatio: number,
  prefillUtilization: number,
  decodeUtilization: number
): string {
  const lines = [
    "# Heterogeneous Resource Allocation",
    "",
    "## Budget Configuration",
    "",
    "| Resource | Budget Ratio | Typical GPU Type | Characteristics |",
    "| --- | ---: | --- | --- |",
    "| Prefill | " + `${(prefillBudgetRatio * 100).toFixed(0)}%` + " | Compute-heavy (A100/H100) | High FLOPs, moderate BW |",
    "| Decode | " + `${(decodeBudgetRatio * 100).toFixed(0)}%` + " | Memory-heavy (H100/HBM3) | Lower FLOPs, high BW |",
    "",
    "## Utilization Analysis",
    "",
    "| Resource | Utilization | Status |",
    "| --- | ---: | --- |",
    `| Prefill | ${formatPct(prefillUtilization)} | ${prefillUtilization > 0.9 ? "⚠️ High" : "✅ Normal"} |`,
    `| Decode | ${formatPct(decodeUtilization)} | ${decodeUtilization > 0.9 ? "⚠️ High" : "✅ Normal"} |`,
    "",
    "## Recommendations",
    ""
  ];

  if (prefillUtilization > 0.9) {
    lines.push("- ⚠️ **Prefill utilization is very high**: Consider adding more prefill workers or reducing prefill budget ratio");
  }
  if (decodeUtilization > 0.9) {
    lines.push("- ⚠️ **Decode utilization is very high**: Consider adding more decode workers or reducing decode budget ratio");
  }
  if (prefillUtilization < 0.5 && decodeUtilization < 0.5) {
    lines.push("- 💡 Both utilizations are low: Budget allocation could be optimized or workload is insufficient");
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Render configuration summary.
 */
function renderConfigSummary(config: EnhancedPDConfig): string[] {
  const lines: string[] = [];
  
  lines.push(`| Parameter | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Model | ${config.modelName ?? "llama-70b"} |`);
  lines.push(`| Num Layers | ${config.numLayers ?? 80} |`);
  lines.push(`| KV Size (MB/token/layer) | ${config.kvSizePerTokenMB ?? 0.64} |`);
  lines.push(`| Prefill Workers | ${config.prefillWorkers ?? 2} |`);
  lines.push(`| Decode Workers | ${config.decodeWorkers ?? 4} |`);
  
  if (config.chunkedPrefill) {
    lines.push(`| Chunked Prefill | ${config.chunkedPrefill.enabled ? "enabled" : "disabled"} |`);
    lines.push(`| Chunk Size | ${config.chunkedPrefill.chunkSize ?? 512} |`);
  }
  
  if (config.networkTopology) {
    lines.push(`| IB Bandwidth | ${config.networkTopology.prefillToDecodeIBBandwidthGBps ?? 50} GB/s |`);
    lines.push(`| Network Hops | ${config.networkTopology.numNetworkHops ?? 1} |`);
  }
  
  lines.push(`| Prefill Budget | ${((config.prefillBudgetRatio ?? 0.4) * 100).toFixed(0)}% |`);
  lines.push(`| Decode Budget | ${((config.decodeBudgetRatio ?? 0.6) * 100).toFixed(0)}% |`);
  
  return lines;
}

function triple(a: number, b: number, c: number): string {
  return `${round(a)} / ${round(b)} / ${round(c)}`;
}

function formatPct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function formatUtil(result: PDSimulationResult): string {
  if (result.utilization.monolithicUtilization !== undefined) {
    return `mono ${formatPct(result.utilization.monolithicUtilization)}`;
  }
  return `prefill ${formatPct(result.utilization.prefillUtilization)}, decode ${formatPct(result.utilization.decodeUtilization)}`;
}

export { triple, formatPct, formatUtil, round };
