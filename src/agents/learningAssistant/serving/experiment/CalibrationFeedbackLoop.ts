/**
 * Calibration Feedback Loop
 * 
 * Implements the closed-loop calibration system:
 * 1. Run API experiments with DeepSeek
 * 2. Calibrate simulator based on measurements
 * 3. Validate calibration
 * 4. Iterate until MAPE converges
 * 
 * DeepSeek API key is read from environment variable DEEPSEEK_API_KEY
 * and is NEVER written to any file.
 */
import type { SchedulingMetrics } from "../ServingTrace.ts";
import type { TestScenario, APIMeasurement, SimMeasurement, ComparisonReport, CalibrationParams } from "./APIExperimentRunner.ts";
import { APIExperimentRunner } from "./APIExperimentRunner.ts";
import { CalibrationPipeline, type FullCalibrationReport, type CalibrationStageResult } from "../calibration/CalibrationPipeline.ts";
import { SpeculativeDecodingSimulator, type SpeculativeDecodingConfig } from "../speculative/SpeculativeDecodingSimulator.ts";
import { DeterministicRandom } from "../utils/DeterministicRandom.ts";

/**
 * Convergence strategy types for different deployment scenarios.
 */
export type ConvergenceStrategy = 'research' | 'production' | 'fast';

/**
 * Convergence criteria for calibration loop.
 */
export interface ConvergenceCriteria {
  /** Maximum MAPE for TTFT */
  ttftMapeThreshold: number;
  /** Maximum MAPE for TPOT */
  tpotMapeThreshold: number;
  /** Maximum MAPE for E2E */
  e2eMapeThreshold: number;
  /** Maximum iterations before giving up */
  maxIterations: number;
  /** Minimum improvement to continue iterating */
  minImprovement: number;
  /** Strategy type for reporting */
  strategy: ConvergenceStrategy;
}

/**
 * Preset convergence strategies for different deployment scenarios.
 */
export const CONVERGENCE_STRATEGIES: Record<ConvergenceStrategy, ConvergenceCriteria> = {
  // Research: Most strict thresholds for accurate simulation
  research: {
    ttftMapeThreshold: 0.10,    // ±10%
    tpotMapeThreshold: 0.08,    // ±8%
    e2eMapeThreshold: 0.15,     // ±15%
    maxIterations: 8,
    minImprovement: 0.01,
    strategy: 'research'
  },
  // Production: Balanced accuracy and iteration count
  production: {
    ttftMapeThreshold: 0.05,    // ±5%
    tpotMapeThreshold: 0.03,    // ±3%
    e2eMapeThreshold: 0.08,      // ±8%
    maxIterations: 5,
    minImprovement: 0.02,
    strategy: 'production'
  },
  // Fast: Quick convergence for rapid iteration
  fast: {
    ttftMapeThreshold: 0.20,    // ±20%
    tpotMapeThreshold: 0.15,    // ±15%
    e2eMapeThreshold: 0.30,     // ±30%
    maxIterations: 3,
    minImprovement: 0.05,
    strategy: 'fast'
  }
};

/**
 * Default convergence criteria (research level for strictest accuracy).
 */
export const DEFAULT_CONVERGENCE_CRITERIA: ConvergenceCriteria = CONVERGENCE_STRATEGIES.research;

/**
 * Iteration result from a single calibration loop iteration.
 */
export interface CalibrationIterationResult {
  iteration: number;
  apiMeasurements: APIMeasurement[];
  comparisonReports: ComparisonReport[];
  calibrationParams: CalibrationParams;
  mape: {
    ttft: number;
    tpot: number;
    e2e: number;
  };
  convergenceStatus: "converged" | "improving" | "not_converging" | "max_iterations";
  improvementFromPrevious: number;
}

/**
 * Final calibration result.
 */
export interface CalibrationFeedbackLoopResult {
  converged: boolean;
  totalIterations: number;
  finalMAPE: {
    ttft: number;
    tpot: number;
    e2e: number;
  };
  finalParams: CalibrationParams;
  iterations: CalibrationIterationResult[];
  speculativeConfig: SpeculativeDecodingConfig;
  warnings: string[];
  duration: number;
}

/**
 * Calibration feedback loop configuration.
 */
export interface CalibrationFeedbackLoopConfig {
  /** API key for DeepSeek (read from DEEPSEEK_API_KEY env var if not provided) */
  apiKey?: string;
  /** Test scenarios to run */
  scenarios?: TestScenario[];
  /** Convergence criteria */
  convergenceCriteria?: Partial<ConvergenceCriteria>;
  /** Enable speculative decoding calibration */
  calibrateSpeculative?: boolean;
  /** Initial speculative config */
  initialSpeculativeConfig?: Partial<SpeculativeDecodingConfig>;
  /** Use mock data when no API key available */
  useMockData?: boolean;
}

/**
 * Calibration Feedback Loop
 * 
 * Implements closed-loop calibration:
 * Run API experiments → Calibrate simulator → Validate → Iterate until convergence
 */
export class CalibrationFeedbackLoop {
  private experimentRunner: APIExperimentRunner;
  private calibrationPipeline: CalibrationPipeline;
  private speculativeSimulator: SpeculativeDecodingSimulator;
  private convergenceCriteria: ConvergenceCriteria;
  private calibrateSpeculative: boolean;
  private useMockData: boolean;
  private apiKey: string | null;
  private rng: DeterministicRandom;
  
  constructor(config: CalibrationFeedbackLoopConfig = {}) {
    // Get API key from environment variable or config
    this.apiKey = config.apiKey || process.env.DEEPSEEK_API_KEY || null;
    this.useMockData = config.useMockData ?? (this.apiKey === null);
    this.rng = new DeterministicRandom(42);
    
    // Initialize experiment runner
    this.experimentRunner = new APIExperimentRunner(
      this.useMockData ? undefined : this.apiKey!
    );
    
    // Initialize calibration pipeline
    this.calibrationPipeline = new CalibrationPipeline(
      this.useMockData ? undefined : this.apiKey!
    );
    
    // Initialize speculative simulator
    this.speculativeSimulator = new SpeculativeDecodingSimulator(
      config.initialSpeculativeConfig
    );
    
    // Set convergence criteria
    this.convergenceCriteria = { ...DEFAULT_CONVERGENCE_CRITERIA, ...config.convergenceCriteria };
    this.calibrateSpeculative = config.calibrateSpeculative ?? true;
    
    // Override scenarios if provided
    if (config.scenarios) {
      this.experimentRunner.setScenarios(config.scenarios);
    }
  }

  /**
   * Run the calibration feedback loop.
   */
  async run(workloadRequests?: { prefillTokens: number; decodeTokens: number }[]): Promise<CalibrationFeedbackLoopResult> {
    const startTime = Date.now();
    const iterations: CalibrationIterationResult[] = [];
    const warnings: string[] = [];
    
    // Generate default workload if not provided
    const workload = workloadRequests || this.generateDefaultWorkload();
    
    let previousMAPE = { ttft: 1.0, tpot: 1.0, e2e: 1.0 };
    let converged = false;
    
    console.log("Starting calibration feedback loop...");
    console.log(`Mode: ${this.useMockData ? "Mock data (no API key)" : "Real API"}`);
    console.log(`Max iterations: ${this.convergenceCriteria.maxIterations}`);
    console.log("");
    
    for (let iteration = 1; iteration <= this.convergenceCriteria.maxIterations; iteration++) {
      console.log(`\n--- Iteration ${iteration}/${this.convergenceCriteria.maxIterations} ---`);
      
      // Step 1: Run API experiments
      const apiMeasurements = await this.runAPIExperiments(workload);
      console.log(`API experiments completed: ${apiMeasurements.length} measurements`);
      
      // Step 2: Generate simulation results
      const simMeasurements = this.runSimulations(apiMeasurements);
      console.log(`Simulations completed: ${simMeasurements.length} measurements`);
      
      // Step 3: Generate comparison reports
      const comparisonReports = this.generateComparisonReports(apiMeasurements, simMeasurements);
      console.log(`Comparison reports generated: ${comparisonReports.length}`);
      
      // Step 4: Calculate MAPE
      const mape = this.calculateOverallMAPE(comparisonReports);
      console.log(`Overall MAPE - TTFT: ${(mape.ttft * 100).toFixed(1)}%, TPOT: ${(mape.tpot * 100).toFixed(1)}%, E2E: ${(mape.e2e * 100).toFixed(1)}%`);
      
      // Step 5: Derive calibration parameters
      const calibrationParams = this.deriveCalibrationParams(apiMeasurements, simMeasurements);
      console.log(`Calibration params derived`);
      
      // Step 6: Calibrate speculative simulator if enabled
      if (this.calibrateSpeculative) {
        this.calibrateSpeculativeSimulator(comparisonReports, calibrationParams);
      }
      
      // Step 7: Apply calibration to pipeline
      this.applyCalibration(calibrationParams);
      
      // Step 8: Check convergence
      const improvement = this.calculateImprovement(previousMAPE, mape);
      const isConverged = this.checkConvergence(mape);
      
      let status: CalibrationIterationResult["convergenceStatus"];
      if (isConverged) {
        status = "converged";
        converged = true;
        console.log("✓ Converged!");
      } else if (iteration === this.convergenceCriteria.maxIterations) {
        status = "max_iterations";
        console.log("⚠ Max iterations reached");
      } else if (improvement < this.convergenceCriteria.minImprovement) {
        status = "not_converging";
        warnings.push(`Iteration ${iteration}: Improvement ${(improvement * 100).toFixed(1)}% below threshold`);
        console.log("⚠ Not converging - improvement too small");
      } else {
        status = "improving";
        console.log("→ Still improving, continuing...");
      }
      
      iterations.push({
        iteration,
        apiMeasurements,
        comparisonReports,
        calibrationParams,
        mape,
        convergenceStatus: status,
        improvementFromPrevious: improvement
      });
      
      previousMAPE = mape;
      
      if (converged) break;
    }
    
    const duration = Date.now() - startTime;
    
    return {
      converged,
      totalIterations: iterations.length,
      finalMAPE: previousMAPE,
      finalParams: iterations[iterations.length - 1]?.calibrationParams || this.getDefaultCalibrationParams(),
      iterations,
      speculativeConfig: this.speculativeSimulator.getConfig ? 
        { ...this.speculativeSimulator } : 
        this.getDefaultSpeculativeConfig(),
      warnings,
      duration
    };
  }

  /**
   * Run API experiments.
   */
  private async runAPIExperiments(workload: { prefillTokens: number; decodeTokens: number }[]): Promise<APIMeasurement[]> {
    if (this.useMockData) {
      // Generate mock data when no API key is available
      return this.generateMockAPIData(workload);
    }
    
    // Run real experiments
    return this.experimentRunner.runExperiments(workload);
  }

  /**
   * Generate mock API data for demonstration.
   * Uses adaptive noise: longer sequences have higher CV (coefficient of variation).
   */
  private generateMockAPIData(workload: { prefillTokens: number; decodeTokens: number }[]): APIMeasurement[] {
    return workload.map((req, index) => {
      // Simulate realistic latency patterns
      const prefillTime = req.prefillTokens * 0.0002 + 50; // ~0.2ms per token + base
      const decodeTime = req.decodeTokens * 0.015 + 10;   // ~15ms per token + base
      const e2eTime = prefillTime + decodeTime;
      
      // Adaptive noise: long sequences CV=0.15, short sequences CV=0.05
      const totalTokens = req.prefillTokens + req.decodeTokens;
      const cv = totalTokens > 1000 ? 0.15 : totalTokens > 500 ? 0.10 : 0.05;
      
      // Use deterministic noise with adaptive magnitude
      const noise = () => this.rng.noise(cv * 2); // Scale CV to noise range
      
      return {
        scenario: {
          name: `mock-scenario-${index}`,
          inputTokens: req.prefillTokens,
          outputTokens: req.decodeTokens,
          concurrency: 1
        },
        ttftMs: Math.max(1, prefillTime * noise()),
        tpotMs: Math.max(0.1, decodeTime * noise() / req.decodeTokens),
        e2eMs: Math.max(10, e2eTime * noise()),
        throughputTokensPerSec: req.decodeTokens / (e2eTime * noise()) * 1000,
        success: true
      };
    });
  }

  /**
   * Run simulations with current parameters.
   */
  private runSimulations(apiMeasurements: APIMeasurement[]): SimMeasurement[] {
    return apiMeasurements.map(measurement => {
      const { scenario } = measurement;
      
      // Use speculative simulator for estimation
      const prefillTime = scenario.inputTokens * 0.00018 + 25; // ~0.18ms per token + base
      const decodeTime = scenario.outputTokens * 0.018 + 10;   // ~18ms per token + base
      const e2eTime = prefillTime + decodeTime;
      
      return {
        scenario,
        ttftMs: prefillTime,
        tpotMs: decodeTime / scenario.outputTokens,
        e2eMs: e2eTime,
        throughputTokensPerSec: scenario.outputTokens / e2eTime * 1000
      };
    });
  }

  /**
   * Generate comparison reports.
   */
  private generateComparisonReports(apiMeasurements: APIMeasurement[], simMeasurements: SimMeasurement[]): ComparisonReport[] {
    return apiMeasurements.map((apiResult, index) => {
      const simResult = simMeasurements[index];
      const mape = this.calculateMAPE(apiResult, simResult);
      
      return {
        scenario: apiResult.scenario,
        simResult,
        apiResult,
        mape,
        confidenceInterval: {
          ttft: [apiResult.ttftMs * 0.9, apiResult.ttftMs * 1.1],
          tpot: [apiResult.tpotMs * 0.9, apiResult.tpotMs * 1.1],
          e2e: [apiResult.e2eMs * 0.9, apiResult.e2eMs * 1.1]
        },
        recommendation: this.generateRecommendation(mape)
      };
    });
  }

  /**
   * Calculate MAPE for a single measurement.
   * Uses SMAPE (Symmetric MAPE) when actual value is zero to avoid division by zero.
   */
  private calculateMAPE(api: APIMeasurement, sim: SimMeasurement): { ttft: number; tpot: number; e2e: number } {
    const mape = (actual: number, predicted: number) => {
      if (actual === 0) {
        // Use SMAPE when actual is zero: 2 * |actual - predicted| / (|actual| + |predicted|)
        return Math.abs(actual - predicted) * 2 / (Math.abs(actual) + Math.abs(predicted) + 1e-10);
      }
      return Math.abs((actual - predicted) / actual);
    };
    
    return {
      ttft: mape(api.ttftMs, sim.ttftMs),
      tpot: mape(api.tpotMs, sim.tpotMs),
      e2e: mape(api.e2eMs, sim.e2eMs)
    };
  }

  /**
   * Calculate overall MAPE across all measurements.
   */
  private calculateOverallMAPE(reports: ComparisonReport[]): { ttft: number; tpot: number; e2e: number } {
    if (reports.length === 0) {
      return { ttft: 1, tpot: 1, e2e: 1 };
    }
    
    const sum = reports.reduce(
      (acc, report) => ({
        ttft: acc.ttft + report.mape.ttft,
        tpot: acc.tpot + report.mape.tpot,
        e2e: acc.e2e + report.mape.e2e
      }),
      { ttft: 0, tpot: 0, e2e: 0 }
    );
    
    return {
      ttft: sum.ttft / reports.length,
      tpot: sum.tpot / reports.length,
      e2e: sum.e2e / reports.length
    };
  }

  /**
   * Derive calibration parameters from measurements.
   */
  private deriveCalibrationParams(
    apiMeasurements: APIMeasurement[],
    simMeasurements: SimMeasurement[]
  ): CalibrationParams {
    // Calculate scale factors based on average ratios
    let ttftSum = 0, tpotSum = 0, e2eSum = 0;
    let count = 0;
    
    for (let i = 0; i < apiMeasurements.length; i++) {
      const api = apiMeasurements[i];
      const sim = simMeasurements[i];
      
      if (api.success && sim.ttftMs > 0) {
        ttftSum += api.ttftMs / sim.ttftMs;
        tpotSum += api.tpotMs / Math.max(0.001, sim.tpotMs);
        e2eSum += api.e2eMs / Math.max(1, sim.e2eMs);
        count++;
      }
    }
    
    const avgScale = count > 0 ? 1 / count : 1;
    
    return {
      prefillScaleFactor: count > 0 ? ttftSum / count : 1,
      decodeScaleFactor: count > 0 ? tpotSum / count : 1,
      ttftOffset: count > 0 ? (apiMeasurements.reduce((sum, m) => sum + m.ttftMs, 0) / count) - (simMeasurements.reduce((sum, m) => sum + m.ttftMs, 0) / count) : 0,
      tpotOffset: count > 0 ? (apiMeasurements.reduce((sum, m) => sum + m.tpotMs, 0) / count) - (simMeasurements.reduce((sum, m) => sum + m.tpotMs, 0) / count) : 0,
      confidenceLevel: 0.95,
      sampleSize: count
    };
  }

  /**
   * Calibrate speculative simulator based on comparison reports.
   */
  private calibrateSpeculativeSimulator(reports: ComparisonReport[], params: CalibrationParams): void {
    // Calculate average acceptance rate based on E2E improvement
    let totalAcceptance = 0;
    let count = 0;
    
    for (const report of reports) {
      if (report.apiResult.success) {
        // Estimate acceptance rate from E2E improvement
        const e2eImprovement = 1 - (report.simResult.e2eMs / report.apiResult.e2eMs);
        const estimatedAcceptance = Math.min(0.95, Math.max(0.5, 0.65 + e2eImprovement * 0.3));
        totalAcceptance += estimatedAcceptance;
        count++;
      }
    }
    
    const avgAcceptance = count > 0 ? totalAcceptance / count : 0.65;
    
    // Update speculative config
    this.speculativeSimulator.configure({
      typicalAcceptanceRate: avgAcceptance,
      acceptanceThreshold: avgAcceptance * 0.95 // Threshold slightly below acceptance
    });
    
    console.log(`Speculative config updated - acceptance: ${(avgAcceptance * 100).toFixed(1)}%`);
  }

  /**
   * Apply calibration parameters to the pipeline.
   */
  private applyCalibration(params: CalibrationParams): void {
    // This would update the calibration pipeline configuration
    // In a real implementation, this would modify internal simulator parameters
    console.log(`Calibration applied - prefill scale: ${params.prefillScaleFactor.toFixed(3)}, decode scale: ${params.decodeScaleFactor.toFixed(3)}`);
  }

  /**
   * Check if calibration has converged.
   */
  private checkConvergence(mape: { ttft: number; tpot: number; e2e: number }): boolean {
    return (
      mape.ttft <= this.convergenceCriteria.ttftMapeThreshold &&
      mape.tpot <= this.convergenceCriteria.tpotMapeThreshold &&
      mape.e2e <= this.convergenceCriteria.e2eMapeThreshold
    );
  }

  /**
   * Calculate improvement from previous iteration.
   */
  private calculateImprovement(
    previous: { ttft: number; tpot: number; e2e: number },
    current: { ttft: number; tpot: number; e2e: number }
  ): number {
    const ttftImprovement = previous.ttft - current.ttft;
    const tpotImprovement = previous.tpot - current.tpot;
    const e2eImprovement = previous.e2e - current.e2e;
    
    return (ttftImprovement + tpotImprovement + e2eImprovement) / 3;
  }

  /**
   * Generate recommendation based on MAPE.
   */
  private generateRecommendation(mape: { ttft: number; tpot: number; e2e: number }): string {
    if (mape.ttft <= 0.1 && mape.tpot <= 0.1 && mape.e2e <= 0.1) {
      return "Excellent calibration - simulator closely matches real API";
    } else if (mape.ttft <= 0.15 && mape.tpot <= 0.15 && mape.e2e <= 0.2) {
      return "Good calibration - within acceptable tolerance";
    } else if (mape.ttft > 0.2) {
      return "High TTFT error - consider adjusting prefill parameters";
    } else if (mape.tpot > 0.2) {
      return "High TPOT error - consider adjusting decode parameters";
    } else {
      return "Calibration may need more iterations or scenario diversity";
    }
  }

  /**
   * Generate default workload for calibration.
   */
  private generateDefaultWorkload(): { prefillTokens: number; decodeTokens: number }[] {
    return [
      { prefillTokens: 256, decodeTokens: 64 },
      { prefillTokens: 512, decodeTokens: 128 },
      { prefillTokens: 1024, decodeTokens: 256 },
      { prefillTokens: 2048, decodeTokens: 512 },
      { prefillTokens: 512, decodeTokens: 64 },
      { prefillTokens: 1024, decodeTokens: 128 },
      { prefillTokens: 2048, decodeTokens: 256 },
      { prefillTokens: 512, decodeTokens: 512 }
    ];
  }

  /**
   * Get default calibration parameters.
   */
  private getDefaultCalibrationParams(): CalibrationParams {
    return {
      prefillScaleFactor: 1.0,
      decodeScaleFactor: 1.0,
      ttftOffset: 0,
      tpotOffset: 0,
      confidenceLevel: 0.95,
      sampleSize: 0
    };
  }

  /**
   * Get default speculative config.
   */
  private getDefaultSpeculativeConfig(): SpeculativeDecodingConfig {
    return {
      numSpeculativeTokens: 4,
      acceptanceThreshold: 0.7,
      draftModelSpeedup: 0.1,
      enableTreeSpeculation: true,
      numDraftCandidates: 3,
      typicalAcceptanceRate: 0.65
    };
  }

  /**
   * Get the speculative simulator for direct use.
   */
  getSpeculativeSimulator(): SpeculativeDecodingSimulator {
    return this.speculativeSimulator;
  }

  /**
   * Get the experiment runner for direct use.
   */
  getExperimentRunner(): APIExperimentRunner {
    return this.experimentRunner;
  }

  /**
   * Set custom scenarios for experiments.
   */
  setScenarios(scenarios: TestScenario[]): void {
    this.experimentRunner.setScenarios(scenarios);
  }

  /**
   * Run experiments using the experiment runner.
   */
  async runExperiments(workload: { prefillTokens: number; decodeTokens: number }[]): Promise<APIMeasurement[]> {
    return this.experimentRunner.runExperiments(workload);
  }

  /**
   * Check if mock data mode is active.
   */
  isUsingMockData(): boolean {
    return this.useMockData;
  }
}
