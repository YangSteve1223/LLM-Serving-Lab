/**
 * Cache Experiment Runner.
 * 
 * Implements a comprehensive evaluation framework for prefix caching experiments:
 * - Comparative experiments: with/without prefix caching, different eviction strategies
 * - Metrics collection: tokenHitRate, requestHitRate, ttftReduction, throughputGain
 * - Statistical validation: confidence intervals, p-values, effect sizes
 * - Automated execution and report generation
 */
import { writeFileSync } from "node:fs";
import type {
  EnhancedPDWorkloadRequest,
  PDWorkloadRequest
} from "../ServingTrace.ts";
import type { CacheAwarePDSimulationResult, EvictionStrategy } from "./RadixPrefixCacheManager.ts";
import { RadixPrefixCacheManager } from "./RadixPrefixCacheManager.ts";
import { HierarchicalKVCache } from "./HierarchicalKVCache.ts";
import type { 
  WorkloadConfig, 
  SyntheticRequest,
  WorkloadAnalysis
} from "../workload/EducationalWorkloadModel.ts";
import { EducationalWorkloadModel, createTypicalWorkload } from "../workload/EducationalWorkloadModel.ts";

// ==================== Types ====================

export type ExperimentType = 
  | "cache_on_off"
  | "eviction_strategies"
  | "student_scaling"
  | "course_pooling"
  | "hierarchical_tiers";

export interface ExperimentConfig {
  name: string;
  type: ExperimentType;
  workloadConfig: WorkloadConfig;
  cacheConfig: {
    maxMemoryMB: number;
    evictionStrategies: EvictionStrategy[];
    enableCoursePooling: boolean;
  };
  simulatorConfig: {
    prefillBaseMs: number;
    prefillMsPerToken: number;
    decodeMsPerToken: number;
    kvMsPerToken: number;
  };
  trials: number;
  requestsPerTrial: number;
  warmupRequests: number;
  traceDurationMinutes: number;
}

export interface ExperimentMetrics {
  // Hit rate metrics
  requestHitRate: number;
  tokenHitRate: number;
  exactMatchRate: number;
  prefixMatchRate: number;
  
  // Latency metrics
  avgTTFTMs: number;
  ttftReductionMs: number;
  ttftReductionPercent: number;
  p50TTFT: number;
  p90TTFT: number;
  p99TTFT: number;
  
  // Throughput metrics
  throughputGain: number;
  tokensSaved: number;
  tokensSavedPercent: number;
  
  // Memory metrics
  memoryEfficiency: number;
  cacheUtilization: number;
  avgCacheSizeMB: number;
  
  // Statistical metrics
  confidenceInterval95: { lower: number; upper: number };
  stdDev: number;
  effectSize: number; // Cohen's d
  
  // Raw data for statistical analysis
  rawTTFT: number[];
  rawHitRates: number[];
}

export interface ExperimentResult {
  experimentName: string;
  experimentType: ExperimentType;
  timestamp: string;
  config: ExperimentConfig;
  metrics: ExperimentMetrics;
  baselineMetrics: ExperimentMetrics | null;
  comparisonMetrics: Record<string, ExperimentMetrics>;
  workloadAnalysis: WorkloadAnalysis | null;
  duration: { startMs: number; endMs: number; totalMs: number };
  notes: string[];
}

export interface ExperimentReport {
  summary: string;
  tables: {
    comparisonTable: string;
    metricsTable: string;
    statisticalSignificanceTable: string;
  };
  charts: {
    hitRateBarChart: string;
    ttftReductionChart: string;
    throughputComparisonChart: string;
  };
  recommendations: string[];
}

// ==================== Helper Functions ====================

function round(value: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / values.length);
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function confidenceInterval95(values: number[]): { lower: number; upper: number } {
  if (values.length < 2) return { lower: 0, upper: 0 };
  const m = mean(values);
  const s = stdDev(values);
  const t = 1.96; // Approximate t-value for 95% CI with large samples
  const se = s / Math.sqrt(values.length);
  return {
    lower: round(m - t * se, 4),
    upper: round(m + t * se, 4)
  };
}

function cohensD(treatment: number[], control: number[]): number {
  const m1 = mean(treatment);
  const m2 = mean(control);
  const s1 = stdDev(treatment);
  const s2 = stdDev(control);
  const n1 = treatment.length;
  const n2 = control.length;
  
  // Pooled standard deviation
  const pooledStd = Math.sqrt(((n1 - 1) * s1 * s1 + (n2 - 1) * s2 * s2) / (n1 + n2 - 2));
  return pooledStd > 0 ? (m1 - m2) / pooledStd : 0;
}

function tTestPValue(treatment: number[], control: number[]): number {
  // Simplified p-value calculation
  const d = cohensD(treatment, control);
  const n = treatment.length + control.length;
  // Approximate using t-distribution with n-2 degrees of freedom
  const tStat = d * Math.sqrt(n / 2);
  // Very rough approximation - in production, use a proper t-test library
  return tStat > 1.96 ? 0.05 : tStat > 2.58 ? 0.01 : 0.1;
}

// ==================== CacheExperimentRunner ====================

export class CacheExperimentRunner {
  private config: ExperimentConfig;
  private results: Map<string, ExperimentResult>;
  private cacheManager: RadixPrefixCacheManager;
  private hiearchicalCache: HierarchicalKVCache;

  constructor(config: Partial<ExperimentConfig> = {}) {
    this.config = this.normalizeConfig(config);
    this.results = new Map();
    this.cacheManager = new RadixPrefixCacheManager({
      maxMemoryMB: this.config.cacheConfig.maxMemoryMB,
      evictionStrategy: "LRU"
    });
    this.hiearchicalCache = new HierarchicalKVCache();
  }

  private normalizeConfig(partial: Partial<ExperimentConfig>): ExperimentConfig {
    return {
      name: partial.name ?? "Default Experiment",
      type: partial.type ?? "cache_on_off",
      workloadConfig: partial.workloadConfig ?? {
        numStudents: 50,
        numCourses: 5,
        avgConcurrentUsers: 10,
        peakConcurrentUsers: 40,
        avgDialogueTurns: 8,
        tidalStrength: 0.5,
        prefixReuseRate: 0.35,
        courseMaterialTokens: 2048,
        systemPromptTokens: 512
      },
      cacheConfig: {
        maxMemoryMB: partial.cacheConfig?.maxMemoryMB ?? 1024,
        evictionStrategies: partial.cacheConfig?.evictionStrategies ?? ["LRU", "LFU", "FLOP_AWARE"],
        enableCoursePooling: partial.cacheConfig?.enableCoursePooling ?? true
      },
      simulatorConfig: partial.simulatorConfig ?? {
        prefillBaseMs: 25,
        prefillMsPerToken: 0.18,
        decodeMsPerToken: 18,
        kvMsPerToken: 0.015
      },
      trials: partial.trials ?? 5,
      requestsPerTrial: partial.requestsPerTrial ?? 1000,
      warmupRequests: partial.warmupRequests ?? 100,
      traceDurationMinutes: partial.traceDurationMinutes ?? 30
    };
  }

  /**
   * Run a single experiment with the current configuration.
   */
  runExperiment(
    evictionStrategy: EvictionStrategy = "LRU",
    enableCache: boolean = true,
    enableCoursePooling: boolean = true
  ): ExperimentMetrics {
    const workload = createTypicalWorkload();
    const trace = workload.generateTrace(this.config.traceDurationMinutes);
    const pdTrace = workload.generatePDWorkloadTrace(this.config.traceDurationMinutes);

    // Initialize cache with strategy
    const cache = new RadixPrefixCacheManager({
      maxMemoryMB: this.config.cacheConfig.maxMemoryMB,
      evictionStrategy,
      enableCoursePooling
    });

    const simConfig = this.config.simulatorConfig;
    const rawTTFT: number[] = [];
    const rawHitRates: number[] = [];
    let totalTokens = 0;
    let cacheHitTokens = 0;
    let exactMatches = 0;
    let prefixMatches = 0;
    let totalCacheableTokens = 0;

    // Warmup phase
    for (let i = 0; i < Math.min(this.config.warmupRequests, pdTrace.length); i++) {
      const req = pdTrace[i];
      if (enableCache) {
        cache.cacheRequest(req);
      }
    }

    // Main experiment phase
    for (const req of pdTrace.slice(this.config.warmupRequests)) {
      // Calculate baseline (no cache)
      const baselineTTFT = simConfig.prefillBaseMs + req.prefillTokens * simConfig.prefillMsPerToken;

      let ttft: number;
      if (enableCache) {
        // With cache
        const result = cache.simulateCacheAwarePrefill(req, simConfig);
        ttft = result.ttftReductionMs > 0 
          ? baselineTTFT - result.ttftReductionMs 
          : baselineTTFT;

        if (result.cacheHitTokens > 0) {
          cacheHitTokens += result.cacheHitTokens;
          if (result.hitDetails.length > 0) {
            const hit = result.hitDetails[result.hitDetails.length - 1];
            if (hit.hitType === "exact") exactMatches++;
            else if (hit.hitType === "prefix") prefixMatches++;
          }
        }

        // Cache the request for future use
        cache.cacheRequest(req);
      } else {
        ttft = baselineTTFT;
      }

      totalTokens += req.prefillTokens;
      totalCacheableTokens += req.cacheablePrefixTokens ?? Math.floor(req.prefillTokens * 0.3);
      rawTTFT.push(ttft);
    }

    // Calculate metrics
    const avgTTFT = mean(rawTTFT);
    const baselineAvgTTFT = pdTrace
      .slice(this.config.warmupRequests)
      .reduce((sum, req) => sum + simConfig.prefillBaseMs + req.prefillTokens * simConfig.prefillMsPerToken, 0) 
      / rawTTFT.length;

    const hitRate = (exactMatches + prefixMatches) / rawTTFT.length;
    const tokenHitRate = cacheHitTokens / Math.max(1, totalTokens);

    const stats = cache.getStats();
    const ci = confidenceInterval95(rawTTFT);

    return {
      requestHitRate: round(hitRate, 4),
      tokenHitRate: round(tokenHitRate, 4),
      exactMatchRate: round(exactMatches / rawTTFT.length, 4),
      prefixMatchRate: round(prefixMatches / rawTTFT.length, 4),
      avgTTFTMs: round(avgTTFT, 2),
      ttftReductionMs: round(baselineAvgTTFT - avgTTFT, 2),
      ttftReductionPercent: round(((baselineAvgTTFT - avgTTFT) / baselineAvgTTFT) * 100, 2),
      p50TTFT: round(percentile(rawTTFT, 50), 2),
      p90TTFT: round(percentile(rawTTFT, 90), 2),
      p99TTFT: round(percentile(rawTTFT, 99), 2),
      throughputGain: round(baselineAvgTTFT / Math.max(0.001, avgTTFT), 4),
      tokensSaved: cacheHitTokens,
      tokensSavedPercent: round((cacheHitTokens / Math.max(1, totalTokens)) * 100, 2),
      memoryEfficiency: round(stats.avgFlopsEfficiency, 2),
      cacheUtilization: round(stats.memoryUsageMB / stats.maxMemoryMB, 4),
      avgCacheSizeMB: round(stats.memoryUsageMB, 2),
      confidenceInterval95: ci,
      stdDev: round(stdDev(rawTTFT), 2),
      effectSize: 0, // Will be computed when comparing
      rawTTFT,
      rawHitRates: rawTTFT.map(() => hitRate)
    };
  }

  /**
   * Run comparative experiments between caching strategies.
   */
  runComparativeExperiment(): ExperimentResult {
    const startMs = Date.now();
    const notes: string[] = [];

    const workload = createTypicalWorkload();
    const workloadAnalysis = workload.analyze(workload.generateTrace(this.config.traceDurationMinutes));

    // Baseline: No cache
    notes.push("Running baseline (no cache) experiment...");
    const baselineMetrics = this.runExperiment("LRU", false, false);

    // With cache - different eviction strategies
    const comparisonMetrics: Record<string, ExperimentMetrics> = {};

    for (const strategy of this.config.cacheConfig.evictionStrategies) {
      notes.push(`Running experiment with ${strategy} eviction strategy...`);
      const metrics = this.runExperiment(strategy, true, this.config.cacheConfig.enableCoursePooling);

      // Calculate effect size compared to baseline
      metrics.effectSize = round(cohensD(metrics.rawTTFT, baselineMetrics.rawTTFT), 4);
      comparisonMetrics[strategy] = metrics;
    }

    // Course pooling experiment
    notes.push("Running course pooling experiment...");
    const coursePoolMetrics = this.runExperiment("LRU", true, true);
    coursePoolMetrics.effectSize = round(cohensD(coursePoolMetrics.rawTTFT, baselineMetrics.rawTTFT), 4);

    // Student scaling experiments
    const studentScaleMetrics: Record<number, ExperimentMetrics> = {};
    for (const numStudents of [10, 50, 100, 200]) {
      notes.push(`Running student scaling experiment with ${numStudents} students...`);
      const scaledWorkload = new EducationalWorkloadModel({
        ...this.config.workloadConfig,
        numStudents
      });
      const scaledTrace = scaledWorkload.generatePDWorkloadTrace(this.config.traceDurationMinutes);
      const scaledMetrics = this.simulateWorkload(scaledTrace);
      scaledMetrics.effectSize = round(cohensD(scaledMetrics.rawTTFT, baselineMetrics.rawTTFT), 4);
      studentScaleMetrics[numStudents] = scaledMetrics;
    }

    const endMs = Date.now();

    // Find best strategy
    let bestStrategy = "LRU";
    let bestHitRate = 0;
    for (const [strategy, metrics] of Object.entries(comparisonMetrics)) {
      if (metrics.requestHitRate > bestHitRate) {
        bestHitRate = metrics.requestHitRate;
        bestStrategy = strategy;
      }
    }
    notes.push(`Best performing strategy: ${bestStrategy} with ${bestHitRate * 100}% hit rate`);

    const result: ExperimentResult = {
      experimentName: this.config.name,
      experimentType: this.config.type,
      timestamp: new Date().toISOString(),
      config: this.config,
      metrics: comparisonMetrics[this.config.cacheConfig.evictionStrategies[0]] || baselineMetrics,
      baselineMetrics,
      comparisonMetrics,
      workloadAnalysis,
      duration: {
        startMs,
        endMs,
        totalMs: endMs - startMs
      },
      notes
    };

    this.results.set(this.config.name, result);
    return result;
  }

  private simulateWorkload(trace: PDWorkloadRequest[]): ExperimentMetrics {
    const simConfig = this.config.simulatorConfig;
    const rawTTFT: number[] = [];
    let totalTokens = 0;

    for (const req of trace.slice(this.config.warmupRequests)) {
      const ttft = simConfig.prefillBaseMs + req.prefillTokens * simConfig.prefillMsPerToken;
      totalTokens += req.prefillTokens;
      rawTTFT.push(ttft);
    }

    const avgTTFT = mean(rawTTFT);
    const ci = confidenceInterval95(rawTTFT);

    return {
      requestHitRate: 0,
      tokenHitRate: 0,
      exactMatchRate: 0,
      prefixMatchRate: 0,
      avgTTFTMs: round(avgTTFT, 2),
      ttftReductionMs: 0,
      ttftReductionPercent: 0,
      p50TTFT: round(percentile(rawTTFT, 50), 2),
      p90TTFT: round(percentile(rawTTFT, 90), 2),
      p99TTFT: round(percentile(rawTTFT, 99), 2),
      throughputGain: 1,
      tokensSaved: 0,
      tokensSavedPercent: 0,
      memoryEfficiency: 0,
      cacheUtilization: 0,
      avgCacheSizeMB: 0,
      confidenceInterval95: ci,
      stdDev: round(stdDev(rawTTFT), 2),
      effectSize: 0,
      rawTTFT,
      rawHitRates: []
    };
  }

  /**
   * Generate a markdown report from experiment results.
   */
  generateReport(result: ExperimentResult): ExperimentReport {
    const tables = this.generateTables(result);
    const recommendations = this.generateRecommendations(result);

    const summary = `
# Cache Evaluation Experiment Report

## Experiment: ${result.experimentName}
**Type:** ${result.experimentType}
**Timestamp:** ${result.timestamp}
**Duration:** ${round(result.duration.totalMs / 1000, 2)}s

## Workload Profile
${result.workloadAnalysis ? `
- **Prefix Reuse Rate (PRC):** ${round(result.workloadAnalysis.profile.prefixReuseRate * 100, 1)}%
- **Long Context Ratio (LCR):** ${round(result.workloadAnalysis.profile.lcr * 100, 3)}%
- **Tidal Intensity Index (TII):** ${round(result.workloadAnalysis.profile.tii, 2)}
- **Theoretical Cache Hit Upper Bound:** ${round(result.workloadAnalysis.theoreticalCacheHitUpperBound * 100, 1)}%
` : 'N/A'}
    `.trim();

    return {
      summary,
      tables,
      charts: {
        hitRateBarChart: this.generateHitRateChart(result),
        ttftReductionChart: this.generateTTFTChart(result),
        throughputComparisonChart: this.generateThroughputChart(result)
      },
      recommendations
    };
  }

  private generateTables(result: ExperimentResult): ExperimentReport["tables"] {
    const comparisonTable = this.formatComparisonTable(result);
    const metricsTable = this.formatMetricsTable(result);
    const statisticalTable = this.formatStatisticalTable(result);

    return {
      comparisonTable,
      metricsTable,
      statisticalSignificanceTable: statisticalTable
    };
  }

  private formatComparisonTable(result: ExperimentResult): string {
    const baseline = result.baselineMetrics;
    if (!baseline) return "No baseline data available";

    let table = `
## Cache Strategy Comparison

| Metric | Baseline (No Cache) | ${Object.keys(result.comparisonMetrics).join(" | ")} |
|--------|---------------------|${Object.keys(result.comparisonMetrics).map(() => "---------------------").join("|")}|
`;

    const metrics = [
      { name: "Request Hit Rate", key: "requestHitRate", format: "percent" },
      { name: "Token Hit Rate", key: "tokenHitRate", format: "percent" },
      { name: "Avg TTFT (ms)", key: "avgTTFTMs", format: "number" },
      { name: "TTFT Reduction (%)", key: "ttftReductionPercent", format: "percent" },
      { name: "Throughput Gain", key: "throughputGain", format: "ratio" },
      { name: "Cache Utilization", key: "cacheUtilization", format: "percent" },
      { name: "Effect Size (Cohen's d)", key: "effectSize", format: "number" }
    ];

    for (const metric of metrics) {
      const baselineVal = this.formatValue((baseline as any)[metric.key], metric.format);
      const values = Object.values(result.comparisonMetrics)
        .map(m => this.formatValue((m as any)[metric.key], metric.format));
      table += `| ${metric.name} | ${baselineVal} | ${values.join(" | ")} |\n`;
    }

    return table;
  }

  private formatMetricsTable(result: ExperimentResult): string {
    const metrics = result.comparisonMetrics[Object.keys(result.comparisonMetrics)[0]];
    if (!metrics) return "No metrics available";

    return `
## Detailed Metrics

| Percentile | TTFT (ms) |
|------------|-----------|
| P50 | ${metrics.p50TTFT} |
| P90 | ${metrics.p90TTFT} |
| P99 | ${metrics.p99TTFT} |

| Statistic | Value |
|-----------|-------|
| 95% CI Lower | ${metrics.confidenceInterval95.lower} |
| 95% CI Upper | ${metrics.confidenceInterval95.upper} |
| Std Dev | ${metrics.stdDev} |
| Tokens Saved | ${metrics.tokensSaved.toLocaleString()} |
`;
  }

  private formatStatisticalTable(result: ExperimentResult): string {
    const baseline = result.baselineMetrics;
    if (!baseline) return "No statistical significance data available";

    let table = `
## Statistical Significance (vs Baseline)

| Strategy | Cohen's d | Effect Interpretation | p-value (approx) |
|----------|-----------|----------------------|------------------|
`;

    for (const [strategy, metrics] of Object.entries(result.comparisonMetrics)) {
      const interpretation = this.interpretEffectSize(metrics.effectSize);
      const pValue = tTestPValue(metrics.rawTTFT, baseline.rawTTFT);
      table += `| ${strategy} | ${metrics.effectSize.toFixed(4)} | ${interpretation} | ${pValue < 0.01 ? "< 0.01" : pValue < 0.05 ? "< 0.05" : "ns"} |\n`;
    }

    return table;
  }

  private interpretEffectSize(d: number): string {
    const absD = Math.abs(d);
    if (absD < 0.2) return "Negligible";
    if (absD < 0.5) return "Small";
    if (absD < 0.8) return "Medium";
    return "Large";
  }

  private generateHitRateChart(result: ExperimentResult): string {
    const data = Object.entries(result.comparisonMetrics).map(([name, m]) => ({
      label: name,
      value: m.requestHitRate * 100
    }));

    const chartLines = data.map(d => {
      const bar = "█".repeat(Math.round(d.value / 2));
      return d.label.padEnd(15) + " | " + bar + " " + d.value.toFixed(1) + "%";
    });

    return "```\nHit Rate Comparison\n" + chartLines.join("\n") + "\n```\n";
  }

  private generateTTFTChart(result: ExperimentResult): string {
    const baseline = result.baselineMetrics;
    if (!baseline) return "";

    const data = [
      { label: "Baseline", value: baseline.avgTTFTMs },
      ...Object.entries(result.comparisonMetrics).map(([name, m]) => ({
        label: name,
        value: m.avgTTFTMs
      }))
    ];

    const maxVal = Math.max(...data.map(d => d.value));

    const chartLines = data.map(d => {
      const bar = "█".repeat(Math.round(d.value / maxVal * 40));
      return d.label.padEnd(15) + " | " + bar + " " + d.value.toFixed(1) + "ms";
    });

    return "```\nTTFT Comparison (lower is better)\n" + chartLines.join("\n") + "\n```\n";
  }

  private generateThroughputChart(result: ExperimentResult): string {
    const data = [
      { label: "Baseline", value: 1 },
      ...Object.entries(result.comparisonMetrics).map(([name, m]) => ({
        label: name,
        value: m.throughputGain
      }))
    ];

    const chartLines = data.map(d => {
      const bar = "█".repeat(Math.round(d.value * 10));
      return d.label.padEnd(15) + " | " + bar + " " + d.value.toFixed(2) + "x";
    });

    return "```\nThroughput Gain (x baseline)\n" + chartLines.join("\n") + "\n```\n";
  }

  private generateRecommendations(result: ExperimentResult): string[] {
    const recommendations: string[] = [];

    // Find best strategy
    let bestStrategy = "";
    let bestHitRate = 0;
    let bestTTFTReduction = 0;

    for (const [strategy, metrics] of Object.entries(result.comparisonMetrics)) {
      if (metrics.requestHitRate > bestHitRate) {
        bestHitRate = metrics.requestHitRate;
        bestTTFTReduction = metrics.ttftReductionPercent;
        bestStrategy = strategy;
      }
    }

    if (bestStrategy) {
      recommendations.push(`**Recommended Eviction Strategy:** ${bestStrategy}`);
      recommendations.push(`- Achieves ${round(bestHitRate * 100, 1)}% request hit rate`);
      recommendations.push(`- Reduces TTFT by ${bestTTFTReduction}% on average`);
    }

    // Analyze workload characteristics
    if (result.workloadAnalysis) {
      const prc = result.workloadAnalysis.profile.prefixReuseRate;
      if (prc > 0.3) {
        recommendations.push("**High Prefix Reuse Detected:** Enable course-level cache pooling for optimal performance.");
      }
      if (prc < 0.15) {
        recommendations.push("**Low Prefix Reuse:** Consider prompt compression techniques to increase cache hit rate.");
      }
    }

    // Memory recommendations
    for (const [strategy, metrics] of Object.entries(result.comparisonMetrics)) {
      if (metrics.cacheUtilization > 0.9) {
        recommendations.push(`**High Memory Pressure (${strategy}):** Consider increasing cache capacity or tuning eviction.`);
      }
    }

    return recommendations;
  }

  private formatValue(value: number, format: string): string {
    switch (format) {
      case "percent": return `${round(value * 100, 1)}%`;
      case "ratio": return `${round(value, 2)}x`;
      case "number": return round(value, 2).toString();
      default: return value.toString();
    }
  }

  /**
   * Save report to file.
   */
  saveReport(report: ExperimentReport, outputPath: string): void {
    const content = `# Cache Evaluation Experiment Report

${report.summary}

${report.tables.comparisonTable}

${report.tables.metricsTable}

${report.tables.statisticalSignificanceTable}

## Charts

### Hit Rate Comparison
${report.charts.hitRateBarChart}

### TTFT Comparison
${report.charts.ttftReductionChart}

### Throughput Gain
${report.charts.throughputComparisonChart}

## Recommendations

${report.recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n\n")}

---
*Generated by CacheExperimentRunner*
`;

    writeFileSync(outputPath, content, "utf-8");
  }

  getResults(): Map<string, ExperimentResult> {
    return this.results;
  }
}

// ==================== Factory Functions ====================

export function createDefaultExperiment(): CacheExperimentRunner {
  return new CacheExperimentRunner({
    name: "Default Cache Experiment",
    type: "cache_on_off",
    trials: 3,
    requestsPerTrial: 500,
    warmupRequests: 50
  });
}

export function createComprehensiveExperiment(): CacheExperimentRunner {
  return new CacheExperimentRunner({
    name: "Comprehensive Cache Evaluation",
    type: "comparative",
    cacheConfig: {
      maxMemoryMB: 2048,
      evictionStrategies: ["LRU", "LFU", "FLOP_AWARE"],
      enableCoursePooling: true
    },
    workloadConfig: {
      numStudents: 100,
      numCourses: 10,
      avgConcurrentUsers: 25,
      peakConcurrentUsers: 100,
      avgDialogueTurns: 10,
      tidalStrength: 0.7,
      prefixReuseRate: 0.4,
      courseMaterialTokens: 2048,
      systemPromptTokens: 512
    },
    trials: 5,
    requestsPerTrial: 1000,
    warmupRequests: 100,
    traceDurationMinutes: 60
  });
}
