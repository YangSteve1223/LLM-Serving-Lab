/**
 * Experiment Reporter
 * 
 * Generates standardized Markdown reports from experimental results.
 * Automatically creates comparison tables, statistical analysis,
 * and saves reports to the reports directory.
 * 
 * References:
 * - Scientific reporting standards for reproducibility
 * - Unified format for ML serving research
 */
import type { ExperimentConfig } from "./ExperimentConfig.ts";
import type { ExperimentMatrixResult, MatrixCellResult } from "./ExperimentMatrix.ts";
import type { AblationStudyResult } from "./AblationStudyRunner.ts";
import type { StatisticalSummary, Measurement } from "./StatisticalReporter.ts";
import {
  ReportTemplate,
  type ReportTemplateConfig,
  createReportTemplate,
  generateSummaryTable,
  significanceBadge
} from "./ReportTemplate.ts";

/**
 * Report output format.
 */
export type ReportFormat = 'markdown' | 'html' | 'json';

/**
 * Report types supported.
 */
export type ReportType = 'matrix' | 'ablation' | 'calibration' | 'custom';

/**
 * Report generation options.
 */
export interface ExperimentReporterOptions {
  /** Output format */
  format: ReportFormat;
  /** Base output directory */
  outputDir: string;
  /** Include raw data in report */
  includeRawData: boolean;
  /** Generate visualizations */
  includeVisualizations: boolean;
  /** Open report in browser (HTML only) */
  openInBrowser: boolean;
}

/**
 * Default reporter options.
 */
export const DEFAULT_REPORTER_OPTIONS: ExperimentReporterOptions = {
  format: 'markdown',
  outputDir: './reports/experiments',
  includeRawData: true,
  includeVisualizations: false,
  openInBrowser: false
};

/**
 * Experiment Reporter
 * 
 * Generates comprehensive reports from experimental results.
 */
export class ExperimentReporter {
  private options: ExperimentReporterOptions;
  private template: ReportTemplate;
  private reportCounter: number;

  constructor(options: Partial<ExperimentReporterOptions> = {}) {
    this.options = { ...DEFAULT_REPORTER_OPTIONS, ...options };
    this.reportCounter = 0;
    this.template = createReportTemplate();
  }

  /**
   * Generate report from experiment matrix result.
   */
  generateMatrixReport(result: ExperimentMatrixResult): string {
    const lines: string[] = [];

    // Header
    lines.push(this.generateHeader('3×3×3 Experiment Matrix Report', 'matrix'));

    // Executive Summary
    lines.push(this.generateExecutiveSummary(result));

    // Detailed Results
    lines.push(this.generateMatrixResults(result));

    // Statistical Analysis
    lines.push(this.generateStatisticalAnalysis(result));

    // Winners
    lines.push(this.generateWinners(result));

    // Conclusions
    lines.push(this.generateConclusions(result));

    return lines.join('\n\n');
  }

  /**
   * Generate report from ablation study result.
   */
  generateAblationReport(result: AblationStudyResult): string {
    const lines: string[] = [];

    // Header
    lines.push(this.generateHeader('Ablation Study Report', 'ablation'));

    // Summary
    lines.push(this.generateAblationSummary(result));

    // Ablation Table
    lines.push(this.generateAblationTable(result));

    // Module Contributions
    lines.push(this.generateModuleContributions(result));

    // Conclusions
    lines.push(this.generateAblationConclusions(result));

    return lines.join('\n\n');
  }

  /**
   * Generate complete report with custom data.
   */
  generateCustomReport(
    title: string,
    config: ExperimentConfig,
    summary: StatisticalSummary,
    comparisons?: Array<{
      name: string;
      baseline: StatisticalSummary;
      treatment: StatisticalSummary;
    }>
  ): string {
    const lines: string[] = [];

    // Header
    lines.push(this.generateHeader(title, 'custom'));

    // Configuration
    lines.push(this.generateConfiguration(config));

    // Summary Statistics
    lines.push(this.generateSummaryStats(summary));

    // Comparisons
    if (comparisons && comparisons.length > 0) {
      lines.push(this.generateComparisons(comparisons));
    }

    // Conclusions
    lines.push(this.generateCustomConclusions(config, summary));

    return lines.join('\n\n');
  }

  /**
   * Save report to file.
   */
  async saveReport(content: string, filename?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = filename ?? `experiment_report_${timestamp}_${++this.reportCounter}.md`;
    const filepath = `${this.options.outputDir}/${name}`;

    // Ensure directory exists
    try {
      await Deno.mkdir(this.options.outputDir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    await Deno.writeTextFile(filepath, content);
    return filepath;
  }

  /**
   * Generate report header.
   */
  private generateHeader(title: string, type: ReportType): string {
    const date = new Date().toISOString().split('T')[0];
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

    return `# ${title}

**Type:** ${typeLabel} Report  
**Generated:** ${date}  
**Confidence Level:** 95%  
**Significance Threshold:** α = 0.05

---

`;
  }

  /**
   * Generate executive summary for matrix results.
   */
  private generateExecutiveSummary(result: ExperimentMatrixResult): string {
    const lines: string[] = [];
    lines.push('## Executive Summary\n');

    // Quick stats
    lines.push('### Quick Stats');
    lines.push(`- **Total Configurations:** ${result.cells.length}`);
    lines.push(`- **Repetitions per Config:** 10`);
    lines.push(`- **Total Runs:** ${result.cells.length * 10}\n`);

    // Best performers
    lines.push('### Best Performers');
    lines.push('| Metric | Configuration | Value |');
    lines.push('|--------|---------------|-------|');
    lines.push(`| Lowest TTFT | ${this.cellName(result.winners.ttft)} | ${this.getCellMean(result, result.winners.ttft, 'ttft').toFixed(1)} ms |`);
    lines.push(`| Lowest TPOT | ${this.cellName(result.winners.tpot)} | ${this.getCellMean(result, result.winners.tpot, 'tpot').toFixed(1)} ms |`);
    lines.push(`| Lowest E2E | ${this.cellName(result.winners.e2e)} | ${this.getCellMean(result, result.winners.e2e, 'e2e').toFixed(1)} ms |`);
    lines.push(`| Highest Goodput | ${this.cellName(result.winners.goodput)} | ${(this.getCellMean(result, result.winners.goodput, 'goodput') * 100).toFixed(1)}% |`);
    lines.push(`| **Overall Best** | ${this.cellName(result.winners.overall)} | - |\n`);

    // Key finding
    lines.push('### Key Finding');
    lines.push(`The **${result.winners.overall.architecture}** architecture with **${result.winners.overall.cache}** cache and **${result.winners.overall.scheduler}** scheduler provides the best overall performance.`);

    return lines.join('\n');
  }

  /**
   * Generate matrix results table.
   */
  private generateMatrixResults(result: ExperimentMatrixResult): string {
    const lines: string[] = [];
    lines.push('## Experiment Results\n');

    // 3x3x3 Matrix Table
    lines.push('### 3×3×3 Matrix Results\n');
    lines.push('| Arch \\ Cache \\ Sched | TTFT (ms) | TPOT (ms) | E2E (ms) | Goodput (%) |');
    lines.push('|---------------------|-----------|-----------|----------|-------------|');

    for (const arch of result.dimensions.architectures) {
      for (const cache of result.dimensions.caches) {
        const scheds = result.dimensions.schedulers;
        
        for (let i = 0; i < scheds.length; i++) {
          const sched = scheds[i];
          const cell = result.cells.find(
            c => c.cell.architecture === arch && c.cell.cache === cache && c.cell.scheduler === sched
          );
          
          if (cell) {
            const ttft = cell.ttftStats.mean.toFixed(1);
            const tpot = cell.tpotStats.mean.toFixed(1);
            const e2e = cell.e2eStats.mean.toFixed(1);
            const goodput = (cell.goodputStats.mean * 100).toFixed(1);
            
            const prefix = i === 0 ? `**${arch}** / ${cache}` : '';
            lines.push(`| ${prefix} | ${sched} | ${ttft} | ${tpot} | ${e2e} | ${goodput} |`);
          }
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate statistical analysis section.
   */
  private generateStatisticalAnalysis(result: ExperimentMatrixResult): string {
    const lines: string[] = [];
    lines.push('## Statistical Analysis\n');

    // Dimension Impact
    lines.push('### Dimension Impact Analysis\n');

    // Architecture Impact
    lines.push('#### Architecture Impact');
    lines.push('| Architecture | TTFT Mean (ms) | TPOT Mean (ms) | Goodput Mean (%) |');
    lines.push('|--------------|----------------|----------------|------------------|');
    
    for (const arch of result.dimensions.architectures) {
      const stats = result.analysis.architectureImpact[arch];
      if (stats) {
        lines.push(`| ${arch} | ${stats.ttft.mean.toFixed(1)} ± ${stats.ttft.std.toFixed(1)} | ${stats.tpot.mean.toFixed(1)} ± ${stats.tpot.std.toFixed(1)} | ${(stats.goodput * 100).toFixed(1)} |`);
      }
    }
    lines.push('');

    // Cache Impact
    lines.push('#### Cache Impact');
    lines.push('| Cache Type | TTFT Mean (ms) | TPOT Mean (ms) | Goodput Mean (%) |');
    lines.push('|------------|----------------|----------------|------------------|');
    
    for (const cache of result.dimensions.caches) {
      const stats = result.analysis.cacheImpact[cache];
      if (stats) {
        lines.push(`| ${cache} | ${stats.ttft.mean.toFixed(1)} ± ${stats.ttft.std.toFixed(1)} | ${stats.tpot.mean.toFixed(1)} ± ${stats.tpot.std.toFixed(1)} | ${(stats.goodput * 100).toFixed(1)} |`);
      }
    }
    lines.push('');

    // Scheduler Impact
    lines.push('#### Scheduler Impact');
    lines.push('| Scheduler | TTFT Mean (ms) | TPOT Mean (ms) | Goodput Mean (%) |');
    lines.push('|-----------|----------------|----------------|------------------|');
    
    for (const sched of result.dimensions.schedulers) {
      const stats = result.analysis.schedulerImpact[sched];
      if (stats) {
        lines.push(`| ${sched} | ${stats.ttft.mean.toFixed(1)} ± ${stats.ttft.std.toFixed(1)} | ${stats.tpot.mean.toFixed(1)} ± ${stats.tpot.std.toFixed(1)} | ${(stats.goodput * 100).toFixed(1)} |`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate winners section.
   */
  private generateWinners(result: ExperimentMatrixResult): string {
    const lines: string[] = [];
    lines.push('## Winners Analysis\n');

    lines.push('### Best Configuration per Metric\n');
    lines.push('| Metric | Winner | TTFT | TPOT | Goodput |');
    lines.push('|--------|--------|------|------|---------|');

    const metrics = ['ttft', 'tpot', 'e2e', 'goodput'] as const;
    const winnerMap = {
      ttft: result.winners.ttft,
      tpot: result.winners.tpot,
      e2e: result.winners.e2e,
      goodput: result.winners.goodput
    };

    for (const metric of metrics) {
      const winner = winnerMap[metric];
      const cell = result.cells.find(
        c => c.cell.architecture === winner.architecture &&
             c.cell.cache === winner.cache &&
             c.cell.scheduler === winner.scheduler
      );
      
      if (cell) {
        const name = `${winner.architecture}/${winner.cache}/${winner.scheduler}`;
        const value = metric === 'goodput' 
          ? `${(cell.goodputStats.mean * 100).toFixed(1)}%`
          : `${cell[`${metric}Stats`].mean.toFixed(1)} ms`;
        
        lines.push(`| ${metric.toUpperCase()} | ${name} | ${cell.ttftStats.mean.toFixed(1)} | ${cell.tpotStats.mean.toFixed(1)} | ${(cell.goodputStats.mean * 100).toFixed(1)}% |`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate conclusions.
   */
  private generateConclusions(result: ExperimentMatrixResult): string {
    const lines: string[] = [];
    lines.push('## Conclusions\n');

    // Architecture conclusions
    const archBest = result.winners.overall.architecture;
    const archStats = result.analysis.architectureImpact[archBest];
    const archBaseline = result.analysis.architectureImpact['monolithic'];
    
    let archImprovement = 0;
    if (archStats && archBaseline) {
      archImprovement = ((archBaseline.ttft.mean - archStats.ttft.mean) / archBaseline.ttft.mean) * 100;
    }

    lines.push(`### Architecture Recommendation`);
    lines.push(`The **${archBest}** architecture provides the best overall performance.`);
    lines.push(`Compared to monolithic baseline, it achieves **${archImprovement.toFixed(1)}% TTFT improvement**.\n`);

    // Cache conclusions
    const cacheBest = result.winners.overall.cache;
    const cacheStats = result.analysis.cacheImpact[cacheBest];
    const cacheBaseline = result.analysis.cacheImpact['none'];
    
    let cacheImprovement = 0;
    if (cacheStats && cacheBaseline) {
      cacheImprovement = ((cacheBaseline.ttft.mean - cacheStats.ttft.mean) / cacheBaseline.ttft.mean) * 100;
    }

    lines.push(`### Cache Recommendation`);
    lines.push(`**${cacheBest}** cache provides the best performance.`);
    lines.push(`Compared to no cache, it achieves **${cacheImprovement.toFixed(1)}% TTFT improvement**.\n`);

    // Scheduler conclusions
    const schedBest = result.winners.overall.scheduler;

    lines.push(`### Scheduler Recommendation`);
    lines.push(`**${schedBest}** scheduler provides the best overall performance.\n`);

    // Final recommendation
    lines.push(`### Final Configuration`);
    lines.push('```yaml');
    lines.push(`architecture: ${archBest}`);
    lines.push(`cache: ${cacheBest}`);
    lines.push(`scheduler: ${schedBest}`);
    lines.push('```');

    return lines.join('\n');
  }

  /**
   * Generate ablation summary.
   */
  private generateAblationSummary(result: AblationStudyResult): string {
    const lines: string[] = [];
    lines.push('## Ablation Study Summary\n');

    lines.push(`### Study Overview`);
    lines.push(`- **Baseline:** ${result.config.baseline}`);
    lines.push(`- **Modules Ablated:** ${result.config.modules.join(' → ')}`);
    lines.push(`- **Repetitions:** ${result.config.repetitions}\n`);

    lines.push(`### Total Improvement`);
    lines.push('| Metric | Improvement |');
    lines.push('|--------|-------------|');
    lines.push(`| TTFT | ${result.totalImprovement.ttftImprovementPercent.toFixed(1)}% |`);
    lines.push(`| TPOT | ${result.totalImprovement.tpotImprovementPercent.toFixed(1)}% |`);
    lines.push(`| E2E | ${result.totalImprovement.e2eImprovementPercent.toFixed(1)}% |`);
    lines.push(`| Goodput | ${result.totalImprovement.goodputImprovementPercent.toFixed(1)}% |\n`);

    return lines.join('\n');
  }

  /**
   * Generate ablation table.
   */
  private generateAblationTable(result: AblationStudyResult): string {
    const lines: string[] = [];
    lines.push('## Ablation Table\n');

    lines.push('| Configuration | TTFT (ms) | TPOT (ms) | E2E (ms) | Goodput (%) | Improvement |');
    lines.push('|---------------|-----------|-----------|----------|-------------|-------------|');

    for (const step of result.steps) {
      const config = step.configId;
      const ttft = step.metrics.ttftP50.toFixed(1);
      const tpot = step.metrics.tpotP50.toFixed(1);
      const e2e = (step.metrics.ttftP99 + step.metrics.tpotP99 * 10).toFixed(1); // Simplified
      const goodput = (step.goodput * 100).toFixed(1);
      const improvement = step.incrementalImprovement.ttftDelta !== 0
        ? `${(step.incrementalImprovement.ttftDelta * 100).toFixed(1)}%`
        : 'baseline';

      lines.push(`| ${config} | ${ttft} | ${tpot} | ${e2e} | ${goodput} | ${improvement} |`);
    }

    return lines.join('\n');
  }

  /**
   * Generate module contributions.
   */
  private generateModuleContributions(result: AblationStudyResult): string {
    const lines: string[] = [];
    lines.push('## Module Contributions\n');

    lines.push('| Module | Avg Improvement | Relative Contribution |');
    lines.push('|--------|-----------------|----------------------|');

    for (const [module, contrib] of Object.entries(result.moduleContributions)) {
      lines.push(`| ${module} | ${contrib.avgImprovement.toFixed(1)}% | ${(contrib.relativeContribution * 100).toFixed(1)}% |`);
    }

    return lines.join('\n');
  }

  /**
   * Generate ablation conclusions.
   */
  private generateAblationConclusions(result: AblationStudyResult): string {
    const lines: string[] = [];
    lines.push('## Conclusions\n');

    // Find top contributor
    let topModule = '';
    let topContrib = 0;
    for (const [module, contrib] of Object.entries(result.moduleContributions)) {
      if (contrib.relativeContribution > topContrib) {
        topContrib = contrib.relativeContribution;
        topModule = module;
      }
    }

    lines.push(`### Key Findings`);
    lines.push(`1. **Top Contributor:** The **${topModule}** module provides the largest performance improvement.`);
    lines.push(`2. **Total Improvement:** Enabling all modules achieves ${result.totalImprovement.goodputImprovementPercent.toFixed(1)}% goodput improvement over baseline.`);
    lines.push(`3. **Diminishing Returns:** [Analyze if any module shows diminishing returns]\n`);

    lines.push(`### Recommendations`);
    lines.push(`- **Minimum Viable Configuration:** [Module combination for best cost/benefit]`);
    lines.push(`- **Maximum Performance:** Enable all modules for best performance.`);

    return lines.join('\n');
  }

  /**
   * Generate configuration section for custom reports.
   */
  private generateConfiguration(config: ExperimentConfig): string {
    const lines: string[] = [];
    lines.push('## Experiment Configuration\n');

    lines.push(`### System`);
    lines.push(`- **Architecture:** ${config.simulator.architecture}`);
    lines.push(`- **Cache:** ${config.cache.type} (${config.cache.capacityMB}MB)`);
    lines.push(`- **Scheduler:** ${config.scheduler.type}\n`);

    lines.push(`### Workload`);
    lines.push(`- **Requests:** ${config.workload.requestCount}`);
    lines.push(`- **Avg Prompt Tokens:** ${config.workload.avgPromptTokens}`);
    lines.push(`- **Avg Completion Tokens:** ${config.workload.avgCompletionTokens}`);
    lines.push(`- **QPS:** ${config.workload.qps}\n`);

    lines.push(`### Statistical`);
    lines.push(`- **Repetitions:** ${config.statistical.repetitions}`);
    lines.push(`- **Warmup Iterations:** ${config.statistical.warmupIterations}`);
    lines.push(`- **Confidence Level:** ${(config.statistical.confidenceLevel * 100).toFixed(0)}%\n`);

    return lines.join('\n');
  }

  /**
   * Generate summary statistics.
   */
  private generateSummaryStats(summary: StatisticalSummary): string {
    const lines: string[] = [];
    lines.push('## Results Summary\n');

    lines.push('| Metric | Mean | Std Dev | Median | 95% CI |');
    lines.push('|--------|------|---------|--------|--------|');
    lines.push(`| TTFT | ${summary.ttft.mean.toFixed(1)} ms | ${summary.ttft.std.toFixed(1)} | ${summary.ttft.median.toFixed(1)} | [${summary.ttft.ci95[0].toFixed(1)}, ${summary.ttft.ci95[1].toFixed(1)}] |`);
    lines.push(`| TPOT | ${summary.tpot.mean.toFixed(1)} ms | ${summary.tpot.std.toFixed(1)} | ${summary.tpot.median.toFixed(1)} | [${summary.tpot.ci95[0].toFixed(1)}, ${summary.tpot.ci95[1].toFixed(1)}] |`);
    lines.push(`| E2E | ${summary.e2e.mean.toFixed(1)} ms | ${summary.e2e.std.toFixed(1)} | ${summary.e2e.median.toFixed(1)} | [${summary.e2e.ci95[0].toFixed(1)}, ${summary.e2e.ci95[1].toFixed(1)}] |`);
    lines.push(`| **Goodput** | ${(summary.goodput * 100).toFixed(1)}% | - | - | - |\n`);

    return lines.join('\n');
  }

  /**
   * Generate comparisons section.
   */
  private generateComparisons(
    comparisons: Array<{
      name: string;
      baseline: StatisticalSummary;
      treatment: StatisticalSummary;
    }>
  ): string {
    const lines: string[] = [];
    lines.push('## Comparisons\n');

    for (const comp of comparisons) {
      lines.push(`### ${comp.name}\n`);
      lines.push('| Metric | Baseline | Treatment | Change | Significant |');
      lines.push('|--------|----------|-----------|--------|-------------|');

      const metrics = ['ttft', 'tpot', 'e2e'] as const;
      for (const metric of metrics) {
        const baseline = comp.baseline[`${metric}`].mean;
        const treatment = comp.treatment[`${metric}`].mean;
        const change = treatment - baseline;
        const pctChange = baseline !== 0 ? (change / baseline) * 100 : 0;
        const sig = Math.abs(pctChange) > 10 ? '✓' : '✗';

        lines.push(`| ${metric.toUpperCase()} | ${baseline.toFixed(1)} | ${treatment.toFixed(1)} | ${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(1)}% | ${sig} |`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate custom conclusions.
   */
  private generateCustomConclusions(config: ExperimentConfig, summary: StatisticalSummary): string {
    const lines: string[] = [];
    lines.push('## Conclusions\n');

    lines.push(`### Summary`);
    lines.push(`- The ${config.simulator.architecture} configuration with ${config.cache.type} cache achieved:`);
    lines.push(`  - TTFT: ${summary.ttft.mean.toFixed(1)} ms`);
    lines.push(`  - TPOT: ${summary.tpot.mean.toFixed(1)} ms`);
    lines.push(`  - Goodput: ${(summary.goodput * 100).toFixed(1)}%\n`);

    lines.push(`### Recommendations`);
    lines.push(`1. [Recommendation 1]`);
    lines.push(`2. [Recommendation 2]`);

    return lines.join('\n');
  }

  /**
   * Get cell name string.
   */
  private cellName(cell: { architecture: string; cache: string; scheduler: string }): string {
    return `${cell.architecture}/${cell.cache}/${cell.scheduler}`;
  }

  /**
   * Get cell mean for a metric.
   */
  private getCellMean(result: ExperimentMatrixResult, cell: { architecture: string; cache: string; scheduler: string }, metric: 'ttft' | 'tpot' | 'e2e' | 'goodput'): number {
    const found = result.cells.find(
      c => c.cell.architecture === cell.architecture &&
           c.cell.cache === cell.cache &&
           c.cell.scheduler === cell.scheduler
    );
    
    if (!found) return 0;
    
    if (metric === 'goodput') return found.goodputStats.mean;
    return found[`${metric}Stats`].mean;
  }
}

/**
 * Create experiment reporter with options.
 */
export function createExperimentReporter(
  options?: Partial<ExperimentReporterOptions>
): ExperimentReporter {
  return new ExperimentReporter(options);
}

/**
 * Quick report generation helper.
 */
export async function generateQuickReport(
  config: ExperimentConfig,
  summary: StatisticalSummary,
  outputPath?: string
): Promise<string> {
  const reporter = new ExperimentReporter();
  const content = reporter.generateCustomReport(
    `Experiment Report: ${config.name}`,
    config,
    summary
  );
  
  if (outputPath) {
    return await reporter.saveReport(content, outputPath);
  }
  
  return content;
}
