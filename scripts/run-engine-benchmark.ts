/**
 * CLI for dry-run or real endpoint engine benchmarks.
 *
 * Without BASE_URL/MODEL it stays in dry-run mode and reports no TTFT/ITL/E2E.
 * Real latency requires an OpenAI-compatible streaming endpoint.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EngineBenchmarkRunner,
  renderEngineBenchmarkReport,
  type EngineBenchmarkConfig,
  type EngineBenchmarkPolicy,
  type EngineKind
} from "../src/agents/learningAssistant/index.ts";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args["dry-run"]);
const policies = parsePolicies(stringArg(args.policies, "full,evidence_top_k,current_page_only,cache_first"));
const engine = stringArg(args.engine, process.env.ENGINE ?? "openai-compatible") as EngineKind;
const config: EngineBenchmarkConfig = {
  engine,
  baseUrl: stringArg(args["base-url"], process.env.BASE_URL),
  metricsUrl: stringArg(args["metrics-url"], process.env.METRICS_URL),
  model: stringArg(args.model, process.env.MODEL),
  stream: Boolean(args.stream),
  source: args.source === "recent_traces" ? "recent_traces" : "synthetic",
  requestCount: numberArg(args.requests, 10),
  qps: numberArg(args.qps, 1),
  concurrency: numberArg(args.concurrency, 4),
  policies,
  slo: {
    ttftMs: numberArg(args.ttftMs, 800),
    tpotMs: numberArg(args.tpotMs, 80),
    e2eMs: numberArg(args.e2eMs, 8000)
  },
  dryRun
};

if (!config.dryRun && (!config.baseUrl || !config.model)) {
  console.error("Real engine benchmark requires BASE_URL/base-url and MODEL/model. Use --dry-run for offline preview.");
  process.exit(1);
}

const runner = new EngineBenchmarkRunner();
const requests = runner.buildSyntheticRequests(config.requestCount, policies);
const report = await runner.run(config, requests, stringArg(args["api-key"], process.env.ENGINE_API_KEY));
const reportsDir = path.join(rootDir, "reports");
await fs.mkdir(reportsDir, { recursive: true });
await fs.writeFile(path.join(reportsDir, "engine-benchmark.json"), JSON.stringify(report, null, 2), "utf8");
await fs.writeFile(path.join(reportsDir, "engine-benchmark.md"), renderEngineBenchmarkReport(report), "utf8");
console.log(`Engine benchmark ${config.dryRun ? "dry-run " : ""}complete: ${requests.length} policy requests`);
console.log(path.join(reportsDir, "engine-benchmark.md"));

function parseArgs(values: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function stringArg(value: string | boolean | undefined, fallback?: string): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberArg(value: string | boolean | undefined, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePolicies(value: string | undefined): EngineBenchmarkPolicy[] {
  const allowed = new Set<EngineBenchmarkPolicy>(["full", "evidence_top_k", "current_page_only", "cache_first"]);
  const policies = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is EngineBenchmarkPolicy => allowed.has(item as EngineBenchmarkPolicy));
  return policies.length ? [...new Set(policies)] : ["full", "evidence_top_k", "current_page_only", "cache_first"];
}
