/**
 * CLI for the trace-driven PD simulator.
 *
 * Output is explicitly labeled simulated/estimated. Use it for what-if analysis
 * and capacity sweeps, not as a claim about real GPU performance.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDServingSimulator, SimulatorCalibrator, applyCalibration, renderPDReport, type ServingPhaseTrace } from "../src/agents/learningAssistant/index.ts";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const simulator = new PDServingSimulator();
const requestCount = numberArg(args.requests, 200);
const qps = numberArg(args.qps, 4);
let config = {
  slo: {
    ttftMs: numberArg(args.ttftMs, 800),
    tpotMs: numberArg(args.tpotMs, 80),
    e2eMs: numberArg(args.e2eMs, 8000)
  },
  prefillWorkers: numberArg(args.prefillWorkers, 1),
  decodeWorkers: numberArg(args.decodeWorkers, 1),
  monolithicWorkers: numberArg(args.monolithicWorkers, 1)
};
let calibrationNote: string | undefined;
if (typeof args.calibration === "string") {
  const calibration = await new SimulatorCalibrator().calibrateFromFile(path.resolve(rootDir, args.calibration));
  config = applyCalibration(config, calibration) as typeof config;
  calibrationNote = `Applied approximate calibration from ${args.calibration} (${calibration.confidence} confidence).`;
}

const workload = args.trace
  ? simulator.tracesToWorkload(await readTraces(path.resolve(rootDir, args.trace)), qps)
  : simulator.buildSyntheticWorkload(requestCount, qps);
const results = simulator.comparePolicies(workload, config);
const sweepRows = buildSweepRows();
const report = [
  renderPDReport(results, args.trace ? "PD-Aware Serving Simulation From Trace" : "PD-Aware Synthetic Serving Simulation").trimEnd(),
  sweepRows.length ? renderSweepRows(sweepRows) : "",
  calibrationNote ? `\n## Calibration\n\n- ${calibrationNote}\n` : ""
].join("\n");
const reportsDir = path.join(rootDir, "reports");
await fs.mkdir(reportsDir, { recursive: true });
await fs.writeFile(
  path.join(reportsDir, "pd-simulation.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), source: args.trace ? "trace" : "synthetic", requestCount: workload.length, qps, config, calibrationNote, results, sweepRows }, null, 2),
  "utf8"
);
await fs.writeFile(path.join(reportsDir, "pd-simulation.md"), report, "utf8");
console.log(`PD simulation complete: ${workload.length} requests`);
console.log(path.join(reportsDir, "pd-simulation.md"));

async function readTraces(filePath: string): Promise<ServingPhaseTrace[]> {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ServingPhaseTrace);
}

function parseArgs(values: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function numberArg(value: string | boolean | undefined, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildSweepRows() {
  const qpsValues = listArg(args["sweep-qps"]);
  const workerValues = listArg(args["sweep-workers"]);
  if (!qpsValues.length && !workerValues.length) return [];
  const qpsList = qpsValues.length ? qpsValues : [qps];
  const workerList = workerValues.length ? workerValues : [config.decodeWorkers ?? 1];
  return qpsList.flatMap((sweepQps) =>
    workerList.flatMap((workers) => {
      const sweepWorkload = simulator.buildSyntheticWorkload(requestCount, sweepQps);
      const sweepConfig = { ...config, prefillWorkers: workers, decodeWorkers: workers, monolithicWorkers: workers };
      return simulator.comparePolicies(sweepWorkload, sweepConfig).map((result) => ({
        qps: sweepQps,
        workers,
        policy: result.policyName,
        estimatedGoodputUnderSLO: result.goodput,
        ttftP90: result.latency.ttftP90,
        e2eP90: result.latency.e2eP90,
        decodeUtilization: result.utilization.decodeUtilization
      }));
    })
  );
}

function listArg(value: string | boolean | undefined): number[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
}

function renderSweepRows(rows: ReturnType<typeof buildSweepRows>): string {
  const lines = [
    "",
    "## Capacity Sweep",
    "",
    "| QPS | Workers | Policy | estimatedGoodputUnderSLO | TTFT P90 ms | E2E P90 ms | Decode utilization |",
    "| ---: | ---: | --- | ---: | ---: | ---: | ---: |"
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.qps} | ${row.workers} | ${row.policy} | ${pct(row.estimatedGoodputUnderSLO)} | ${row.ttftP90} | ${row.e2eP90} | ${pct(row.decodeUtilization ?? 0)} |`
    );
  }
  return lines.join("\n");
}

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}
