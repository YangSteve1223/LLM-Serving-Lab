/**
 * Markdown renderer for simulated PD results.
 *
 * The wording intentionally says estimated/simulated so readers do not mistake
 * trace-driven what-if numbers for real GPU measurements.
 */
import type { PDSimulationResult } from "./ServingTrace.ts";

export function renderPDReport(results: PDSimulationResult[], title = "PD-Aware Serving Simulation"): string {
  const lines = [
    `# ${title}`,
    "",
    "Measurement mode: simulated.",
    "",
    "This report is produced by a simplified trace-driven simulator. These are trace-driven what-if estimates, not real GPU measurements. TTFT, TPOT/ITL, estimatedGoodputUnderSLO, utilization, and KV-transfer values are estimated from heuristic token counts and configured coefficients; they are not real GPU or remote API measurements.",
    "",
    "| Policy | Requests | estimatedGoodputUnderSLO | TTFT P50/P90/P99 ms | TPOT P50/P90/P99 ms | E2E P50/P90/P99 ms | Utilization |",
    "| --- | ---: | ---: | --- | --- | --- | --- |"
  ];
  for (const result of results) {
    lines.push(
      `| ${result.policyName} | ${result.requestCount} | ${formatPct(result.goodput)} | ${triple(result.latency.ttftP50, result.latency.ttftP90, result.latency.ttftP99)} | ${triple(result.latency.tpotP50, result.latency.tpotP90, result.latency.tpotP99)} | ${triple(result.latency.e2eP50, result.latency.e2eP90, result.latency.e2eP99)} | ${formatUtil(result)} |`
    );
  }
  lines.push(
    "",
    "## Why Estimated Goodput Can Be Low",
    "",
    "- This synthetic scenario can overload the decode side depending on qps, worker count, and token mix.",
    "- PD-style separation can improve TTFT while E2E remains poor if decode workers are saturated.",
    "- Treat this as a what-if stress scenario, not a claim about real GPU performance."
  );
  lines.push("", "## Notes", "");
  for (const result of results) {
    lines.push(`- ${result.policyName}: ${result.notes.join(" ")}`);
  }
  return `${lines.join("\n")}\n`;
}

function triple(a: number, b: number, c: number): string {
  return `${round(a)} / ${round(b)} / ${round(c)}`;
}

function formatPct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function formatUtil(result: PDSimulationResult): string {
  if (result.utilization.monolithicUtilization !== undefined) return `mono ${formatPct(result.utilization.monolithicUtilization)}`;
  return `prefill ${formatPct(result.utilization.prefillUtilization)}, decode ${formatPct(result.utilization.decodeUtilization)}`;
}

function round(value: number): number {
  return Number(value.toFixed(1));
}
