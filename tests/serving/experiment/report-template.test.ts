/**
 * Report Template Tests
 * 
 * Tests for:
 * - ReportTemplate generation
 * - Table formatting
 * - Summary generation
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ReportTemplate,
  createReportTemplate,
  generateSummaryTable,
  significanceBadge,
  DEFAULT_REPORT_CONFIG,
  METRIC_DISPLAY
} from '../../../src/agents/learningAssistant/serving/experiment/ReportTemplate.ts';
import type { ReportTemplateConfig } from '../../../src/agents/learningAssistant/serving/experiment/ReportTemplate.ts';

describe('ReportTemplate', () => {
  describe('constructor', () => {
    it('should use default config when none provided', () => {
      const template = new ReportTemplate();
      
      assert.strictEqual(template['config'].title, DEFAULT_REPORT_CONFIG.title);
      assert.strictEqual(template['config'].documentType, DEFAULT_REPORT_CONFIG.documentType);
      assert.strictEqual(template['config'].confidenceLevel, DEFAULT_REPORT_CONFIG.confidenceLevel);
    });

    it('should merge custom config with defaults', () => {
      const template = new ReportTemplate({
        title: 'Custom Title',
        documentType: 'ablation',
        confidenceLevel: 0.99
      });
      
      assert.strictEqual(template['config'].title, 'Custom Title');
      assert.strictEqual(template['config'].documentType, 'ablation');
      assert.strictEqual(template['config'].confidenceLevel, 0.99);
      // Default values preserved
      assert.strictEqual(template['config'].includeStatistics, DEFAULT_REPORT_CONFIG.includeStatistics);
    });
  });

  describe('generate', () => {
    it('should generate report with all sections', () => {
      const template = createReportTemplate();
      const report = template.generate();
      
      assert.ok(report.includes('#'));
      assert.ok(report.includes('## Summary'));
      assert.ok(report.includes('## Experiment Configuration'));
      assert.ok(report.includes('## Methodology'));
      assert.ok(report.includes('## Results'));
      assert.ok(report.includes('## Statistical Analysis'));
      assert.ok(report.includes('## Comparative Analysis'));
      assert.ok(report.includes('## Conclusions'));
      assert.ok(report.includes('## Appendix'));
    });

    it('should include correct document type', () => {
      const template = createReportTemplate({ documentType: 'benchmark' });
      const report = template.generate();
      
      assert.ok(report.includes('**Document Type:** Benchmark Report'));
    });

    it('should include confidence level', () => {
      const template = createReportTemplate({ confidenceLevel: 0.99 });
      const report = template.generate();
      
      assert.ok(report.includes('**Confidence Level:** 99%'));
    });

    it('should include significance threshold', () => {
      const template = createReportTemplate({ significanceThreshold: 0.01 });
      const report = template.generate();
      
      assert.ok(report.includes('α = 0.01'));
    });

    it('should not include statistics section when disabled', () => {
      const template = createReportTemplate({ includeStatistics: false });
      const report = template.generate();
      
      assert.ok(!report.includes('## Statistical Analysis'));
    });

    it('should not include detailed raw data tables when disabled', () => {
      const template = createReportTemplate({ includeRawData: false });
      const report = template.generate();
      
      assert.ok(report.includes('## Results'));
      // Should not include detailed data tables
      assert.ok(!report.includes('Raw Data Summary'));
    });

    it('should not include comparisons when disabled', () => {
      const template = createReportTemplate({ includeComparisons: false });
      const report = template.generate();
      
      assert.ok(!report.includes('## Comparative Analysis'));
    });
  });

  describe('addSection', () => {
    it('should add custom section', () => {
      const template = createReportTemplate();
      template.addSection('summary', '## Custom Section\n\nThis is custom content.');
      
      const section = template.getSection('summary');
      assert.ok(section?.includes('Custom Section'));
    });
  });

  describe('getSection', () => {
    it('should return undefined for non-existent section', () => {
      const template = createReportTemplate();
      
      const section = template.getSection('header' as any);
      assert.strictEqual(section, undefined);
    });
  });
});

describe('createReportTemplate', () => {
  it('should create template with default config', () => {
    const template = createReportTemplate();
    
    assert.ok(template instanceof ReportTemplate);
  });

  it('should create template with custom config', () => {
    const template = createReportTemplate({
      title: 'My Report',
      documentType: 'analysis',
      includeRawData: false
    });
    
    assert.ok(template instanceof ReportTemplate);
    assert.ok(template['config'].title, 'My Report');
  });
});

describe('generateSummaryTable', () => {
  it('should generate markdown table from data', () => {
    const data = [
      { name: 'Config A', ttft: 100, tpot: 20, e2e: 500, goodput: 0.95 },
      { name: 'Config B', ttft: 150, tpot: 25, e2e: 600, goodput: 0.90 }
    ];
    
    const table = generateSummaryTable(data);
    
    assert.ok(table.includes('| Configuration |'));
    assert.ok(table.includes('| TTFT (ms) |'));
    assert.ok(table.includes('Config A'));
    assert.ok(table.includes('100.0'));
    assert.ok(table.includes('95.0'));
  });

  it('should handle empty data', () => {
    const table = generateSummaryTable([]);
    
    assert.ok(table.includes('| Configuration |'));
    assert.ok(table.includes('| TTFT (ms) |'));
    assert.ok(table.includes('| TPOT (ms) |'));
    assert.ok(table.includes('| E2E (ms) |'));
    assert.ok(table.includes('| Goodput (%) |'));
  });

  it('should format numbers correctly', () => {
    const data = [
      { name: 'Test', ttft: 123.456, tpot: 78.9, e2e: 999.99, goodput: 0.8765 }
    ];
    
    const table = generateSummaryTable(data);
    
    assert.ok(table.includes('123.5'));
    assert.ok(table.includes('78.9'));
    assert.ok(table.includes('1000.0'));
    assert.ok(table.includes('87.7'));
  });
});

describe('significanceBadge', () => {
  it('should return significant badge for p < threshold', () => {
    const badge = significanceBadge(0.01, 0.05);
    
    assert.ok(badge.includes('✓'));
    assert.ok(badge.includes('Significant'));
  });

  it('should return not significant badge for p >= threshold', () => {
    const badge = significanceBadge(0.1, 0.05);
    
    assert.ok(badge.includes('✗'));
    assert.ok(badge.includes('Not significant'));
  });

  it('should use default threshold of 0.05', () => {
    const badge = significanceBadge(0.03);
    
    assert.ok(badge.includes('✓'));
  });

  it('should handle boundary values', () => {
    const equalBadge = significanceBadge(0.05, 0.05);
    assert.ok(equalBadge.includes('✗')); // p = alpha is not significant
    
    const justBelow = significanceBadge(0.049, 0.05);
    assert.ok(justBelow.includes('✓'));
  });
});

describe('METRIC_DISPLAY', () => {
  it('should have all expected metrics', () => {
    const expected = ['ttft', 'tpot', 'e2e', 'goodput', 'throughput', 'cacheHitRate'];
    
    for (const metric of expected) {
      assert.ok(METRIC_DISPLAY[metric], `Missing metric: ${metric}`);
    }
  });

  it('should have proper structure for each metric', () => {
    for (const [key, display] of Object.entries(METRIC_DISPLAY)) {
      assert.ok(display.name, `Missing name for ${key}`);
      assert.ok(display.unit, `Missing unit for ${key}`);
      assert.ok(display.format, `Missing format for ${key}`);
    }
  });

  it('should have correct units', () => {
    assert.strictEqual(METRIC_DISPLAY.ttft.unit, 'ms');
    assert.strictEqual(METRIC_DISPLAY.tpot.unit, 'ms');
    assert.strictEqual(METRIC_DISPLAY.e2e.unit, 'ms');
    assert.strictEqual(METRIC_DISPLAY.goodput.unit, '%');
    assert.strictEqual(METRIC_DISPLAY.throughput.unit, 'tokens/s');
    assert.strictEqual(METRIC_DISPLAY.cacheHitRate.unit, '%');
  });
});

describe('DEFAULT_REPORT_CONFIG', () => {
  it('should have sensible defaults', () => {
    assert.strictEqual(DEFAULT_REPORT_CONFIG.title, 'Experiment Report');
    assert.strictEqual(DEFAULT_REPORT_CONFIG.documentType, 'experiment');
    assert.ok(DEFAULT_REPORT_CONFIG.includeStatistics);
    assert.ok(DEFAULT_REPORT_CONFIG.includeRawData);
    assert.ok(DEFAULT_REPORT_CONFIG.includeComparisons);
    assert.strictEqual(DEFAULT_REPORT_CONFIG.confidenceLevel, 0.95);
    assert.strictEqual(DEFAULT_REPORT_CONFIG.significanceThreshold, 0.05);
  });
});
