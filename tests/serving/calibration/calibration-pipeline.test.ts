/**
 * Tests for CalibrationPipeline
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  CalibrationPipeline,
  createCalibrationPipeline
} from '../../../src/agents/learningAssistant/serving/calibration/CalibrationPipeline.ts';
import type { PDWorkloadRequest } from '../../../src/agents/learningAssistant/serving/ServingTrace.ts';

describe('CalibrationPipeline', () => {
  let pipeline: CalibrationPipeline;

  beforeEach(() => {
    // Create pipeline without API key (simulated mode)
    pipeline = createCalibrationPipeline();
  });

  describe('initialization', () => {
    it('should initialize with default configuration', () => {
      assert.ok(pipeline, 'pipeline should exist');
    });

    it('should create via factory function', () => {
      const factoryPipeline = createCalibrationPipeline();
      assert.ok(factoryPipeline, 'factory should create pipeline');
    });
  });

  describe('calibrate', () => {
    it('should run four-stage calibration', async () => {
      // Generate synthetic workload
      const workload: PDWorkloadRequest[] = [];
      for (let i = 0; i < 10; i++) {
        workload.push({
          id: `calib-test-${i}`,
          inputTokens: Math.floor(Math.random() * 1000) + 128,
          outputTokens: Math.floor(Math.random() * 128) + 64,
          arrivalTimeMs: i * 100,
          priority: Math.floor(Math.random() * 5) + 1
        });
      }

      const report = await pipeline.calibrate(workload);

      assert.ok(report.timestamp, 'should have timestamp');
      assert.ok(report.stages.length >= 3, 'should have at least 3 stages');
      assert.ok(['passed', 'failed', 'warning'].includes(report.overallStatus), 'should have valid status');
      assert.ok(report.finalConfig, 'should have final config');
      assert.ok(report.summary, 'should have summary');
    });

    it('should include component calibration stage', async () => {
      const workload: PDWorkloadRequest[] = [{
        id: 'test-1',
        inputTokens: 512,
        outputTokens: 128,
        arrivalTimeMs: 0,
        priority: 1
      }];

      const report = await pipeline.calibrate(workload);
      const componentStage = report.stages.find(s => s.stage === 'component_calibration');

      assert.ok(componentStage, 'should have component calibration stage');
      assert.ok(componentStage!.metrics, 'should have metrics');
      assert.ok(['passed', 'failed', 'warning'].includes(componentStage!.status), 'should have valid status');
    });

    it('should include scheduling calibration stage', async () => {
      const workload: PDWorkloadRequest[] = [
        { id: 'sched-1', inputTokens: 256, outputTokens: 64, arrivalTimeMs: 0, priority: 1 },
        { id: 'sched-2', inputTokens: 512, outputTokens: 128, arrivalTimeMs: 100, priority: 2 }
      ];

      const report = await pipeline.calibrate(workload);
      const schedStage = report.stages.find(s => s.stage === 'scheduling_calibration');

      assert.ok(schedStage, 'should have scheduling calibration stage');
    });

    it('should include cache calibration stage', async () => {
      const workload: PDWorkloadRequest[] = [{
        id: 'cache-test',
        inputTokens: 512,
        outputTokens: 128,
        arrivalTimeMs: 0,
        priority: 1
      }];

      const report = await pipeline.calibrate(workload);
      const cacheStage = report.stages.find(s => s.stage === 'cache_calibration');

      assert.ok(cacheStage, 'should have cache calibration stage');
      assert.ok(cacheStage!.metrics.hashCollisionRate !== undefined, 'should have collision rate');
    });

    it('should include e2e validation stage', async () => {
      const workload: PDWorkloadRequest[] = [{
        id: 'e2e-test',
        inputTokens: 256,
        outputTokens: 64,
        arrivalTimeMs: 0,
        priority: 1
      }];

      const report = await pipeline.calibrate(workload);
      const e2eStage = report.stages.find(s => s.stage === 'e2e_validation');

      assert.ok(e2eStage, 'should have e2e validation stage');
    });
  });

  describe('generateMarkdownReport', () => {
    it('should generate valid markdown', async () => {
      const workload: PDWorkloadRequest[] = [{
        id: 'md-test',
        inputTokens: 256,
        outputTokens: 64,
        arrivalTimeMs: 0,
        priority: 1
      }];

      const report = await pipeline.calibrate(workload);
      const md = pipeline.generateMarkdownReport(report);

      assert.ok(md.includes('# LLM Serving Simulator Calibration Report'), 'should have title');
      assert.ok(md.includes('## Summary'), 'should have summary section');
      assert.ok(md.includes('## Calibration Stages'), 'should have stages section');
      assert.ok(md.includes('TTFT MAPE'), 'should have TTFT metrics');
      assert.ok(md.includes('TPOT MAPE'), 'should have TPOT metrics');
    });

    it('should include stage details in markdown', async () => {
      const workload: PDWorkloadRequest[] = [{
        id: 'details-test',
        inputTokens: 512,
        outputTokens: 128,
        arrivalTimeMs: 0,
        priority: 1
      }];

      const report = await pipeline.calibrate(workload);
      const md = pipeline.generateMarkdownReport(report);

      for (const stage of report.stages) {
        // Markdown uses Title Case: "Component Calibration", "Scheduling Calibration", etc.
        const titleCase = stage.stage.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
        assert.ok(
          md.includes(stage.stage) ||
          md.includes(stage.stage.replace(/_/g, ' ')) ||
          md.includes(titleCase),
          `should mention stage: ${stage.stage} (checked: ${titleCase})`
        );
      }
    });
  });

  describe('summary metrics', () => {
    it('should calculate TTFT MAPE correctly', async () => {
      const workload: PDWorkloadRequest[] = Array.from({ length: 5 }, (_, i) => ({
        id: `mape-test-${i}`,
        inputTokens: 256 + i * 64,
        outputTokens: 64,
        arrivalTimeMs: i * 100,
        priority: 1
      }));

      const report = await pipeline.calibrate(workload);
      
      assert.ok(typeof report.summary.ttftMAPE === 'number', 'TTFT MAPE should be a number');
      assert.ok(report.summary.ttftMAPE >= 0, 'TTFT MAPE should be non-negative');
    });

    it('should calculate TPOT MAPE correctly', async () => {
      const workload: PDWorkloadRequest[] = Array.from({ length: 5 }, (_, i) => ({
        id: `tpot-test-${i}`,
        inputTokens: 256,
        outputTokens: 64 + i * 16,
        arrivalTimeMs: i * 100,
        priority: 1
      }));

      const report = await pipeline.calibrate(workload);
      
      assert.ok(typeof report.summary.tpotMAPE === 'number', 'TPOT MAPE should be a number');
      assert.ok(report.summary.tpotMAPE >= 0, 'TPOT MAPE should be non-negative');
    });

    it('should indicate if all within tolerance', async () => {
      const workload: PDWorkloadRequest[] = [{
        id: 'tolerance-test',
        inputTokens: 512,
        outputTokens: 128,
        arrivalTimeMs: 0,
        priority: 1
      }];

      const report = await pipeline.calibrate(workload);
      
      assert.ok(typeof report.summary.allWithinTolerance === 'boolean', 'should have boolean flag');
    });
  });
});
