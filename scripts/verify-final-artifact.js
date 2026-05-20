import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const reportsDir = path.join(rootDir, "reports");
mkdirSync(reportsDir, { recursive: true });

const checks = [];
const commands = [
  ["npm", ["run", "test:serving"]],
  ["npm", ["test"]],
  ["npm", ["run", "simulate:pd"]],
  ["npm", ["run", "benchmark:engine"]],
  ["npm", ["run", "generate:code-context"]]
];

for (const command of commands) {
  const result = runCommand(command[0], command[1]);
  checks.push({
    name: `${command[0]} ${command[1].join(" ")}`,
    passed: result.status === 0,
    details: result.status === 0 ? "passed" : [result.error?.message, result.stdout, result.stderr].filter(Boolean).join("\n").slice(0, 5000)
  });
}

const requiredFiles = [
  "docs/LEARN_AGENT_项目完整说明书.docx",
  "docs/LEARN_AGENT_项目完整说明书.md",
  "reports/LEARN_AGENT_CODE_CONTEXT_FOR_AI.txt",
  "docs/final-research-report.md",
  "docs/learning-guide.md",
  "reports/engine-benchmark.md",
  "reports/pd-simulation.md"
];
for (const file of requiredFiles) checks.push({ name: `required file exists: ${file}`, passed: existsSync(path.join(rootDir, file)) });

const scannedFiles = listFiles(["src", "examples", "docs", "scripts", "tests", "reports", "README.md", "package.json", ".gitignore"]);
const secretHits = [];
for (const file of scannedFiles) {
  const rel = path.relative(rootDir, file).replace(/\\/g, "/");
  if (rel.includes("删除审查区/") || rel.includes("delete_review/")) continue;
  if (/\.(png|jpg|jpeg|gif|docx|pptx|zip|pdf)$/i.test(rel)) continue;
  const text = readFileSync(file, "utf8");
  if (rel === "tests/learning-loop/learner-memory.test.ts" && text.includes("Intentional fake key fixture")) continue;
  if (/sk-[A-Za-z0-9_-]{20,}/.test(text)) secretHits.push(`${rel}: sk-*`);
  if (/xai-[A-Za-z0-9_-]{20,}/.test(text)) secretHits.push(`${rel}: xai-*`);
  if (/anthropic-[A-Za-z0-9_-]{20,}/i.test(text)) secretHits.push(`${rel}: anthropic-*`);
  if (/\bapiKey\b\s*[:=]\s*["'][A-Za-z0-9_-]{20,}["']/.test(text)) secretHits.push(`${rel}: apiKey literal`);
  if (/\brawPrompt\s*:/.test(text) && rel.startsWith("reports/")) secretHits.push(`${rel}: rawPrompt`);
  if (/\brawAnswer\s*:/.test(text) && rel.startsWith("reports/")) secretHits.push(`${rel}: rawAnswer`);
}
checks.push({ name: "secret/raw prompt scan", passed: secretHits.length === 0, details: secretHits.join("\n") || "no matches" });

const engineReportMd = readIfExists("reports/engine-benchmark.md");
const engineReportJson = readIfExists("reports/engine-benchmark.json");
checks.push({
  name: "dry-run benchmark truthfulness",
  passed:
    /Dry-run validates workload shape and prompt component statistics only/i.test(engineReportMd) &&
    /does not measure (real )?TTFT, ITL, E2E, or SLO goodput/i.test(engineReportMd) &&
    /Actual goodput under SLO/.test(engineReportMd) &&
    /actualGoodputUnderSLO=n\/a/.test(engineReportMd) &&
    !/\|\s*Goodput\s*\|/.test(engineReportMd) &&
    !/Goodput\s*\|\s*100%/.test(engineReportMd) &&
    /"latencyMeasurementMode"\s*:\s*"dry_run_unmeasured"/.test(engineReportJson) &&
    /"actualGoodputUnderSLO"\s*:\s*null/.test(engineReportJson),
  details: "dry-run must expose workload success but not actual SLO goodput"
});

const pdReportMd = readIfExists("reports/pd-simulation.md");
checks.push({
  name: "PD simulation truthfulness",
  passed:
    /Measurement mode: simulated/i.test(pdReportMd) &&
    /estimatedGoodputUnderSLO/.test(pdReportMd) &&
    /trace-driven what-if estimates/i.test(pdReportMd) &&
    /not real GPU/i.test(pdReportMd) &&
    !/real GPU measurement/i.test(pdReportMd.replace(/not real GPU measurements/gi, "")),
  details: "PD simulation must be labeled estimated/simulated"
});

const allPassed = checks.every((check) => check.passed);
const report = { generatedAt: new Date().toISOString(), passed: allPassed, checks };
writeFileSync(path.join(reportsDir, "final-verification.json"), JSON.stringify(report, null, 2), "utf8");
writeFileSync(path.join(reportsDir, "final-verification.md"), renderMarkdown(report), "utf8");

if (!allPassed) {
  console.error("Final verification failed. See reports/final-verification.md");
  process.exit(1);
}
console.log("Final verification passed.");
console.log(path.join(reportsDir, "final-verification.md"));

function runCommand(command, args) {
  if (process.platform === "win32") {
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", [command, ...args].join(" ")], { cwd: rootDir, encoding: "utf8" });
  }
  return spawnSync(command, args, { cwd: rootDir, encoding: "utf8" });
}

function listFiles(entries) {
  const files = [];
  for (const entry of entries) {
    const full = path.join(rootDir, entry);
    if (!existsSync(full)) continue;
    const stat = statSync(full);
    if (stat.isFile()) files.push(full);
    else if (stat.isDirectory()) walk(full, files);
  }
  return files;
}

function walk(dir, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "删除审查区", "delete_review", "DELETE_REVIEW", ".cache"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile()) files.push(full);
  }
}

function readIfExists(relative) {
  const full = path.join(rootDir, relative);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function renderMarkdown(report) {
  const lines = [
    "# Final Verification",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    `Overall: ${report.passed ? "PASS" : "FAIL"}`,
    "",
    "| Check | Result | Details |",
    "| --- | --- | --- |"
  ];
  for (const check of report.checks) {
    lines.push(`| ${check.name} | ${check.passed ? "PASS" : "FAIL"} | ${(check.details ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")} |`);
  }
  lines.push(
    "",
    "## Measurement Boundaries",
    "",
    "- Dry-run benchmark validates workload and prompt accounting only; it does not measure actual SLO goodput.",
    "- PD simulation metrics are estimated/simulated, not real GPU measurements.",
    "- Real TTFT/ITL/E2E require a streaming endpoint.",
    "- Real vLLM/SGLang cache metrics require a running engine with `/metrics`.",
    "- The code context package redacts API-key-like strings and excludes raw benchmark prompts/answers."
  );
  return `${lines.join("\n")}\n`;
}
