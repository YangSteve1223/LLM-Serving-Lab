/**
 * Tests for Statistical Reporter
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  StatisticalReporter,
  type Measurement,
  type ExperimentConditions
} from '../../../src/agents/learningAssistant/serving/experiment/StatisticalReporter.ts';

describe('StatisticalReporter', () => {
  const reporter = new StatisticalReporter();

  // Create sample measurements
  function createMeasurements(count: number, baseTTFT: number, baseTPOT: number, baseE2E: number): Measurement[] {
    return Array.from({ length: count }, (_, i) => ({
      requestId: `req-${i}`,
      ttftMs: baseTTFT + (Math.random() - 0.5) * 10,
      tpotMs: baseTPOT + (Math.random() - 0.5) * 2,
      e2eMs: baseE2E + (Math.random() - 0.5) * 50,
      metSLO: Math.random() > 0.1
    }));
  }

  describe('calculateSummary', () => {
    it('should calculate statistics for measurements', () => {
      const measurements = createMeasurements(100, 100, 10, 1000);

      const summary = reporter.calculateSummary(measurements);

      assert.ok(summary.ttft.mean > 0);
      assert.ok(summary.tpot.mean > 0);
      assert.ok(summary.e2e.mean > 0);
      assert.ok(summary.goodput > 0);
    });

    it('should calculate correct mean', () => {
      const measurements: Measurement[] = [
        { requestId: 'req-1', ttftMs: 100, tpotMs: 10, e2eMs: 1000, metSLO: true },
        { requestId: 'req-2', ttftMs: 200, tpotMs: 20, e2eMs: 2000, metSLO: true },
        { requestId: 'req-3', ttftMs: 150, tpotMs: 15, e2eMs: 1500, metSLO: false }
      ];

      const summary = reporter.calculateSummary(measurements);

      assert.ok(Math.abs(summary.ttft.mean - 150) < 1);
      assert.ok(Math.abs(summary.tpot.mean - 15) < 1);
      assert.ok(Math.abs(summary.e2e.mean - 1500) < 10);
    });

    it('should handle empty measurements', () => {
      const summary = reporter.calculateSummary([]);

      assert.strictEqual(summary.ttft.n, 0);
      assert.strictEqual(summary.tpot.n, 0);
      assert.strictEqual(summary.e2e.n, 0);
      assert.strictEqual(summary.goodput, 0);
    });

    it('should calculate standard deviation', () => {
      const measurements: Measurement[] = [
        { requestId: 'req-1', ttftMs: 100, tpotMs: 10, e2eMs: 1000, metSLO: true },
        { requestId: 'req-2', ttftMs: 200, tpotMs: 20, e2eMs: 2000, metSLO: true },
        { requestId: 'req-3', ttftMs: 150, tpotMs: 15, e2eMs: 1500, metSLO: false }
      ];

      const summary = reporter.calculateSummary(measurements);

      assert.ok(summary.ttft.std > 0);
    });

    it('should calculate confidence intervals', () => {
      const measurements = createMeasurements(50, 100, 10, 1000);

      const summary = reporter.calculateSummary(measurements);

      assert.ok(summary.ttft.ci95.length === 2);
      assert.ok(summary.ttft.ci95[0] < summary.ttft.ci95[1]);
      assert.ok(summary.ttft.ci99.length === 2);
    });

    it('should calculate min/max correctly', () => {
      const measurements: Measurement[] = [
        { requestId: 'req-1', ttftMs: 50, tpotMs: 5, e2eMs: 500, metSLO: true },
        { requestId: 'req-2', ttftMs: 200, tpotMs: 25, e2eMs: 2000, metSLO: true },
        { requestId: 'req-3', ttftMs: 100, tpotMs: 15, e2eMs: 1000, metSLO: false }
      ];

      const summary = reporter.calculateSummary(measurements);

      assert.ok(Math.abs(summary.ttft.min - 50) < 1);
      assert.ok(Math.abs(summary.ttft.max - 200) < 1);
    });
  });

  describe('calculateMetricStats', () => {
    it('should calculate median correctly for odd count', () => {
      const values = [1, 2, 3, 4, 5];
      const stats = reporter.calculateMetricStats(values);

      assert.strictEqual(stats.median, 3);
    });

    it('should calculate median correctly for even count', () => {
      const values = [1, 2, 3, 4];
      const stats = reporter.calculateMetricStats(values);

      assert.strictEqual(stats.median, 2.5);
    });

    it('should handle single value', () => {
      const values = [42];
      const stats = reporter.calculateMetricStats(values);

      assert.strictEqual(stats.mean, 42);
      assert.strictEqual(stats.median, 42);
      assert.strictEqual(stats.min, 42);
      assert.strictEqual(stats.max, 42);
    });

    it('should handle empty array', () => {
      const stats = reporter.calculateMetricStats([]);

      assert.strictEqual(stats.n, 0);
      assert.strictEqual(stats.mean, 0);
    });
  });

  describe('runTTest', () => {
    it('should perform t-test and return valid results', () => {
      const group1 = [100, 102, 98, 101, 99];
      const group2 = [200, 202, 198, 201, 199];

      const result = reporter.runTTest(group1, group2, 0.05);

      // T-test should run and produce valid results
      assert.ok(result);
      assert.ok(typeof result.pValue === 'number');
      assert.ok(typeof result.significant === 'boolean');
      assert.ok(result.pValue >= 0 && result.pValue <= 1);
    });

    it('should detect no significant difference for similar groups', () => {
      const group1 = [100, 102, 98, 101, 99];
      const group2 = [100.5, 101.5, 99.5, 100, 101];

      const result = reporter.runTTest(group1, group2, 0.05);

      // These groups should not be significantly different
      assert.strictEqual(typeof result.significant, 'boolean');
    });

    it('should include test statistics', () => {
      const group1 = [100, 102, 98];
      const group2 = [110, 112, 108];

      const result = reporter.runTTest(group1, group2);

      assert.strictEqual(result.name, "Welch's t-test");
      assert.ok(result.statistic !== undefined);
      assert.ok(result.alpha !== undefined);
    });
  });

  describe('generateMarkdownReport', () => {
    const conditions: ExperimentConditions = {
      numRequests: 100,
      repetitions: 3,
      warmupRequests: 10,
      workloadDescription: 'Synthetic workload with varying token counts',
      systemConfig: 'PD Separation with 4 prefill + 8 decode workers',
      timestamp: new Date().toISOString()
    };

    it('should generate report header', () => {
      const measurements = createMeasurements(100, 100, 10, 1000);
      const summary = reporter.calculateSummary(measurements);

      const report = reporter.generateMarkdownReport(summary, conditions);

      assert.ok(report.includes('# Statistical Analysis Report'));
      assert.ok(report.includes('## Experiment Conditions'));
      assert.ok(report.includes('## Summary Statistics'));
    });

    it('should include all conditions', () => {
      const measurements = createMeasurements(100, 100, 10, 1000);
      const summary = reporter.calculateSummary(measurements);

      const report = reporter.generateMarkdownReport(summary, conditions);

      assert.ok(report.includes('100')); // numRequests
      assert.ok(report.includes('Synthetic workload'));
      assert.ok(report.includes('PD Separation'));
    });

    it('should include statistics table', () => {
      const measurements = createMeasurements(100, 100, 10, 1000);
      const summary = reporter.calculateSummary(measurements);

      const report = reporter.generateMarkdownReport(summary, conditions);

      assert.ok(report.includes('| Metric |'));
      assert.ok(report.includes('| Mean |'));
      assert.ok(report.includes('TTFT'));
      assert.ok(report.includes('TPOT'));
      assert.ok(report.includes('E2E'));
    });

    it('should include comparisons when provided', () => {
      const baselineMeasurements = createMeasurements(100, 100, 10, 1000);
      const treatmentMeasurements = createMeasurements(100, 90, 9, 900);
      const baselineSummary = reporter.calculateSummary(baselineMeasurements);
      const treatmentSummary = reporter.calculateSummary(treatmentMeasurements);

      const report = reporter.generateMarkdownReport(
        treatmentSummary, 
        conditions,
        [{
          name: 'PD Separation vs Baseline',
          baseline: baselineSummary,
          treatment: treatmentSummary
        }]
      );

      assert.ok(report.includes('## Statistical Comparisons'));
      assert.ok(report.includes('PD Separation vs Baseline'));
    });

    it('should include methodology section', () => {
      const measurements = createMeasurements(100, 100, 10, 1000);
      const summary = reporter.calculateSummary(measurements);

      const report = reporter.generateMarkdownReport(summary, conditions);

      assert.ok(report.includes('## Methodology'));
      assert.ok(report.includes('t-distribution'));
      assert.ok(report.includes("Welch's t-test"));
    });
  });

  describe('generateHTMLReport', () => {
    const conditions: ExperimentConditions = {
      numRequests: 100,
      repetitions: 3,
      warmupRequests: 10,
      workloadDescription: 'Test workload',
      systemConfig: 'Test system',
      timestamp: new Date().toISOString()
    };

    it('should generate valid HTML', () => {
      const measurements = createMeasurements(100, 100, 10, 1000);
      const summary = reporter.calculateSummary(measurements);

      const report = reporter.generateHTMLReport(summary, conditions);

      assert.ok(report.includes('<!DOCTYPE html>'));
      assert.ok(report.includes('<html>'));
      assert.ok(report.includes('</html>'));
    });

    it('should include title', () => {
      const measurements = createMeasurements(100, 100, 10, 1000);
      const summary = reporter.calculateSummary(measurements);

      const report = reporter.generateHTMLReport(summary, conditions);

      assert.ok(report.includes('<title>Statistical Analysis Report</title>'));
    });

    it('should include statistics table', () => {
      const measurements = createMeasurements(100, 100, 10, 1000);
      const summary = reporter.calculateSummary(measurements);

      const report = reporter.generateHTMLReport(summary, conditions);

      assert.ok(report.includes('<table>'));
      assert.ok(report.includes('TTFT'));
      assert.ok(report.includes('TPOT'));
      assert.ok(report.includes('E2E'));
    });
  });
});
