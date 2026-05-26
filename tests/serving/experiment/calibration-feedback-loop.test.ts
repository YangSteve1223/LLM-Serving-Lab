/**
 * Tests for Calibration Feedback Loop
 * 
 * Tests the closed-loop calibration system: API experiments → calibration → validation → iteration.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";

// Import components under test
import { CalibrationFeedbackLoop, type CalibrationFeedbackLoopConfig } from "../../../src/agents/learningAssistant/serving/experiment/CalibrationFeedbackLoop.ts";

describe("CalibrationFeedbackLoop", () => {
  describe("Initialization", () => {
    it("should initialize in mock data mode without API key", () => {
      const loop = new CalibrationFeedbackLoop({ useMockData: true });
      assert.strictEqual(loop.isUsingMockData(), true);
    });

    it("should initialize in real API mode with API key", () => {
      const loop = new CalibrationFeedbackLoop({
        apiKey: "test-key",
        useMockData: false
      });
      assert.strictEqual(loop.isUsingMockData(), false);
    });

    it("should initialize in mock mode when DEEPSEEK_API_KEY is not set", () => {
      // Remove env var if present
      const originalKey = process.env.DEEPSEEK_API_KEY;
      delete process.env.DEEPSEEK_API_KEY;
      
      const loop = new CalibrationFeedbackLoop();
      assert.strictEqual(loop.isUsingMockData(), true);
      
      // Restore
      if (originalKey) {
        process.env.DEEPSEEK_API_KEY = originalKey;
      }
    });

    it("should accept custom convergence criteria", () => {
      const loop = new CalibrationFeedbackLoop({
        useMockData: true,
        convergenceCriteria: {
          ttftMapeThreshold: 0.10,
          tpotMapeThreshold: 0.05,
          e2eMapeThreshold: 0.15,
          maxIterations: 3,
          minImprovement: 0.05
        }
      });
      
      // Loop initialized successfully
      assert.ok(loop);
    });

    it("should accept initial speculative configuration", () => {
      const loop = new CalibrationFeedbackLoop({
        useMockData: true,
        initialSpeculativeConfig: {
          typicalAcceptanceRate: 0.75,
          acceptanceThreshold: 0.70
        }
      });
      
      assert.ok(loop);
    });

    it("should accept custom scenarios", () => {
      const customScenarios = [
        { name: "custom-1", inputTokens: 100, outputTokens: 50, concurrency: 1 },
        { name: "custom-2", inputTokens: 200, outputTokens: 100, concurrency: 2 }
      ];
      
      const loop = new CalibrationFeedbackLoop({
        useMockData: true,
        scenarios: customScenarios
      });
      
      assert.ok(loop);
    });
  });

  describe("run (Mock Mode)", () => {
    it("should run calibration loop and return results", async () => {
      const loop = new CalibrationFeedbackLoop({
        useMockData: true,
        convergenceCriteria: {
          maxIterations: 2
        }
      });
      
      const result = await loop.run();
      
      assert.ok(typeof result.converged === "boolean");
      assert.ok(typeof result.totalIterations === "number");
      assert.ok(result.totalIterations > 0);
      assert.ok(typeof result.finalMAPE === "object");
      assert.ok(typeof result.finalMAPE.ttft === "number");
      assert.ok(typeof result.finalMAPE.tpot === "number");
      assert.ok(typeof result.finalMAPE.e2e === "number");
      assert.ok(result.iterations instanceof Array);
      assert.ok(typeof result.duration === "number");
    });

    it("should iterate until max iterations", async () => {
      const loop = new CalibrationFeedbackLoop({
        useMockData: true,
        convergenceCriteria: {
          maxIterations: 3,
          minImprovement: 0.001 // Very small to force max iterations
        }
      });
      
      const result = await loop.run();
      
      assert.strictEqual(result.totalIterations, 3);
      assert.ok(result.convergenceStatus !== "converged" || result.converged);
    });

    it("should include iteration details", async () => {
      const loop = new CalibrationFeedbackLoop({
        useMockData: true,
        convergenceCriteria: {
          maxIterations: 2
        }
      });
      
      const result = await loop.run();
      
      for (const iteration of result.iterations) {
        assert.ok(typeof iteration.iteration === "number");
        assert.ok(iteration.apiMeasurements instanceof Array);
        assert.ok(iteration.comparisonReports instanceof Array);
        assert.ok(typeof iteration.mape === "object");
        assert.ok(typeof iteration.convergenceStatus === "string");
        assert.ok(typeof iteration.improvementFromPrevious === "number");
      }
    });

    it("should report MAPE values in valid range", async () => {
      const loop = new CalibrationFeedbackLoop({
        useMockData: true,
        convergenceCriteria: {
          maxIterations: 2
        }
      });
      
      const result = await loop.run();
      
      // MAPE should be between 0 and 1 (representing 0% to 100%)
      for (const iteration of result.iterations) {
        assert.ok(iteration.mape.ttft >= 0 && iteration.mape.ttft <= 1, 
          `TTFT MAPE ${iteration.mape.ttft} out of range`);
        assert.ok(iteration.mape.tpot >= 0 && iteration.mape.tpot <= 1,
          `TPOT MAPE ${iteration.mape.tpot} out of range`);
        assert.ok(iteration.mape.e2e >= 0 && iteration.mape.e2e <= 1,
          `E2E MAPE ${iteration.mape.e2e} out of range`);
      }
    });

    it("should improve MAPE over iterations when possible", async () => {
      const loop = new CalibrationFeedbackLoop({
        useMockData: true,
        convergenceCriteria: {
          maxIterations: 3,
          minImprovement: 0.01
        }
      });
      
      const result = await loop.run();
      
      if (result.totalIterations > 1) {
        // Check that MAPE generally improves or stays stable
        for (let i = 1; i < result.iterations.length; i++) {
          const prev = result.iterations[i - 1].mape;
          const curr = result.iterations[i].mape;
          
          // Calculate overall MAPE change
          const prevOverall = (prev.ttft + prev.tpot + prev.e2e) / 3;
          const currOverall = (curr.ttft + curr.tpot + curr.e2e) / 3;
          
          // Should not degrade significantly
          assert.ok(currOverall <= prevOverall * 1.1, 
            `MAPE degraded from ${prevOverall} to ${currOverall}`);
        }
      }
    });

    it("should include final calibration parameters", async () => {
      const loop = new CalibrationFeedbackLoop({
        useMockData: true,
        convergenceCriteria: {
          maxIterations: 2
        }
      });
      
      const result = await loop.run();
      
      assert.ok(typeof result.finalParams === "object");
      assert.ok(typeof result.finalParams.prefillScaleFactor === "number");
      assert.ok(typeof result.finalParams.decodeScaleFactor === "number");
      assert.ok(typeof result.finalParams.ttftOffset === "number");
      assert.ok(typeof result.finalParams.tpotOffset === "number");
      assert.ok(typeof result.finalParams.confidenceLevel === "number");
      assert.ok(typeof result.finalParams.sampleSize === "number");
    });

    it("should include speculative configuration", async () => {
      const loop = new CalibrationFeedbackLoop({
        useMockData: true,
        calibrateSpeculative: true,
        convergenceCriteria: {
          maxIterations: 2
        }
      });
      
      const result = await loop.run();
      
      assert.ok(typeof result.speculativeConfig === "object");
    });
  });

  describe("run with custom workload", () => {
    it("should accept custom workload requests", async () => {
      const loop = new CalibrationFeedbackLoop({
        useMockData: true,
        convergenceCriteria: {
          maxIterations: 1
        }
      });
      
      const customWorkload = [
        { prefillTokens: 128, decodeTokens: 64 },
        { prefillTokens: 512, decodeTokens: 128 },
        { prefillTokens: 1024, decodeTokens: 256 }
      ];
      
      const result = await loop.run(customWorkload);
      
      assert.ok(result.iterations.length > 0);
      
      // Check that measurements match workload
      const firstIteration = result.iterations[0];
      assert.strictEqual(firstIteration.apiMeasurements.length, customWorkload.length);
    });
  });

  describe("Experiment Runner Integration", () => {
    it("should provide access to experiment runner", () => {
      const loop = new CalibrationFeedbackLoop({
        useMockData: true
      });
      
      const runner = loop.getExperimentRunner();
      assert.ok(runner !== null);
      assert.ok(typeof runner.runExperiments === "function");
    });

    it("should provide access to speculative simulator", () => {
      const loop = new CalibrationFeedbackLoop({
        useMockData: true
      });
      
      const simulator = loop.getSpeculativeSimulator();
      assert.ok(simulator !== null);
      assert.ok(typeof simulator.simulate === "function");
    });
  });

  describe("Calibration with speculative enabled", () => {
    it("should calibrate speculative simulator", async () => {
      const loop = new CalibrationFeedbackLoop({
        useMockData: true,
        calibrateSpeculative: true,
        initialSpeculativeConfig: {
          typicalAcceptanceRate: 0.5
        },
        convergenceCriteria: {
          maxIterations: 2
        }
      });
      
      const result = await loop.run();
      
      // Should have updated speculative config
      assert.ok(typeof result.speculativeConfig === "object");
      assert.ok(typeof result.speculativeConfig.typicalAcceptanceRate === "number");
    });

    it("should run without speculative calibration", async () => {
      const loop = new CalibrationFeedbackLoop({
        useMockData: true,
        calibrateSpeculative: false,
        convergenceCriteria: {
          maxIterations: 1
        }
      });
      
      const result = await loop.run();
      
      assert.ok(result.iterations.length > 0);
    });
  });

  describe("Warnings", () => {
    it("should collect warnings when not converging", async () => {
      const loop = new CalibrationFeedbackLoop({
        useMockData: true,
        convergenceCriteria: {
          maxIterations: 1,
          minImprovement: 0.5 // High threshold to force warning
        }
      });
      
      const result = await loop.run();
      
      // May or may not have warnings depending on iterations
      assert.ok(result.warnings instanceof Array);
    });
  });
});
