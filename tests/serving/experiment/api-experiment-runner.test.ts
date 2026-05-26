/**
 * Tests for API Experiment Runner
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  APIExperimentRunner,
  STANDARD_SCENARIOS,
  type TestScenario,
  type CalibrationParams
} from '../../../src/agents/learningAssistant/serving/experiment/APIExperimentRunner.ts';

describe('APIExperimentRunner', () => {
  const runner = new APIExperimentRunner();

  describe('constructor', () => {
    it('should create instance without API key', () => {
      const newRunner = new APIExperimentRunner();
      assert.ok(newRunner);
    });
  });

  describe('hasAPIKey', () => {
    it('should return false when no API key is set', () => {
      // In test environment, no key should be set
      assert.strictEqual(runner.hasAPIKey(), false);
    });
  });

  describe('runSimulation', () => {
    it('should run simulation for short input scenario', () => {
      const scenario = STANDARD_SCENARIOS[0];
      
      const result = runner.runSimulation(scenario);

      assert.ok(result);
      assert.deepStrictEqual(result.scenario, scenario);
      assert.ok(result.ttftMs > 0);
      assert.ok(result.tpotMs > 0);
      assert.ok(result.e2eMs > 0);
    });

    it('should run simulation for medium input scenario', () => {
      const scenario = STANDARD_SCENARIOS[2];
      
      const result = runner.runSimulation(scenario);

      // TTFT should scale with input tokens
      assert.ok(result.ttftMs >= scenario.inputTokens * 0.1);
    });

    it('should run simulation for long input scenario', () => {
      const scenario = STANDARD_SCENARIOS[4];
      
      const result = runner.runSimulation(scenario);

      // TTFT should scale with input tokens
      assert.ok(result.ttftMs >= scenario.inputTokens * 0.1);
    });

    it('should calculate throughput correctly', () => {
      const scenario: TestScenario = {
        name: 'test-throughput',
        inputTokens: 100,
        outputTokens: 50,
        concurrency: 1
      };

      const result = runner.runSimulation(scenario);

      assert.ok(result.throughputTokensPerSec > 0);
    });
  });

  describe('runScenario', () => {
    it('should return error result when no API key available', async () => {
      const scenario: TestScenario = {
        name: 'test-no-key',
        inputTokens: 128,
        outputTokens: 64,
        concurrency: 1
      };

      const result = await runner.runScenario(scenario);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('API key not available'));
    });
  });

  describe('calibrateFromAPI', () => {
    it('should return default calibration with no measurements', () => {
      const params = runner.calibrateFromAPI([]);

      assert.strictEqual(params.prefillScaleFactor, 1.0);
      assert.strictEqual(params.decodeScaleFactor, 1.0);
      assert.strictEqual(params.ttftOffset, 0);
      assert.strictEqual(params.tpotOffset, 0);
      assert.strictEqual(params.sampleSize, 0);
    });

    it('should calculate scale factors from successful measurements', () => {
      const measurements = [
        {
          scenario: STANDARD_SCENARIOS[0],
          ttftMs: 50,
          tpotMs: 10,
          e2eMs: 500,
          throughputTokensPerSec: 100,
          success: true
        },
        {
          scenario: STANDARD_SCENARIOS[0],
          ttftMs: 55,
          tpotMs: 11,
          e2eMs: 520,
          throughputTokensPerSec: 95,
          success: true
        }
      ];

      const params = runner.calibrateFromAPI(measurements);

      assert.strictEqual(params.sampleSize, 2);
      assert.ok(params.prefillScaleFactor > 0);
      assert.ok(params.decodeScaleFactor > 0);
    });

    it('should skip failed measurements', () => {
      const measurements = [
        {
          scenario: STANDARD_SCENARIOS[0],
          ttftMs: 50,
          tpotMs: 10,
          e2eMs: 500,
          throughputTokensPerSec: 100,
          success: true
        },
        {
          scenario: STANDARD_SCENARIOS[0],
          ttftMs: 0,
          tpotMs: 0,
          e2eMs: 0,
          throughputTokensPerSec: 0,
          success: false,
          error: 'Network error'
        }
      ];

      const params = runner.calibrateFromAPI(measurements);

      assert.strictEqual(params.sampleSize, 1);
    });
  });

  describe('compareSimVsReal', () => {
    it('should compare successful measurements', () => {
      const simResult = runner.runSimulation(STANDARD_SCENARIOS[0]);
      const apiResult = {
        scenario: STANDARD_SCENARIOS[0],
        ttftMs: 48,
        tpotMs: 9.5,
        e2eMs: 480,
        throughputTokensPerSec: 110,
        success: true
      };

      const report = runner.compareSimVsReal(simResult, apiResult);

      assert.ok(report);
      assert.ok(report.mape);
      assert.ok(report.mape.ttft >= 0);
      assert.ok(report.mape.tpot >= 0);
      assert.ok(report.mape.e2e >= 0);
    });

    it('should handle failed API results', () => {
      const simResult = runner.runSimulation(STANDARD_SCENARIOS[0]);
      const apiResult = {
        scenario: STANDARD_SCENARIOS[0],
        ttftMs: 0,
        tpotMs: 0,
        e2eMs: 0,
        throughputTokensPerSec: 0,
        success: false,
        error: 'Timeout'
      };

      const report = runner.compareSimVsReal(simResult, apiResult);

      assert.strictEqual(report.mape.ttft, 0);
      assert.ok(report.recommendation.includes('Cannot compare'));
    });

    it('should calculate MAPE correctly', () => {
      const simResult = {
        scenario: STANDARD_SCENARIOS[0],
        ttftMs: 50,
        tpotMs: 10,
        e2eMs: 500,
        throughputTokensPerSec: 100
      };
      const apiResult = {
        scenario: STANDARD_SCENARIOS[0],
        ttftMs: 55,
        tpotMs: 11,
        e2eMs: 550,
        throughputTokensPerSec: 95,
        success: true
      };

      const report = runner.compareSimVsReal(simResult, apiResult);

      assert.ok(report.mape.ttft > 0);
      assert.ok(report.mape.tpot > 0);
    });
  });
});
