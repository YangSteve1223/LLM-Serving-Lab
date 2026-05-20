import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outPath = path.join(root, "reports", "LEARN_AGENT_CODE_CONTEXT_FOR_AI.txt");
mkdirSync(path.dirname(outPath), { recursive: true });

const includeExtensions = new Set([".ts", ".js", ".md", ".json", ".txt"]);
const includeRoots = ["src", "examples", "scripts", "tests", "docs"];
const explicit = ["README.md", "package.json", "tsconfig.json"];
const files = collectFiles()
  .filter(shouldInclude)
  .sort((a, b) => rel(a).localeCompare(rel(b)));

const lines = [];
lines.push("================================================================================");
lines.push("LEARN_AGENT CODE CONTEXT FOR AI");
lines.push(`Generated at: ${new Date().toISOString()}`);
lines.push("Purpose: portable source/context bundle for another AI model to read the project without GitHub access.");
lines.push("Safety note: API-key-like strings are redacted; raw prompts and raw answers from reports are not included.");
lines.push("================================================================================");
lines.push("");
lines.push("SECTION 1: PROJECT SUMMARY");
lines.push("LEARN_AGENT is an educational-agent workload and cache-aware / PD-aware LLM serving research harness.");
lines.push("Default tests and dry-run benchmark require no GPU. Real TTFT/ITL/E2E require a streaming endpoint. Real vLLM/SGLang cache metrics require /metrics. PD results are simulated unless a real disaggregated engine is configured.");
lines.push("");
lines.push("SECTION 2: DIRECTORY TREE");
lines.push("```text");
lines.push(buildTree(root, 0, 4));
lines.push("```");
lines.push("");
lines.push("SECTION 3: PACKAGE AND SCRIPTS");
appendFile("package.json", "Project package metadata and npm scripts.");
lines.push("");
lines.push("SECTION 4: ARCHITECTURE OVERVIEW");
lines.push("/api/ask -> build LearningContext -> LearningAssistantAgent.answer -> context/question/student/policy analysis -> retrieval -> evidence selection -> answerability -> prompt generation -> LLM/fallback -> servingTrace -> response.");
lines.push("Serving modules add token estimates, phase timers, PD simulation, context budget suggestions, cache-aware prompt plans, streaming benchmark clients, and vLLM/SGLang metrics adapters.");
lines.push("");
lines.push("SECTION 5: CORE SOURCE FILES");
for (const file of files) {
  const relative = rel(file);
  if (relative === "package.json") continue;
  const text = sanitize(readFileSync(file, "utf8"));
  lines.push(`----- FILE START: ${relative} -----`);
  lines.push(`[Summary: ${summarize(relative)}]`);
  lines.push(text);
  lines.push(`----- FILE END: ${relative} -----`);
  lines.push("");
}
lines.push("SECTION 6: TESTING AND VERIFICATION");
lines.push("Recent expected commands:");
lines.push("- npm run test:serving");
lines.push("- npm test");
lines.push("- npm run simulate:pd");
lines.push("- npm run benchmark:engine");
lines.push("- npm run generate:code-context");
lines.push("- npm run verify:final");
if (existsSync(path.join(root, "reports", "final-verification.md"))) {
  lines.push("");
  lines.push("Latest final verification summary:");
  lines.push(sanitize(readFileSync(path.join(root, "reports", "final-verification.md"), "utf8")));
}
lines.push("");
lines.push("SECTION 7: LIMITATIONS");
lines.push("- No real GPU endpoint in the default environment.");
lines.push("- No real PD disaggregation unless a real disaggregated engine is configured.");
lines.push("- Dry-run has no TTFT/ITL/E2E measurement.");
lines.push("- TokenEstimator is heuristic, not tokenizer-exact.");
lines.push("- Quality proxy is not human evaluation.");
lines.push("");
lines.push("SECTION 8: HOW ANOTHER AI SHOULD READ THIS PROJECT");
lines.push("1. Read PROJECT SUMMARY and README.md.");
lines.push("2. Read LearningAssistantAgent.ts for the education-agent pipeline.");
lines.push("3. Read src/agents/learningAssistant/serving/*.ts for trace, token, simulator, and cache logic.");
lines.push("4. Read src/agents/learningAssistant/serving/engines/*.ts for streaming and metrics bridge.");
lines.push("5. Read scripts/run-pd-simulation.ts and scripts/run-engine-benchmark.ts for experiment entry points.");
lines.push("6. Read tests/serving/**/*.test.ts to understand expected behavior and metric truthfulness.");

writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`Generated ${path.relative(root, outPath)}`);
console.log(`Included ${files.length} text files`);

function collectFiles() {
  const out = [];
  for (const rootName of includeRoots) {
    const full = path.join(root, rootName);
    if (existsSync(full)) walk(full, out);
  }
  for (const file of explicit) {
    const full = path.join(root, file);
    if (existsSync(full)) out.push(full);
  }
  return Array.from(new Set(out));
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (shouldSkipDir(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

function shouldSkipDir(name) {
  return ["node_modules", ".git", "delete_review", "DELETE_REVIEW", "删除审查区", ".cache", "serving-output", "snapshots", ".tmp-memory", ".tmp-resource-library"].includes(name);
}

function shouldInclude(file) {
  const relative = rel(file);
  if (/^tests\/TEST-202\d+/.test(relative)) return false;
  if (/^tests\/\d{8}-/.test(relative)) return false;
  if (/^reports\//.test(relative)) return false;
  if (/\.(png|jpg|jpeg|gif|pdf|zip|docx|pptx|ppt)$/i.test(relative)) return false;
  if (relative.endsWith("package-lock.json")) return false;
  const ext = path.extname(file).toLowerCase();
  return includeExtensions.has(ext);
}

function appendFile(relative, summary) {
  const full = path.join(root, relative);
  if (!existsSync(full)) return;
  lines.push(`----- FILE START: ${relative} -----`);
  lines.push(`[Summary: ${summary}]`);
  lines.push(sanitize(readFileSync(full, "utf8")));
  lines.push(`----- FILE END: ${relative} -----`);
}

function sanitize(text) {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED_SK_PATTERN]")
    .replace(/xai-[A-Za-z0-9_-]{8,}/g, "[REDACTED_XAI_PATTERN]")
    .replace(/anthropic-[A-Za-z0-9_-]{8,}/gi, "[REDACTED_ANTHROPIC_PATTERN]")
    .replace(/(apiKey\s*[:=]\s*["'])[A-Za-z0-9_-]{20,}(["'])/g, "$1[REDACTED_API_KEY]$2");
}

function summarize(relative) {
  if (relative.endsWith("LearningAssistantAgent.ts")) return "Main education-agent pipeline and serving trace integration.";
  if (relative.includes("/serving/engines/")) return "SOTA engine bridge, streaming, metrics, or benchmark type logic.";
  if (relative.includes("/serving/")) return "PD-aware serving lab module: trace, token, simulator, context budget, or cache prompt logic.";
  if (relative.startsWith("tests/serving/")) return "Serving lab unit/regression test.";
  if (relative.startsWith("scripts/")) return "CLI or artifact generation script.";
  if (relative.startsWith("docs/")) return "Project documentation and learning material.";
  return "Project source or test file.";
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function buildTree(dir, depth, maxDepth) {
  if (depth > maxDepth) return "";
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => ![".git", "node_modules", "删除审查区", "delete_review", "DELETE_REVIEW", ".cache"].includes(entry.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const rows = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const prefix = "  ".repeat(depth);
    rows.push(`${prefix}- ${entry.name}${entry.isDirectory() ? "/" : ""}`);
    if (entry.isDirectory()) {
      const child = buildTree(full, depth + 1, maxDepth);
      if (child) rows.push(child);
    }
  }
  return rows.join("\n");
}
