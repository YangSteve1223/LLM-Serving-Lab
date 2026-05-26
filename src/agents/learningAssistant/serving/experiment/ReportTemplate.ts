/**
 * Experiment Report Template
 * 
 * Unified Markdown report template for all serving experiments.
 * Ensures consistent formatting and includes:
 * - Experiment configuration
 * - Raw data tables
 * - Statistical analysis
 * - Conclusions and recommendations
 * 
 * References:
 * - Scientific reporting standards for reproducibility
 * - ACM/IEEE formatting guidelines for experimental papers
 */

/**
 * Metric display names and units.
 */
export const METRIC_DISPLAY: Record<string, { name: string; unit: string; format: string }> = {
  ttft: { name: 'Time to First Token', unit: 'ms', format: '%.1f' },
  tpot: { name: 'Time per Output Token', unit: 'ms', format: '%.1f' },
  e2e: { name: 'End-to-End Latency', unit: 'ms', format: '%.1f' },
  goodput: { name: 'Goodput', unit: '%', format: '%.1f' },
  throughput: { name: 'Throughput', unit: 'tokens/s', format: '%.0f' },
  cacheHitRate: { name: 'Cache Hit Rate', unit: '%', format: '%.1f' }
};

/**
 * Report section types.
 */
export type ReportSection = 
  | 'header'
  | 'summary'
  | 'config'
  | 'methodology'
  | 'results'
  | 'statistics'
  | 'comparisons'
  | 'conclusion'
  | 'appendix';

/**
 * Report template configuration.
 */
export interface ReportTemplateConfig {
  /** Report title */
  title: string;
  /** Document type */
  documentType: 'experiment' | 'benchmark' | 'analysis' | 'ablation';
  /** Include statistical details */
  includeStatistics: boolean;
  /** Include raw data tables */
  includeRawData: boolean;
  /** Include comparison charts */
  includeComparisons: boolean;
  /** Confidence level for intervals */
  confidenceLevel: number;
  /** Significance threshold */
  significanceThreshold: number;
}

/**
 * Default report template configuration.
 */
export const DEFAULT_REPORT_CONFIG: ReportTemplateConfig = {
  title: 'Experiment Report',
  documentType: 'experiment',
  includeStatistics: true,
  includeRawData: true,
  includeComparisons: true,
  confidenceLevel: 0.95,
  significanceThreshold: 0.05
};

/**
 * Report template builder.
 */
export class ReportTemplate {
  private config: ReportTemplateConfig;
  private sections: Map<ReportSection, string>;

  constructor(config: Partial<ReportTemplateConfig> = {}) {
    this.config = { ...DEFAULT_REPORT_CONFIG, ...config };
    this.sections = new Map();
  }

  /**
   * Generate complete report template.
   */
  generate(): string {
    const lines: string[] = [];

    lines.push(this.generateHeader());
    lines.push(this.generateSummary());
    lines.push(this.generateConfiguration());
    lines.push(this.generateMethodology());
    lines.push(this.generateResults());
    
    if (this.config.includeStatistics) {
      lines.push(this.generateStatistics());
    }
    
    if (this.config.includeComparisons) {
      lines.push(this.generateComparisons());
    }
    
    lines.push(this.generateConclusion());
    lines.push(this.generateAppendix());

    return lines.join('\n\n');
  }

  /**
   * Generate report header.
   */
  private generateHeader(): string {
    const date = new Date().toISOString().split('T')[0];
    return `# ${this.config.title}

**Document Type:** ${this.config.documentType.charAt(0).toUpperCase() + this.config.documentType.slice(1)} Report  
**Generated:** ${date}  
**Confidence Level:** ${(this.config.confidenceLevel * 100).toFixed(0)}%  
**Significance Threshold:** α = ${this.config.significanceThreshold}

---

## Executive Summary

<!-- Quick overview: What was tested, key findings, main recommendation -->

| Metric | Best Configuration | Value |
|--------|-------------------|-------|
| TTFT | TBD | TBD ms |
| TPOT | TBD | TBD ms |
| E2E Latency | TBD | TBD ms |
| Goodput | TBD | TBD% |

**Key Finding:** [One sentence summary of main result]

**Recommendation:** [One sentence actionable recommendation]
`;
  }

  /**
   * Generate summary section.
   */
  private generateSummary(): string {
    return `## Summary

### Objectives
- [Primary research question or hypothesis]
- [Secondary objectives]

### Scope
- Workload characteristics
- System configuration
- Experiment matrix

### Key Results
| Metric | Baseline | Best | Improvement |
|--------|----------|------|-------------|
| TTFT | TBD ms | TBD ms | TBD% |
| TPOT | TBD ms | TBD ms | TBD% |
| E2E | TBD ms | TBD ms | TBD% |
| Goodput | TBD% | TBD% | TBD pp |

### Conclusions
1. [Primary conclusion]
2. [Secondary conclusion]
3. [Tertiary conclusion]
`;
  }

  /**
   * Generate configuration section.
   */
  private generateConfiguration(): string {
    return `## Experiment Configuration

### System Setup

\`\`\`yaml
# Architecture Configuration
architecture: pd_separated  # monolithic | pd_separated | hybrid

# GPU Configuration
prefill_gpu:
  type: compute_heavy
  count: 2

decode_gpu:
  type: memory_heavy
  count: 4

# Cache Configuration
cache:
  type: radix  # none | hash | radix
  capacity_mb: 2048
  block_size: 64
  eviction: lru  # lru | lfu | flop_aware

# Scheduler Configuration
scheduler:
  type: slo_aware  # fcfs | sjf | slo_aware
  slo_target_ms: 2000
\`\`\`

### Workload Parameters

| Parameter | Value |
|-----------|-------|
| Request Count | 100 |
| Avg Prompt Tokens | 1024 |
| Avg Completion Tokens | 256 |
| QPS | 10 |
| Duration | 60s |
| Token Distribution | realistic |
| Variance | 0.3 |

### Statistical Parameters

| Parameter | Value |
|-----------|-------|
| Repetitions | ${this.config.includeStatistics ? '10' : 'TBD'} |
| Warmup Iterations | 5 |
| Confidence Level | ${(this.config.confidenceLevel * 100).toFixed(0)}% |
| Significance (α) | ${this.config.significanceThreshold} |
`;
  }

  /**
   * Generate methodology section.
   */
  private generateMethodology(): string {
    return `## Methodology

### Experimental Design

The experiment follows a **full factorial design** with the following factors:

| Factor | Levels | Description |
|--------|--------|-------------|
| Architecture | 3 | Monolithic, PD-Separated, Hybrid |
| Cache | 3 | None, Hash-based, Radix |
| Scheduler | 3 | FCFS, SJF, SLO-aware |

**Total Configurations:** 3 × 3 × 3 = 27 cells

### Metrics Collected

| Metric | Abbreviation | Unit | Description |
|--------|--------------|------|-------------|
| Time to First Token | TTFT | ms | Time until first output token |
| Time per Output Token | TPOT | ms | Average time per output token |
| End-to-End Latency | E2E | ms | Total request completion time |
| Goodput | - | % | Fraction meeting SLO |
| Throughput | - | tokens/s | Token generation rate |

### Statistical Methodology

1. **Descriptive Statistics:** Mean, median, std dev, min/max, percentiles (P50/P90/P99)
2. **Confidence Intervals:** ${(this.config.confidenceLevel * 100).toFixed(0)}% CI using t-distribution
3. **Significance Testing:** Welch's t-test with α = ${this.config.significanceThreshold}
4. **Effect Size:** Cohen's d for practical significance

### Reproducibility

- **Random Seed:** Configurable (default: 42)
- **Environment:** [System specifications]
- **Code Version:** [Git commit hash]
`;
  }

  /**
   * Generate results section.
   */
  private generateResults(): string {
    if (!this.config.includeRawData) {
      return `## Results

[Detailed results would appear here with raw data tables]`;
    }

    return `## Results

### Raw Data Summary

#### Architecture Comparison

| Architecture | TTFT (ms) | TPOT (ms) | E2E (ms) | Goodput (%) |
|--------------|-----------|-----------|----------|-------------|
| Monolithic | TBD | TBD | TBD | TBD |
| PD-Separated | TBD | TBD | TBD | TBD |
| Hybrid | TBD | TBD | TBD | TBD |

#### Cache Comparison

| Cache Type | TTFT (ms) | TPOT (ms) | E2E (ms) | Goodput (%) |
|------------|-----------|-----------|----------|-------------|
| None | TBD | TBD | TBD | TBD |
| Hash-based | TBD | TBD | TBD | TBD |
| Radix | TBD | TBD | TBD | TBD |

#### Scheduler Comparison

| Scheduler | TTFT (ms) | TPOT (ms) | E2E (ms) | Goodput (%) |
|-----------|-----------|-----------|----------|-------------|
| FCFS | TBD | TBD | TBD | TBD |
| SJF | TBD | TBD | TBD | TBD |
| SLO-aware | TBD | TBD | TBD | TBD |
`;
  }

  /**
   * Generate statistics section.
   */
  private generateStatistics(): string {
    const ciPercent = (this.config.confidenceLevel * 100).toFixed(0);
    return `## Statistical Analysis

### ${ciPercent}% Confidence Intervals

#### By Architecture

| Metric | Monolithic CI | PD-Sep CI | Hybrid CI |
|--------|---------------|-----------|-----------|
| TTFT | [TBD, TBD] | [TBD, TBD] | [TBD, TBD] |
| TPOT | [TBD, TBD] | [TBD, TBD] | [TBD, TBD] |
| E2E | [TBD, TBD] | [TBD, TBD] | [TBD, TBD] |
| Goodput | [TBD, TBD] | [TBD, TBD] | [TBD, TBD] |

#### By Cache Type

| Metric | None CI | Hash CI | Radix CI |
|--------|---------|---------|----------|
| TTFT | [TBD, TBD] | [TBD, TBD] | [TBD, TBD] |
| TPOT | [TBD, TBD] | [TBD, TBD] | [TBD, TBD] |
| E2E | [TBD, TBD] | [TBD, TBD] | [TBD, TBD] |
| Goodput | [TBD, TBD] | [TBD, TBD] | [TBD, TBD] |

#### By Scheduler

| Metric | FCFS CI | SJF CI | SLO CI |
|--------|---------|--------|--------|
| TTFT | [TBD, TBD] | [TBD, TBD] | [TBD, TBD] |
| TPOT | [TBD, TBD] | [TBD, TBD] | [TBD, TBD] |
| E2E | [TBD, TBD] | [TBD, TBD] | [TBD, TBD] |
| Goodput | [TBD, TBD] | [TBD, TBD] | [TBD, TBD] |

### Significance Testing

#### Pairwise Comparisons (p < ${this.config.significanceThreshold})

| Comparison | Metric | p-value | Significant | Effect Size |
|------------|--------|---------|-------------|-------------|
| Monolithic vs PD-Sep | TTFT | TBD | ${this.config.significanceThreshold < 0.05 ? '✓' : '✗'} | TBD |
| Monolithic vs PD-Sep | TPOT | TBD | ${this.config.significanceThreshold < 0.05 ? '✓' : '✗'} | TBD |
| None vs Radix | TTFT | TBD | ${this.config.significanceThreshold < 0.05 ? '✓' : '✗'} | TBD |
| FCFS vs SLO | Goodput | TBD | ${this.config.significanceThreshold < 0.05 ? '✓' : '✗'} | TBD |
`;
  }

  /**
   * Generate comparisons section.
   */
  private generateComparisons(): string {
    return `## Comparative Analysis

### Winner Analysis

| Metric | Best Architecture | Best Cache | Best Scheduler | Overall Best |
|--------|------------------|------------|---------------|--------------|
| TTFT | TBD | TBD | TBD | TBD |
| TPOT | TBD | TBD | TBD | TBD |
| E2E | TBD | TBD | TBD | TBD |
| Goodput | TBD | TBD | TBD | TBD |

### Interaction Effects

#### Architecture × Cache Interaction

|  | None | Hash | Radix |
|--|------|------|-------|
| **Monolithic** | TBD | TBD | TBD |
| **PD-Sep** | TBD | TBD | TBD |
| **Hybrid** | TBD | TBD | TBD |

#### Architecture × Scheduler Interaction

|  | FCFS | SJF | SLO |
|--|------|-----|-----|
| **Monolithic** | TBD | TBD | TBD |
| **PD-Sep** | TBD | TBD | TBD |
| **Hybrid** | TBD | TBD | TBD |

### Trade-off Analysis

When optimizing for different objectives:

1. **Lowest Latency:** [Configuration recommendation]
2. **Highest Throughput:** [Configuration recommendation]
3. **Best SLO Compliance:** [Configuration recommendation]
4. **Balanced Performance:** [Configuration recommendation]
`;
  }

  /**
   * Generate conclusion section.
   */
  private generateConclusion(): string {
    return `## Conclusions

### Key Findings

1. **Architecture Impact:** [Describe main architectural findings]
   - PD separation shows [X]% improvement over monolithic
   - Hybrid achieves [trade-off description]

2. **Cache Impact:** [Describe cache findings]
   - Radix cache provides [X]% TTFT reduction
   - Memory/performance trade-off: [analysis]

3. **Scheduler Impact:** [Describe scheduler findings]
   - SLO-aware scheduling improves goodput by [X]%
   - FCFS remains competitive for [use cases]

### Recommendations

| Use Case | Recommended Configuration |
|----------|---------------------------|
| Interactive | [Architecture + Cache + Scheduler] |
| Batch | [Architecture + Cache + Scheduler] |
| Cost-optimized | [Architecture + Cache + Scheduler] |
| SLO-critical | [Architecture + Cache + Scheduler] |

### Limitations

- [Acknowledged limitation 1]
- [Acknowledged limitation 2]
- [Acknowledged limitation 3]

### Future Work

- [Potential extension 1]
- [Potential extension 2]
`;
  }

  /**
   * Generate appendix.
   */
  private generateAppendix(): string {
    return `## Appendix

### A. Raw Data

Full experimental data available in JSON format:
\`\`\`json
{
  "experiments": [...],
  "measurements": [...],
  "statistics": {...}
}
\`\`\`

### B. Configuration Files

Experiment configurations stored in \`configs/experiments/\`

### C. Statistical Details

#### T-Test Results

| Comparison | t-statistic | df | p-value | 95% CI of Difference |
|------------|-------------|-----|---------|----------------------|
| [TBD] | [TBD] | [TBD] | [TBD] | [TBD, TBD] |

#### Effect Sizes (Cohen's d)

| Comparison | TTFT | TPOT | Goodput |
|------------|------|------|---------|
| [TBD] | [TBD] | [TBD] | [TBD] |

### D. Environment Details

- **Node.js Version:** ${process.version}
- **Platform:** ${process.platform}
- **CPU:** ${process.arch}
- **Timestamp:** ${new Date().toISOString()}

---

*Report generated by LEARN_AGENT Experiment Framework*
`;
  }

  /**
   * Add custom section.
   */
  addSection(name: ReportSection, content: string): void {
    this.sections.set(name, content);
  }

  /**
   * Get section by name.
   */
  getSection(name: ReportSection): string | undefined {
    return this.sections.get(name);
  }
}

/**
 * Create report template with default config.
 */
export function createReportTemplate(
  config?: Partial<ReportTemplateConfig>
): ReportTemplate {
  return new ReportTemplate(config);
}

/**
 * Generate quick summary table.
 */
export function generateSummaryTable(
  data: Array<{ name: string; ttft: number; tpot: number; e2e: number; goodput: number }>
): string {
  const lines: string[] = [];
  
  lines.push('| Configuration | TTFT (ms) | TPOT (ms) | E2E (ms) | Goodput (%) |');
  lines.push('|---------------|-----------|-----------|---------|-------------|');
  
  for (const row of data) {
    lines.push(`| ${row.name} | ${row.ttft.toFixed(1)} | ${row.tpot.toFixed(1)} | ${row.e2e.toFixed(1)} | ${(row.goodput * 100).toFixed(1)} |`);
  }
  
  return lines.join('\n');
}

/**
 * Generate significance badge.
 */
export function significanceBadge(pValue: number, threshold: number = 0.05): string {
  if (pValue < threshold) {
    return '✓ **Significant**';
  }
  return '✗ Not significant';
}
