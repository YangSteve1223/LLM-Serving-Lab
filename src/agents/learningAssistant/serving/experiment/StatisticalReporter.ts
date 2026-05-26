/**
 * Statistical Reporter
 * 
 * Generates statistical reports from experimental results.
 * Computes mean, standard deviation, confidence intervals, and
 * generates markdown-formatted reports.
 */
import type { SchedulingMetrics } from "../ServingTrace.ts";

/**
 * Raw measurement data point.
 */
export interface Measurement {
  /** Request ID */
  requestId: string;
  /** TTFT in milliseconds */
  ttftMs: number;
  /** TPOT in milliseconds */
  tpotMs: number;
  /** E2E latency in milliseconds */
  e2eMs: number;
  /** Whether request met SLO */
  metSLO: boolean;
  /** Timestamp */
  timestamp?: number;
}

/**
 * Statistical summary for a single metric.
 */
export interface MetricStats {
  /** Mean value */
  mean: number;
  /** Standard deviation */
  std: number;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Median */
  median: number;
  /** 95% confidence interval */
  ci95: [number, number];
  /** 99% confidence interval */
  ci99: [number, number];
  /** Sample size */
  n: number;
}

/**
 * Full statistical summary.
 */
export interface StatisticalSummary {
  ttft: MetricStats;
  tpot: MetricStats;
  e2e: MetricStats;
  goodput: number;
}

/**
 * Experiment conditions description.
 */
export interface ExperimentConditions {
  /** Request count */
  numRequests: number;
  /** Repetitions per configuration */
  repetitions: number;
  /** Warmup requests */
  warmupRequests: number;
  /** Workload description */
  workloadDescription: string;
  /** System configuration */
  systemConfig: string;
  /** Date/time of experiment */
  timestamp: string;
}

/**
 * Statistical test result.
 */
export interface StatisticalTest {
  /** Test name */
  name: string;
  /** Test statistic */
  statistic: number;
  /** P-value */
  pValue: number;
  /** Degrees of freedom */
  degreesOfFreedom?: number;
  /** Significance level (alpha) */
  alpha: number;
  /** Whether result is statistically significant */
  significant: boolean;
  /** Confidence level */
  confidenceLevel: number;
  /** Interpretation */
  interpretation: string;
}

/**
 * Statistical Reporter
 * 
 * Generates comprehensive statistical reports from experimental data.
 */
export class StatisticalReporter {
  /**
   * Calculate statistical summary from measurements.
   */
  calculateSummary(measurements: Measurement[]): StatisticalSummary {
    if (measurements.length === 0) {
      return {
        ttft: this.emptyStats(),
        tpot: this.emptyStats(),
        e2e: this.emptyStats(),
        goodput: 0
      };
    }

    const ttftValues = measurements.map(m => m.ttftMs);
    const tpotValues = measurements.map(m => m.tpotMs);
    const e2eValues = measurements.map(m => m.e2eMs);
    const metSLO = measurements.filter(m => m.metSLO).length;

    return {
      ttft: this.calculateMetricStats(ttftValues),
      tpot: this.calculateMetricStats(tpotValues),
      e2e: this.calculateMetricStats(e2eValues),
      goodput: metSLO / measurements.length
    };
  }

  /**
   * Calculate statistics for a single metric.
   */
  calculateMetricStats(values: number[]): MetricStats {
    if (values.length === 0) {
      return this.emptyStats();
    }

    const n = values.length;
    const sorted = [...values].sort((a, b) => a - b);
    
    // Mean
    const mean = values.reduce((a, b) => a + b, 0) / n;
    
    // Standard deviation
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1);
    const std = Math.sqrt(variance);
    
    // Min/Max
    const min = sorted[0];
    const max = sorted[n - 1];
    
    // Median
    const median = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
    
    // Confidence intervals (using t-distribution for small samples)
    const ci95 = this.calculateCI(values, 0.95);
    const ci99 = this.calculateCI(values, 0.99);
    
    return { mean, std, min, max, median, ci95, ci99, n };
  }

  /**
   * Calculate confidence interval.
   */
  private calculateCI(values: number[], confidence: number): [number, number] {
    const n = values.length;
    if (n === 0) return [0, 0];
    
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1);
    const std = Math.sqrt(variance);
    
    // Use t-distribution critical value approximation
    // For n > 30, use z-score approximation
    const criticalValue = n > 30 
      ? this.zScore(confidence)
      : this.tCritical(n - 1, confidence);
    
    const margin = criticalValue * (std / Math.sqrt(n));
    
    return [mean - margin, mean + margin];
  }

  /**
   * Approximate z-score for confidence level.
   */
  private zScore(confidence: number): number {
    const zScores: Record<number, number> = {
      0.90: 1.645,
      0.95: 1.96,
      0.99: 2.576
    };
    return zScores[confidence] || 1.96;
  }

  /**
   * Approximate t-critical value.
   */
  private tCritical(df: number, confidence: number): number {
    // Simplified t-critical approximation
    const tValues: Record<number, Record<number, number>> = {
      0.95: { 2: 4.303, 5: 2.571, 10: 2.228, 20: 2.086, 30: 2.042, 60: 2.000 },
      0.99: { 2: 9.925, 5: 4.032, 10: 3.169, 20: 2.845, 30: 2.750, 60: 2.660 }
    };
    
    const levelMap = tValues[confidence];
    if (!levelMap) return 2.0;
    
    // Find closest df
    const dfs = Object.keys(levelMap).map(Number).sort((a, b) => a - b);
    for (let i = 0; i < dfs.length - 1; i++) {
      if (df <= dfs[i + 1]) {
        if (df - dfs[i] < dfs[i + 1] - df) {
          return levelMap[df];
        }
        return levelMap[df + 1];
      }
    }
    
    return levelMap[dfs[df.length - 1]] || 2.0;
  }

  /**
   * Run statistical test comparing two groups.
   */
  runTTest(
    group1: number[],
    group2: number[],
    alpha: number = 0.05
  ): StatisticalTest {
    const n1 = group1.length;
    const n2 = group2.length;
    const mean1 = group1.reduce((a, b) => a + b, 0) / n1;
    const mean2 = group2.reduce((a, b) => a + b, 0) / n2;
    
    const var1 = group1.reduce((sum, v) => sum + Math.pow(v - mean1, 2), 0) / (n1 - 1);
    const var2 = group2.reduce((sum, v) => sum + Math.pow(v - mean2, 2), 0) / (n2 - 1);
    
    // Pooled standard error
    const se = Math.sqrt(var1 / n1 + var2 / n2);
    
    // T-statistic
    const tStat = (mean1 - mean2) / se;
    
    // Degrees of freedom (Welch-Satterthwaite)
    const df = Math.pow(var1 / n1 + var2 / n2, 2) / 
      (Math.pow(var1 / n1, 2) / (n1 - 1) + Math.pow(var2 / n2, 2) / (n2 - 1));
    
    // P-value approximation (simplified)
    const pValue = this.tCDF(Math.abs(tStat), df);
    
    const significant = pValue < alpha;
    
    return {
      name: 'Welch\'s t-test',
      statistic: tStat,
      pValue,
      degreesOfFreedom: df,
      alpha,
      significant,
      confidenceLevel: 1 - alpha,
      interpretation: significant 
        ? `Significant difference detected (p < ${alpha})`
        : `No significant difference (p >= ${alpha})`
    };
  }

  /**
   * Simplified t-distribution CDF approximation.
   */
  private tCDF(t: number, df: number): number {
    // Very simplified approximation
    // For actual use, would need proper t-distribution implementation
    const z = t * Math.sqrt((df + 2) / (df + t * t));
    const p = 1 - 0.5 * (1 + Math.abs(z) / (1 + 0.2316419 * Math.abs(z)));
    return Math.min(0.999, Math.max(0.001, 1 - p));
  }

  /**
   * Create empty stats object.
   */
  private emptyStats(): MetricStats {
    return {
      mean: 0,
      std: 0,
      min: 0,
      max: 0,
      median: 0,
      ci95: [0, 0],
      ci99: [0, 0],
      n: 0
    };
  }

  /**
   * Generate markdown report.
   */
  generateMarkdownReport(
    summary: StatisticalSummary,
    conditions: ExperimentConditions,
    comparisons?: { name: string; baseline: StatisticalSummary; treatment: StatisticalSummary }[]
  ): string {
    const lines: string[] = [];

    lines.push('# Statistical Analysis Report\n');
    lines.push(`**Generated:** ${new Date().toISOString()}\n`);
    
    lines.push('## Experiment Conditions\n');
    lines.push(`- **Requests:** ${conditions.numRequests}`);
    lines.push(`- **Repetitions:** ${conditions.repetitions}`);
    lines.push(`- **Warmup:** ${conditions.warmupRequests}`);
    lines.push(`- **Workload:** ${conditions.workloadDescription}`);
    lines.push(`- **System:** ${conditions.systemConfig}\n`);

    lines.push('## Summary Statistics\n');
    lines.push('| Metric | Mean | Std Dev | Median | Min | Max | 95% CI |');
    lines.push('|--------|------|---------|--------|-----|-----|--------|');
    
    lines.push(this.formatMetricRow('TTFT', summary.ttft));
    lines.push(this.formatMetricRow('TPOT', summary.tpot));
    lines.push(this.formatMetricRow('E2E', summary.e2e));
    lines.push(`| **Goodput** | ${(summary.goodput * 100).toFixed(1)}% | - | - | - | - | - |\n`);

    if (comparisons && comparisons.length > 0) {
      lines.push('## Statistical Comparisons\n');
      
      for (const comp of comparisons) {
        lines.push(`### ${comp.name}\n`);
        
        const ttftTest = this.runTTest(
          [comp.baseline.ttft.mean],
          [comp.treatment.ttft.mean]
        );
        
        const tpotTest = this.runTTest(
          [comp.baseline.tpot.mean],
          [comp.treatment.tpot.mean]
        );
        
        const e2eTest = this.runTTest(
          [comp.baseline.e2e.mean],
          [comp.treatment.e2e.mean]
        );
        
        lines.push('| Metric | Baseline | Treatment | Change | Significant |');
        lines.push('|--------|----------|-----------|--------|-------------|');
        
        const ttftChange = comp.treatment.ttft.mean - comp.baseline.ttft.mean;
        lines.push(`| TTFT | ${comp.baseline.ttft.mean.toFixed(1)}ms | ${comp.treatment.ttft.mean.toFixed(1)}ms | ${ttftChange >= 0 ? '+' : ''}${ttftChange.toFixed(1)}ms | ${ttftTest.significant ? '✓' : '✗'} |`);
        
        const tpotChange = comp.treatment.tpot.mean - comp.baseline.tpot.mean;
        lines.push(`| TPOT | ${comp.baseline.tpot.mean.toFixed(1)}ms | ${comp.treatment.tpot.mean.toFixed(1)}ms | ${tpotChange >= 0 ? '+' : ''}${tpotChange.toFixed(1)}ms | ${tpotTest.significant ? '✓' : '✗'} |`);
        
        const e2eChange = comp.treatment.e2e.mean - comp.baseline.e2e.mean;
        lines.push(`| E2E | ${comp.baseline.e2e.mean.toFixed(1)}ms | ${comp.treatment.e2e.mean.toFixed(1)}ms | ${e2eChange >= 0 ? '+' : ''}${e2eChange.toFixed(1)}ms | ${e2eTest.significant ? '✓' : '✗'} |\n`);
      }
    }

    lines.push('## Methodology\n');
    lines.push('- **Confidence Intervals:** Computed using t-distribution');
    lines.push('- **Statistical Tests:** Welch\'s t-test for unequal variances');
    lines.push('- **Significance Level:** α = 0.05\n');

    return lines.join('\n');
  }

  /**
   * Format a metric row for markdown table.
   */
  private formatMetricRow(name: string, stats: MetricStats): string {
    return `| ${name} | ${stats.mean.toFixed(1)} | ${stats.std.toFixed(1)} | ${stats.median.toFixed(1)} | ${stats.min.toFixed(1)} | ${stats.max.toFixed(1)} | [${stats.ci95[0].toFixed(1)}, ${stats.ci95[1].toFixed(1)}] |`;
  }

  /**
   * Generate HTML report.
   */
  generateHTMLReport(
    summary: StatisticalSummary,
    conditions: ExperimentConditions
  ): string {
    const lines: string[] = [];

    lines.push(`<!DOCTYPE html>
<html>
<head>
  <title>Statistical Analysis Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1, h2 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f4f4f4; }
    .metric { font-weight: bold; }
    .ci { color: #666; font-size: 0.9em; }
    .conditions { background: #f9f9f9; padding: 15px; border-radius: 5px; }
  </style>
</head>
<body>
  <h1>Statistical Analysis Report</h1>
  <p><strong>Generated:</strong> ${new Date().toISOString()}</p>
  
  <h2>Experiment Conditions</h2>
  <div class="conditions">
    <p><strong>Requests:</strong> ${conditions.numRequests}</p>
    <p><strong>Repetitions:</strong> ${conditions.repetitions}</p>
    <p><strong>Warmup:</strong> ${conditions.warmupRequests}</p>
    <p><strong>Workload:</strong> ${conditions.workloadDescription}</p>
    <p><strong>System:</strong> ${conditions.systemConfig}</p>
  </div>
  
  <h2>Summary Statistics</h2>
  <table>
    <tr>
      <th>Metric</th>
      <th>Mean</th>
      <th>Std Dev</th>
      <th>Median</th>
      <th>Min</th>
      <th>Max</th>
      <th>95% CI</th>
    </tr>
    ${this.formatHTMLMetricRow('TTFT', summary.ttft)}
    ${this.formatHTMLMetricRow('TPOT', summary.tpot)}
    ${this.formatHTMLMetricRow('E2E', summary.e2e)}
    <tr>
      <td><strong>Goodput</strong></td>
      <td>${(summary.goodput * 100).toFixed(1)}%</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
    </tr>
  </table>
</body>
</html>`);

    return lines.join('\n');
  }

  /**
   * Format metric row for HTML table.
   */
  private formatHTMLMetricRow(name: string, stats: MetricStats): string {
    return `
    <tr>
      <td class="metric">${name}</td>
      <td>${stats.mean.toFixed(1)} ms</td>
      <td>${stats.std.toFixed(1)} ms</td>
      <td>${stats.median.toFixed(1)} ms</td>
      <td>${stats.min.toFixed(1)} ms</td>
      <td>${stats.max.toFixed(1)} ms</td>
      <td class="ci">[${stats.ci95[0].toFixed(1)}, ${stats.ci95[1].toFixed(1)}] ms</td>
    </tr>`;
  }
}

/**
 * Default instance.
 */
export const statisticalReporter = new StatisticalReporter();
