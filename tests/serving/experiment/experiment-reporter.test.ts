/**
 * Experiment Reporter Tests
 * 
 * Tests for:
 * - Report generation from matrix results
 * - Report generation from ablation results
 * - Custom report generation
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  ExperimentReporter,
  createExperimentReporter,
  generateQuickReport
} from '../../../src/agents/learningAssistant/serving/experiment/ExperimentReporter.ts';
import type { ExperimentMatrixResult, MatrixCell } from '../../../src/agents/learningAssistant/serving/experiment/ExperimentMatrix.ts';
import type { AblationStudyResult, AblationStepResult } from '../../../src/agents/learningAssistant/serving/experiment/AblationStudyRunner.ts';
import type { StatisticalSummary } from '../../../src/agents/learningAssistant/serving/experiment/StatisticalReporter.ts';
import { createDefaultExperimentConfig } from '../../../src/agents/learningAssistant/serving/experiment/ExperimentConfig.ts';

describe('ExperimentReporter', () => {
  let reporter: ExperimentReporter;

  beforeEach(() => {
    reporter = createExperimentReporter({
      outputDir: '/tmp/test_reports',
      includeRawData: true
    });
  });

  describe('constructor', () => {
    it('should use default options when none provided', () => {
      const defaultReporter = createExperimentReporter();
      
      assert.strictEqual(defaultReporter['options'].format, 'markdown');
      assert.ok(defaultReporter['options'].outputDir.includes('experiments'));
    });

    it('should merge custom options with defaults', () => {
      const customReporter = createExperimentReporter({
        outputDir: '/custom/path',
        includeVisualizations: true
      });
      
      assert.strictEqual(customReporter['options'].outputDir, '/custom/path');
      assert.ok(customReporter['options'].includeVisualizations);
      // Default preserved
      assert.strictEqual(customReporter['options'].format, 'markdown');
    });
  });

  describe('generateMatrixReport', () => {
    it('should generate report with header', () => {
      const result = createMockMatrixResult();
      const report = reporter.generateMatrixReport(result);
      
      assert.ok(report.includes('# 3×3×3 Experiment Matrix Report'));
      assert.ok(report.includes('**Type:** Matrix Report'));
    });

    it('should include executive summary', () => {
      const result = createMockMatrixResult();
      const report = reporter.generateMatrixReport(result);
      
      assert.ok(report.includes('## Executive Summary'));
      assert.ok(report.includes('### Quick Stats'));
      assert.ok(report.includes('### Best Performers'));
    });

    it('should include results table', () => {
      const result = createMockMatrixResult();
      const report = reporter.generateMatrixReport(result);
      
      assert.ok(report.includes('## Experiment Results'));
      assert.ok(report.includes('### 3×3×3 Matrix Results'));
      assert.ok(report.includes('| Arch'));
    });

    it('should include statistical analysis', () => {
      const result = createMockMatrixResult();
      const report = reporter.generateMatrixReport(result);
      
      assert.ok(report.includes('## Statistical Analysis'));
      assert.ok(report.includes('### Dimension Impact Analysis'));
      assert.ok(report.includes('#### Architecture Impact'));
      assert.ok(report.includes('#### Cache Impact'));
      assert.ok(report.includes('#### Scheduler Impact'));
    });

    it('should include winners analysis', () => {
      const result = createMockMatrixResult();
      const report = reporter.generateMatrixReport(result);
      
      assert.ok(report.includes('## Winners Analysis'));
      assert.ok(report.includes('### Best Configuration per Metric'));
    });

    it('should include conclusions', () => {
      const result = createMockMatrixResult();
      const report = reporter.generateMatrixReport(result);
      
      assert.ok(report.includes('## Conclusions'));
      assert.ok(report.includes('### Architecture Recommendation'));
      assert.ok(report.includes('### Cache Recommendation'));
      assert.ok(report.includes('### Scheduler Recommendation'));
      assert.ok(report.includes('### Final Configuration'));
    });

    it('should display winners correctly', () => {
      const result = createMockMatrixResult();
      const report = reporter.generateMatrixReport(result);
      
      // Should mention the winning configuration
      assert.ok(report.includes('pd_separated'));
    });
  });

  describe('generateAblationReport', () => {
    it('should generate report with header', () => {
      const result = createMockAblationResult();
      const report = reporter.generateAblationReport(result);
      
      assert.ok(report.includes('# Ablation Study Report'));
      assert.ok(report.includes('**Type:** Ablation Report'));
    });

    it('should include summary', () => {
      const result = createMockAblationResult();
      const report = reporter.generateAblationReport(result);
      
      assert.ok(report.includes('## Ablation Study Summary'));
      assert.ok(report.includes('### Study Overview'));
      assert.ok(report.includes('### Total Improvement'));
    });

    it('should include ablation table', () => {
      const result = createMockAblationResult();
      const report = reporter.generateAblationReport(result);
      
      assert.ok(report.includes('## Ablation Table'));
      assert.ok(report.includes('| Configuration |'));
      assert.ok(report.includes('TTFT'));
      assert.ok(report.includes('Improvement'));
    });

    it('should include module contributions', () => {
      const result = createMockAblationResult();
      const report = reporter.generateAblationReport(result);
      
      assert.ok(report.includes('## Module Contributions'));
      assert.ok(report.includes('| Module |'));
      assert.ok(report.includes('Avg Improvement'));
      assert.ok(report.includes('Relative Contribution'));
    });

    it('should include conclusions', () => {
      const result = createMockAblationResult();
      const report = reporter.generateAblationReport(result);
      
      assert.ok(report.includes('## Conclusions'));
      assert.ok(report.includes('### Key Findings'));
      assert.ok(report.includes('### Recommendations'));
    });
  });

  describe('generateCustomReport', () => {
    it('should generate report with custom title', () => {
      const config = createDefaultExperimentConfig('custom', 'Custom Experiment');
      const summary = createMockSummary();
      const report = reporter.generateCustomReport('Custom Report Title', config, summary);
      
      assert.ok(report.includes('# Custom Report Title'));
    });

    it('should include configuration section', () => {
      const config = createDefaultExperimentConfig('custom', 'Custom Experiment');
      const summary = createMockSummary();
      const report = reporter.generateCustomReport('Test', config, summary);
      
      assert.ok(report.includes('## Experiment Configuration'));
      assert.ok(report.includes('pd_separated'));
      assert.ok(report.includes('radix'));
    });

    it('should include results summary', () => {
      const config = createDefaultExperimentConfig('custom', 'Custom Experiment');
      const summary = createMockSummary();
      const report = reporter.generateCustomReport('Test', config, summary);
      
      assert.ok(report.includes('## Results Summary'));
      assert.ok(report.includes('TTFT'));
      assert.ok(report.includes('TPOT'));
      assert.ok(report.includes('Goodput'));
    });

    it('should include comparisons when provided', () => {
      const config = createDefaultExperimentConfig('custom', 'Custom Experiment');
      const summary = createMockSummary();
      const comparisons = [
        {
          name: 'Test Comparison',
          baseline: createMockSummary(),
          treatment: createMockSummary(50)
        }
      ];
      const report = reporter.generateCustomReport('Test', config, summary, comparisons);
      
      assert.ok(report.includes('## Comparisons'));
      assert.ok(report.includes('Test Comparison'));
    });

    it('should include conclusions', () => {
      const config = createDefaultExperimentConfig('custom', 'Custom Experiment');
      const summary = createMockSummary();
      const report = reporter.generateCustomReport('Test', config, summary);
      
      assert.ok(report.includes('## Conclusions'));
      assert.ok(report.includes('### Summary'));
      assert.ok(report.includes('### Recommendations'));
    });
  });
});

describe('createExperimentReporter', () => {
  it('should create reporter with default options', () => {
    const reporter = createExperimentReporter();
    
    assert.ok(reporter instanceof ExperimentReporter);
  });

  it('should create reporter with custom options', () => {
    const reporter = createExperimentReporter({
      format: 'html',
      outputDir: '/test/output',
      includeRawData: false
    });
    
    assert.ok(reporter instanceof ExperimentReporter);
    assert.strictEqual(reporter['options'].format, 'html');
    assert.strictEqual(reporter['options'].outputDir, '/test/output');
    assert.strictEqual(reporter['options'].includeRawData, false);
  });
});

// Helper functions to create mock data

function createMockMatrixResult(): ExperimentMatrixResult {
  return {
    dimensions: {
      architectures: ['monolithic', 'pd_separated', 'hybrid'],
      caches: ['none', 'hash', 'radix'],
      schedulers: ['fcfs', 'sjf', 'slo_aware']
    },
    cells: [
      createMockCellResult('monolithic', 'none', 'fcfs'),
      createMockCellResult('pd_separated', 'radix', 'slo_aware'),
      createMockCellResult('hybrid', 'hash', 'sjf')
    ],
    winners: {
      ttft: { architecture: 'pd_separated', cache: 'radix', scheduler: 'slo_aware' },
      tpot: { architecture: 'pd_separated', cache: 'radix', scheduler: 'slo_aware' },
      e2e: { architecture: 'pd_separated', cache: 'radix', scheduler: 'slo_aware' },
      goodput: { architecture: 'pd_separated', cache: 'radix', scheduler: 'slo_aware' },
      overall: { architecture: 'pd_separated', cache: 'radix', scheduler: 'slo_aware' }
    },
    analysis: {
      architectureImpact: {
        monolithic: createMockSummary(200),
        pd_separated: createMockSummary(150),
        hybrid: createMockSummary(180)
      },
      cacheImpact: {
        none: createMockSummary(200),
        hash: createMockSummary(170),
        radix: createMockSummary(150)
      },
      schedulerImpact: {
        fcfs: createMockSummary(180),
        sjf: createMockSummary(160),
        slo_aware: createMockSummary(150)
      },
      interactions: {
        archCache: {},
        archScheduler: {},
        cacheScheduler: {}
      }
    },
    significanceTable: []
  };
}

function createMockCellResult(
  arch: string,
  cache: string,
  sched: string
): any {
  return {
    cell: {
      architecture: arch,
      cache,
      scheduler: sched,
      config: createDefaultExperimentConfig(`${arch}_${cache}_${sched}`, `${arch}/${cache}/${sched}`)
    },
    ttftStats: { mean: 150, std: 20, min: 120, max: 200, median: 145, ci95: [130, 170], ci99: [120, 180], n: 10 },
    tpotStats: { mean: 30, std: 5, min: 25, max: 40, median: 28, ci95: [25, 35], ci99: [23, 37], n: 10 },
    e2eStats: { mean: 500, std: 80, min: 400, max: 650, median: 480, ci95: [420, 580], ci99: [380, 620], n: 10 },
    goodputStats: { mean: 0.92, std: 0.03, ci95: [0.89, 0.95] },
    measurements: [],
    significance: {
      vsMonolithic: true,
      vsNoCache: true,
      vsFCFS: true
    }
  };
}

function createMockAblationResult(): AblationStudyResult {
  return {
    config: {
      baseline: 'no_modules',
      modules: ['cache', 'chunked_prefill', 'slo_aware'],
      workload: [],
      repetitions: 10,
      enableDetailedMetrics: true
    },
    steps: [
      createMockAblationStep('baseline', [], null, 200, 40, 0.85),
      createMockAblationStep('cache', ['cache'], 'cache', 170, 35, 0.90),
      createMockAblationStep('cache+chunked', ['cache', 'chunked_prefill'], 'chunked_prefill', 155, 32, 0.93),
      createMockAblationStep('full', ['cache', 'chunked_prefill', 'slo_aware'], 'slo_aware', 140, 28, 0.96)
    ] as AblationStepResult[],
    baselineMetrics: { ttftP50: 200, ttftP90: 250, ttftP99: 300, tpotP50: 40, tpotP90: 50, tpotP99: 60, goodput: 0.85, throughput: 100 },
    finalMetrics: { ttftP50: 140, ttftP90: 180, ttftP99: 220, tpotP50: 28, tpotP90: 35, tpotP99: 42, goodput: 0.96, throughput: 150 },
    totalImprovement: {
      ttftImprovementPercent: 30,
      tpotImprovementPercent: 30,
      e2eImprovementPercent: 25,
      goodputImprovementPercent: 12.9
    },
    moduleContributions: {
      cache: { avgImprovement: 15, relativeContribution: 0.4 },
      chunked_prefill: { avgImprovement: 10, relativeContribution: 0.27 },
      slo_aware: { avgImprovement: 12.5, relativeContribution: 0.33 }
    },
    ablationTable: []
  };
}

function createMockAblationStep(
  id: string,
  enabled: string[],
  newModule: string | null,
  ttft: number,
  tpot: number,
  goodput: number
): AblationStepResult {
  return {
    configId: id,
    enabledModules: enabled as any[],
    newModule: newModule as any,
    metrics: {
      ttftP50: ttft,
      ttftP90: ttft * 1.2,
      ttftP99: ttft * 1.5,
      tpotP50: tpot,
      tpotP90: tpot * 1.2,
      tpotP99: tpot * 1.5,
      goodput,
      throughput: 100
    },
    goodput,
    incrementalImprovement: { ttftDelta: 0, tpotDelta: 0, e2eDelta: 0, goodputDelta: 0 },
    cumulativeImprovement: { ttftDelta: 0, tpotDelta: 0, e2eDelta: 0, goodputDelta: 0 }
  };
}

function createMockSummary(ttftBase: number = 100): StatisticalSummary {
  return {
    ttft: { mean: ttftBase, std: 15, min: ttftBase - 20, max: ttftBase + 30, median: ttftBase - 5, ci95: [ttftBase - 10, ttftBase + 20], ci99: [ttftBase - 15, ttftBase + 25], n: 10 },
    tpot: { mean: 25, std: 5, min: 20, max: 35, median: 24, ci95: [20, 30], ci99: [18, 32], n: 10 },
    e2e: { mean: 400, std: 50, min: 350, max: 500, median: 390, ci95: [350, 450], ci99: [330, 470], n: 10 },
    goodput: 0.92
  };
}
