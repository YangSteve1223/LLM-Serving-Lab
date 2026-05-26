/**
 * Generate Full Report Script
 * 
 * Runs all experiments and generates a comprehensive markdown report:
 * 1. PD Simulation
 * 2. DeepSeek Benchmark (if API key provided)
 * 3. Calibration Pipeline
 * 4. Complete Markdown Report
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import {
  EnhancedPDServingSimulator,
  createPipeline,
  type PipelineRequest,
  type PDWorkloadRequest
} from "../src/agents/learningAssistant/serving/index.ts";
import {
  DeepSeekLatencyProber,
  createCalibrationPipeline,
  type LatencyBaseline
} from "../src/agents/learningAssistant/serving/index.ts";

const currentFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(currentFile, "..", "..");
const reportsDir = path.join(rootDir, "reports");

interface ReportOptions {
  runSimulation: boolean;
  runBenchmark: boolean;
  runCalibration: boolean;
  simulationRequests: number;
  benchmarkScenarios?: number;
  deepseekApiKey?: string;
}

const DEFAULT_OPTIONS: ReportOptions = {
  runSimulation: true,
  runBenchmark: false,
  runCalibration: false,
  simulationRequests: 200
};

async function generateSyntheticWorkload(count: number): Promise<PipelineRequest[]> {
  const requests: PipelineRequest[] = [];
  const templates = [
    "Explain the concept of {topic} in detail.",
    "What are the key differences between {a} and {b}?",
    "Describe how {process} works step by step.",
    "Discuss the importance of {concept} in modern applications.",
    "Compare and contrast {x} and {y} with examples.",
  ];
  
  const topics = ["machine learning", "neural networks", "transformers", "attention mechanisms", "deep learning"];
  const pairs = [
    ["supervised", "unsupervised"], ["CNN", "RNN"], ["training", "inference"],
    ["GPU", "TPU"], ["batch", "streaming"]
  ];
  
  for (let i = 0; i < count; i++) {
    const template = templates[Math.floor(Math.random() * templates.length)];
    let prompt = template
      .replace("{topic}", topics[Math.floor(Math.random() * topics.length)])
      .replace("{a}", pairs[Math.floor(Math.random() * pairs.length)][0])
      .replace("{b}", pairs[Math.floor(Math.random() * pairs.length)][1])
      .replace("{process}", "inference pipeline")
      .replace("{concept}", "optimization")
      .replace("{x}", pairs[Math.floor(Math.random() * pairs.length)][0])
      .replace("{y}", pairs[Math.floor(Math.random() * pairs.length)][1]);
    
    // Add some variation
    prompt += " Please provide examples and code snippets where applicable.";
    
    requests.push({
      id: `req-${i}`,
      prompt,
      maxTokens: Math.floor(Math.random() * 256) + 128,
      arrivalTimeMs: i * 100 + Math.random() * 50,
      priority: Math.floor(Math.random() * 5) + 1
    });
  }
  
  return requests;
}

async function runSimulationReport(requests: PipelineRequest[]) {
  console.log("\n=== Running PD Simulation ===");
  const pipeline = createPipeline();
  const report = await pipeline.runFullPipeline(requests, true);
  
  return report;
}

async function runBenchmarkReport(apiKey: string, scenarioCount = 3) {
  console.log("\n=== Running DeepSeek Benchmark ===");
  const prober = new DeepSeekLatencyProber(apiKey);
  
  // Run selected scenarios
  const scenarios = [
    { inputTokens: 128, outputTokens: 128, concurrency: 1, repetitions: 5 },
    { inputTokens: 512, outputTokens: 128, concurrency: 1, repetitions: 5 },
    { inputTokens: 2048, outputTokens: 256, concurrency: 1, repetitions: 3 },
  ].slice(0, scenarioCount);
  
  const results = [];
  for (const scenario of scenarios) {
    const result = await prober.runScenario(scenario);
    results.push(result);
  }
  
  const baseline: LatencyBaseline = {
    generatedAt: new Date().toISOString(),
    scenarios: results,
    overallStats: {
      avgTTFT: results.reduce((sum, r) => sum + r.stats.ttftMean, 0) / results.length,
      avgTPOT: results.reduce((sum, r) => sum + r.stats.tpotMean, 0) / results.length,
      avgThroughput: results.reduce((sum, r) => sum + r.stats.throughputMean, 0) / results.length,
      avgE2E: results.reduce((sum, r) => sum + r.stats.e2eMean, 0) / results.length
    }
  };
  
  // Save baseline
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.writeFile(
    path.join(reportsDir, "deepseek-latency-baseline.json"),
    JSON.stringify(baseline, null, 2),
    "utf-8"
  );
  
  console.log(`Saved baseline to ${path.join(reportsDir, "deepseek-latency-baseline.json")}`);
  
  return baseline;
}

async function runCalibrationReport(apiKey?: string) {
  console.log("\n=== Running Calibration Pipeline ===");
  
  // Generate synthetic workload
  const workloadRequests: PDWorkloadRequest[] = [];
  for (let i = 0; i < 50; i++) {
    workloadRequests.push({
      id: `calib-${i}`,
      inputTokens: Math.floor(Math.random() * 2000) + 128,
      outputTokens: Math.floor(Math.random() * 256) + 64,
      arrivalTimeMs: i * 200,
      priority: Math.floor(Math.random() * 5) + 1
    });
  }
  
  const calibrationPipeline = createCalibrationPipeline(apiKey);
  
  // Try to load baseline if exists
  try {
    const baselinePath = path.join(reportsDir, "deepseek-latency-baseline.json");
    await fs.access(baselinePath);
    await calibrationPipeline.loadBaseline(baselinePath);
    console.log("Loaded existing DeepSeek baseline for calibration");
  } catch {
    console.log("No existing baseline found, running without DeepSeek measurements");
  }
  
  const report = await calibrationPipeline.calibrate(workloadRequests);
  
  // Save calibration report
  await fs.mkdir(reportsDir, { recursive: true });
  await calibrationPipeline.saveReport(report, path.join(reportsDir, "calibration-report.md"));
  console.log(`Saved calibration report to ${path.join(reportsDir, "calibration-report.md")}`);
  
  return report;
}

function generateMarkdownReport(
  simulationReport: any,
  benchmarkReport: LatencyBaseline | null,
  calibrationReport: any
): string {
  let md = `# LLM Serving Lab - Full Research Report

**Generated:** ${new Date().toISOString()}

## Executive Summary

This report presents the complete analysis of the LLM Serving Lab research platform, covering:

- PD (Prefill/Decode) Separation Simulation
- DeepSeek Real API Benchmarking (${benchmarkReport ? "included" : "not available"})
- Simulator Calibration Results

---

## 1. PD Separation Simulation Results

### Overview

| Metric | Value |
|--------|-------|
| Total Requests | ${simulationReport.totalRequests} |
| Cache Hit Rate | ${(simulationReport.cacheStats.hitRate * 100).toFixed(1)}% |
| Avg Input Tokens | ${simulationReport.tokenStats.avgInputTokens} |
| Avg Output Tokens | ${simulationReport.tokenStats.avgOutputTokens} |
| Total Tokens | ${simulationReport.tokenStats.totalTokens} |

### Cache Performance

- **Hit Rate:** ${(simulationReport.cacheStats.hitRate * 100).toFixed(1)}%
- **Total Cacheable Tokens:** ${simulationReport.cacheStats.totalCacheableTokens}
- **Saved Compute Tokens:** ${simulationReport.cacheStats.savedComputeTokens}

### SLO Compliance

| SLO Metric | Compliance |
|-----------|------------|
| TTFT | ${(simulationReport.sloCompliance.ttftCompliance * 100).toFixed(1)}% |
| TPOT | ${(simulationReport.sloCompliance.tpotCompliance * 100).toFixed(1)}% |
| E2E | ${(simulationReport.sloCompliance.e2eCompliance * 100).toFixed(1)}% |

`;

  if (simulationReport.strategyComparisons && simulationReport.strategyComparisons.length > 0) {
    md += `### Strategy Comparison

| Policy | Avg TTFT | Avg TPOT | Avg E2E | Throughput | SLO Compliance |
|--------|----------|----------|---------|------------|----------------|
`;
    for (const comparison of simulationReport.strategyComparisons) {
      md += `| ${comparison.policy} | ${comparison.metrics.avgTTFT.toFixed(1)}ms | ${comparison.metrics.avgTPOT.toFixed(1)}ms | ${comparison.metrics.avgE2E.toFixed(1)}ms | ${comparison.metrics.throughput.toFixed(1)} tok/s | ${(comparison.metrics.sloCompliance * 100).toFixed(1)}% |\n`;
    }
    md += `\n`;
  }

  if (benchmarkReport) {
    md += `---

## 2. DeepSeek Real API Benchmark Results

**Baseline Generated:** ${benchmarkReport.generatedAt}

### Overall Statistics

| Metric | Value |
|--------|-------|
| Average TTFT | ${benchmarkReport.overallStats.avgTTFT.toFixed(1)}ms |
| Average TPOT | ${benchmarkReport.overallStats.avgTPOT.toFixed(1)}ms |
| Average Throughput | ${benchmarkReport.overallStats.avgThroughput.toFixed(1)} tok/s |
| Average E2E | ${benchmarkReport.overallStats.avgE2E.toFixed(1)}ms |

### Scenario Results

| Scenario | TTFT (P50) | TTFT (P95) | TPOT (P50) | TPOT (P95) | Throughput |
|----------|------------|------------|------------|------------|------------|
`;
    for (const scenario of benchmarkReport.scenarios) {
      md += `| ${scenario.scenario.inputTokens}in/${scenario.scenario.outputTokens}out x${scenario.scenario.concurrency} | ${scenario.stats.ttftP50.toFixed(1)}ms | ${scenario.stats.ttftP95.toFixed(1)}ms | ${scenario.stats.tpotP50.toFixed(1)}ms | ${scenario.stats.tpotP95.toFixed(1)}ms | ${scenario.stats.throughputMean.toFixed(1)} tok/s |\n`;
    }
    md += `\n`;
  }

  if (calibrationReport) {
    md += `---

## 3. Simulator Calibration Results

**Overall Status:** ${calibrationReport.overallStatus.toUpperCase()}

### Calibration Summary

| Metric | MAPE | Tolerance | Status |
|--------|------|-----------|--------|
| TTFT | ${calibrationReport.summary.ttftMAPE.toFixed(1)}% | ±15% | ${calibrationReport.summary.ttftMAPE <= 15 ? "✓" : "✗"} |
| TPOT | ${calibrationReport.summary.tpotMAPE.toFixed(1)}% | ±10% | ${calibrationReport.summary.tpotMAPE <= 10 ? "✓" : "✗"} |
| All Within Tolerance | ${calibrationReport.summary.allWithinTolerance ? "Yes" : "No"} | - | ${calibrationReport.summary.allWithinTolerance ? "✓" : "✗"} |

### Stage Results

`;
    for (const stage of calibrationReport.stages) {
      md += `#### ${stage.stage.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}

- **Status:** ${stage.status.toUpperCase()}
- **Details:** ${stage.details}

`;
      if (stage.recommendations.length > 0) {
        md += `**Recommendations:**\n`;
        for (const rec of stage.recommendations) {
          md += `- ${rec}\n`;
        }
        md += `\n`;
      }
    }
  }

  md += `---

## 4. Conclusions and Recommendations

### Key Findings

1. **PD Separation:** The simulation shows effective prefill/decode separation with configurable chunking
2. **Cache Efficiency:** ${(simulationReport.cacheStats.hitRate * 100).toFixed(1)}% cache hit rate${simulationReport.cacheStats.hitRate > 0.3 ? " indicating good prefix reuse" : ""}
3. **SLO Compliance:** ${(Math.min(simulationReport.sloCompliance.ttftCompliance, simulationReport.sloCompliance.tpotCompliance, simulationReport.sloCompliance.e2eCompliance) * 100).toFixed(1)}% minimum compliance across all SLOs
`;

  if (calibrationReport) {
    if (calibrationReport.summary.allWithinTolerance) {
      md += `\n4. **Calibration Status:** Simulator predictions are within acceptable tolerance of real measurements`;
    } else {
      md += `\n4. **Calibration Status:** Simulator requires further tuning to match real API behavior`;
    }
  }

  md += `

### Next Steps

1. Collect more DeepSeek benchmark data across diverse scenarios
2. Fine-tune calibration coefficients based on measured errors
3. Extend scheduling policies to cover more edge cases
4. Implement adaptive batching based on workload characteristics

---

*Report generated by LLM Serving Lab*
`;

  return md;
}

async function main() {
  const args = process.argv.slice(2);
  const options: ReportOptions = { ...DEFAULT_OPTIONS };
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--no-simulation") options.runSimulation = false;
    if (args[i] === "--benchmark") options.runBenchmark = true;
    if (args[i] === "--calibration") options.runCalibration = true;
    if (args[i] === "--api-key" && args[i + 1]) {
      options.deepseekApiKey = args[i + 1];
      options.runBenchmark = true;
      options.runCalibration = true;
      i++;
    }
    if (args[i] === "--requests" && args[i + 1]) {
      options.simulationRequests = parseInt(args[i + 1], 10);
      i++;
    }
  }
  
  // Check for API key in environment
  if (!options.deepseekApiKey) {
    options.deepseekApiKey = process.env.DEEPSEEK_API_KEY;
  }
  
  console.log("LLM Serving Lab - Full Report Generator");
  console.log("========================================");
  console.log("Options:", options);
  
  // Ensure reports directory exists
  await fs.mkdir(reportsDir, { recursive: true });
  
  // Generate workload
  const workload = await generateSyntheticWorkload(options.simulationRequests);
  
  // Run experiments
  let simulationReport = null;
  let benchmarkReport: LatencyBaseline | null = null;
  let calibrationReport = null;
  
  if (options.runSimulation) {
    simulationReport = await runSimulationReport(workload);
  }
  
  if (options.runBenchmark && options.deepseekApiKey) {
    try {
      benchmarkReport = await runBenchmarkReport(options.deepseekApiKey);
    } catch (error) {
      console.error("Benchmark failed:", error);
    }
  }
  
  if (options.runCalibration) {
    try {
      calibrationReport = await runCalibrationReport(options.deepseekApiKey);
    } catch (error) {
      console.error("Calibration failed:", error);
    }
  }
  
  // Generate and save final report
  if (simulationReport) {
    const md = generateMarkdownReport(
      simulationReport,
      benchmarkReport,
      calibrationReport
    );
    
    const reportPath = path.join(reportsDir, "full-report.md");
    await fs.writeFile(reportPath, md, "utf-8");
    console.log(`\n=== Report saved to ${reportPath} ===`);
  }
  
  console.log("\nDone!");
}

// Run
main().catch(console.error);
