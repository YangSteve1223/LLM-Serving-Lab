/**
 * SimulationValidator - Validates simulator predictions against real API measurements.
 * 
 * This module provides comprehensive validation of the PD serving simulator
 * by comparing its predictions with actual DeepSeek API performance.
 * 
 * Features:
 * - Multiple prompt length testing
 * - MAPE/SMAPE/MAE calculation
 * - Automatic calibration parameter generation
 * - Detailed comparison reports
 * - Convergence checking
 */
import { DeepSeekAdapter } from "./DeepSeekAdapter.ts";
import { EnhancedPDServingSimulator } from "../EnhancedPDServingSimulator.ts";
import type {
  RealEngineMetrics,
  MetricsStatistics,
  ValidationConfig,
  DEFAULT_VALIDATION_CONFIG
} from "./RealEngineAdapter.ts";
import {
  generateTestPrompt,
  calculateStatistics,
  calculateMAPE,
  calculateSMAPE,
  calculateMAE
} from "./RealEngineAdapter.ts";
import type { CalibrationParams } from "../experiment/APIExperimentRunner.ts";

/**
 * Validation result for a single test configuration.
 */
export interface ValidationResult {
  /** Test configuration identifier */
  configId: string;
  /** Input token count */
  inputTokens: number;
  /** Output token count */
  outputTokens: number;
  /** Real API measurements */
  realMetrics: RealEngineMetrics[];
  /** Real API statistics */
  realStats: {
    ttft: MetricsStatistics;
    tpot: MetricsStatistics;
    e2e: MetricsStatistics;
    throughput: MetricsStatistics;
  };
  /** Simulator predictions */
  simulatorMetrics: {
    ttftMs: number;
    tpotMs: number;
    e2eMs: number;
    throughputTps: number;
  };
  /** Prediction errors */
  errors: {
    ttftMAPE: number;
    tpotMAPE: number;
    e2eMAPE: number;
    ttftSMAPE: number;
    tpotSMAPE: number;
    e2eSMAPE: number;
    ttftMAE: number;
    tpotMAE: number;
    e2eMAE: number;
  };
  /** Whether the prediction is within tolerance */
  withinTolerance: boolean;
  /** Tolerance used for validation */
  tolerance: {
    ttft: number;
    tpot: number;
    e2e: number;
  };
}

/**
 * Complete validation report.
 */
export interface ValidationReport {
  /** Report generation timestamp */
  generatedAt: string;
  /** Test configuration */
  config: ValidationConfig;
  /** Individual test results */
  results: ValidationResult[];
  /** Overall MAPE statistics */
  overallMAPE: {
    ttft: number;
    tpot: number;
    e2e: number;
  };
  overallSMAPE: {
    ttft: number;
    tpot: number;
    e2e: number;
  };
  /** Calibration parameters to adjust simulator */
  calibrationParams: CalibrationParams;
  /** All results within tolerance */
  converged: boolean;
  /** Summary statistics */
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    passRate: number;
  };
  /** Recommendations for improving simulator accuracy */
  recommendations: string[];
}

/**
 * Simulator calibration parameters.
 */
export interface SimulatorCalibrationParams {
  /** Scale factor for prefill time */
  prefillScaleFactor: number;
  /** Scale factor for decode time */
  decodeScaleFactor: number;
  /** Offset for TTFT */
  ttftOffset: number;
  /** Offset for TPOT */
  tpotOffset: number;
  /** Scale factor for KV transfer */
  kvScaleFactor: number;
  /** Recommended config updates */
  configUpdates: Partial<{
    prefillBaseMs: number;
    prefillMsPerToken: number;
    decodeBaseMs: number;
    decodeMsPerToken: number;
    kvBaseMs: number;
    kvMsPerToken: number;
  }>;
}

/**
 * Default validation tolerances (MAPE percentage).
 */
const DEFAULT_TOLERANCES = {
  ttft: 15,   // ±15%
  tpot: 10,   // ±10%
  e2e: 15     // ±15%
};

/**
 * SimulationValidator - Validates and calibrates the PD serving simulator.
 */
export class SimulationValidator {
  private adapter: DeepSeekAdapter;
  private simulator: EnhancedPDServingSimulator;
  private config: ValidationConfig;
  private tolerances: { ttft: number; tpot: number; e2e: number };
  
  constructor(
    adapter: DeepSeekAdapter,
    simulator?: EnhancedPDServingSimulator,
    config?: Partial<ValidationConfig>,
    tolerances?: Partial<{ ttft: number; tpot: number; e2e: number }>
  ) {
    this.adapter = adapter;
    this.simulator = simulator ?? new EnhancedPDServingSimulator();
    this.config = {
      promptLengths: config?.promptLengths ?? [128, 512, 1024, 2048, 4096],
      outputTokens: config?.outputTokens ?? 128,
      repetitions: config?.repetitions ?? 3,
      delayBetweenRequests: config?.delayBetweenRequests ?? 1000,
      maxRetries: config?.maxRetries ?? 3,
      baseRetryDelayMs: config?.baseRetryDelayMs ?? 1000
    };
    this.tolerances = {
      ttft: tolerances?.ttft ?? DEFAULT_TOLERANCES.ttft,
      tpot: tolerances?.tpot ?? DEFAULT_TOLERANCES.tpot,
      e2e: tolerances?.e2e ?? DEFAULT_TOLERANCES.e2e
    };
  }
  
  /**
   * Check if adapter is available.
   */
  isAdapterAvailable(): boolean {
    return this.adapter.isAvailable();
  }
  
  /**
   * Get simulator prediction for given token counts.
   */
  getSimulatorPrediction(inputTokens: number, outputTokens: number): {
    ttftMs: number;
    tpotMs: number;
    e2eMs: number;
    throughputTps: number;
  } {
    // Use the simulator to predict latency
    // Prefill time: base + per-token cost
    const prefillBaseMs = this.simulator['config']?.prefillBaseMs ?? 25;
    const prefillMsPerToken = this.simulator['config']?.prefillMsPerToken ?? 0.18;
    const prefillComputeMs = prefillBaseMs + inputTokens * prefillMsPerToken;
    
    // KV transfer time
    const kvTransferResult = this.simulator.calculateKVTransferTime(inputTokens);
    
    // Decode time
    const decodeBaseMs = this.simulator['config']?.decodeBaseMs ?? 10;
    const decodeMsPerToken = this.simulator['config']?.decodeMsPerToken ?? 18;
    const decodeMs = decodeBaseMs + outputTokens * decodeMsPerToken;
    
    // TTFT = prefill compute + KV transfer overhead
    const ttftMs = prefillComputeMs + kvTransferResult.effectiveTTFTOverhead;
    
    // E2E = TTFT + decode time
    const e2eMs = ttftMs + decodeMs;
    
    // TPOT (Time Per Output Token)
    const tpotMs = decodeMs / outputTokens;
    
    // Throughput
    const throughputTps = outputTokens / (e2eMs / 1000);
    
    return {
      ttftMs,
      tpotMs,
      e2eMs,
      throughputTps
    };
  }
  
  /**
   * Run validation for a single prompt length.
   */
  async validateSingleConfig(inputTokens: number): Promise<ValidationResult> {
    const outputTokens = this.config.outputTokens;
    const configId = `tokens-${inputTokens}-${outputTokens}`;
    
    console.log(`\nValidating configuration: ${configId}`);
    console.log(`  Input tokens: ${inputTokens}`);
    console.log(`  Output tokens: ${outputTokens}`);
    
    // Generate test prompt
    const prompt = generateTestPrompt(inputTokens);
    
    // Run real API measurements
    console.log("  Running real API measurements...");
    const { metrics, statistics } = await this.adapter.runMeasurements(
      prompt,
      outputTokens,
      this.config.repetitions,
      this.config.delayBetweenRequests
    );
    
    // Get simulator prediction
    const simulatorMetrics = this.getSimulatorPrediction(inputTokens, outputTokens);
    console.log("  Simulator prediction:", simulatorMetrics);
    
    // Calculate errors
    const realTTFT = metrics.map(m => m.ttftMs);
    const realTPOT = metrics.map(m => m.tpotMs);
    const realE2E = metrics.map(m => m.e2eMs);
    
    const predTTFT = Array(metrics.length).fill(simulatorMetrics.ttftMs);
    const predTPOT = Array(metrics.length).fill(simulatorMetrics.tpotMs);
    const predE2E = Array(metrics.length).fill(simulatorMetrics.e2eMs);
    
    const errors = {
      ttftMAPE: calculateMAPE(realTTFT, predTTFT),
      tpotMAPE: calculateMAPE(realTPOT, predTPOT),
      e2eMAPE: calculateMAPE(realE2E, predE2E),
      ttftSMAPE: calculateSMAPE(realTTFT, predTTFT),
      tpotSMAPE: calculateSMAPE(realTPOT, predTPOT),
      e2eSMAPE: calculateSMAPE(realE2E, predE2E),
      ttftMAE: calculateMAE(realTTFT, predTTFT),
      tpotMAE: calculateMAE(realTPOT, predTPOT),
      e2eMAE: calculateMAE(realE2E, predE2E)
    };
    
    // Check if within tolerance
    const withinTolerance =
      errors.ttftMAPE <= this.tolerances.ttft &&
      errors.tpotMAPE <= this.tolerances.tpot &&
      errors.e2eMAPE <= this.tolerances.e2e;
    
    console.log("  Errors:");
    console.log(`    TTFT MAPE: ${errors.ttftMAPE.toFixed(2)}% (tolerance: ${this.tolerances.ttft}%)`);
    console.log(`    TPOT MAPE: ${errors.tpotMAPE.toFixed(2)}% (tolerance: ${this.tolerances.tpot}%)`);
    console.log(`    E2E MAPE: ${errors.e2eMAPE.toFixed(2)}% (tolerance: ${this.tolerances.e2e}%)`);
    
    return {
      configId,
      inputTokens,
      outputTokens,
      realMetrics: metrics,
      realStats: statistics,
      simulatorMetrics,
      errors,
      withinTolerance,
      tolerance: this.tolerances
    };
  }
  
  /**
   * Run complete validation across all prompt lengths.
   */
  async runValidation(): Promise<ValidationReport> {
    console.log("=" .repeat(60));
    console.log("Starting Simulation Validation");
    console.log("=" .repeat(60));
    console.log(`Configuration:`);
    console.log(`  Prompt lengths: ${this.config.promptLengths.join(", ")}`);
    console.log(`  Output tokens: ${this.config.outputTokens}`);
    console.log(`  Repetitions: ${this.config.repetitions}`);
    console.log(`  Tolerances: TTFT=${this.tolerances.ttft}%, TPOT=${this.tolerances.tpot}%, E2E=${this.tolerances.e2e}%`);
    
    if (!this.isAdapterAvailable()) {
      console.warn("Warning: DeepSeek adapter not available. Using fallback/mock data.");
    }
    
    const results: ValidationResult[] = [];
    
    for (const inputTokens of this.config.promptLengths) {
      const result = await this.validateSingleConfig(inputTokens);
      results.push(result);
      
      // Delay between different prompt lengths
      if (this.config.delayBetweenRequests > 0) {
        await new Promise(resolve => setTimeout(resolve, this.config.delayBetweenRequests));
      }
    }
    
    // Calculate overall statistics
    const overallMAPE = {
      ttft: results.reduce((sum, r) => sum + r.errors.ttftMAPE, 0) / results.length,
      tpot: results.reduce((sum, r) => sum + r.errors.tpotMAPE, 0) / results.length,
      e2e: results.reduce((sum, r) => sum + r.errors.e2eMAPE, 0) / results.length
    };
    
    const overallSMAPE = {
      ttft: results.reduce((sum, r) => sum + r.errors.ttftSMAPE, 0) / results.length,
      tpot: results.reduce((sum, r) => sum + r.errors.tpotSMAPE, 0) / results.length,
      e2e: results.reduce((sum, r) => sum + r.errors.e2eSMAPE, 0) / results.length
    };
    
    const passedTests = results.filter(r => r.withinTolerance).length;
    const failedTests = results.filter(r => !r.withinTolerance).length;
    
    // Generate calibration parameters
    const calibrationParams = this.generateCalibrationParams(results);
    
    // Check convergence
    const converged =
      overallMAPE.ttft <= this.tolerances.ttft &&
      overallMAPE.tpot <= this.tolerances.tpot &&
      overallMAPE.e2e <= this.tolerances.e2e;
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(results, overallMAPE);
    
    console.log("\n" + "=".repeat(60));
    console.log("Validation Complete");
    console.log("=".repeat(60));
    console.log(`Overall MAPE:`);
    console.log(`  TTFT: ${overallMAPE.ttft.toFixed(2)}%`);
    console.log(`  TPOT: ${overallMAPE.tpot.toFixed(2)}%`);
    console.log(`  E2E: ${overallMAPE.e2e.toFixed(2)}%`);
    console.log(`Passed: ${passedTests}/${results.length} tests`);
    console.log(`Converged: ${converged ? "YES" : "NO"}`);
    
    return {
      generatedAt: new Date().toISOString(),
      config: this.config,
      results,
      overallMAPE,
      overallSMAPE,
      calibrationParams,
      converged,
      summary: {
        totalTests: results.length,
        passedTests,
        failedTests,
        passRate: results.length > 0 ? (passedTests / results.length) * 100 : 0
      },
      recommendations
    };
  }
  
  /**
   * Generate calibration parameters based on validation results.
   */
  private generateCalibrationParams(results: ValidationResult[]): CalibrationParams {
    // Calculate scale factors based on real vs predicted ratios
    let totalTTFTScale = 0;
    let totalTPOTScale = 0;
    let totalE2EScale = 0;
    let count = 0;
    
    for (const result of results) {
      if (result.realStats.ttft.mean > 0) {
        totalTTFTScale += result.realStats.ttft.mean / result.simulatorMetrics.ttftMs;
      }
      if (result.realStats.tpot.mean > 0) {
        totalTPOTScale += result.realStats.tpot.mean / result.simulatorMetrics.tpotMs;
      }
      if (result.realStats.e2e.mean > 0) {
        totalE2EScale += result.realStats.e2e.mean / result.simulatorMetrics.e2eMs;
      }
      count++;
    }
    
    const avgTTFTScale = count > 0 ? totalTTFTScale / count : 1;
    const avgTPOTScale = count > 0 ? totalTPOTScale / count : 1;
    const avgE2EScale = count > 0 ? totalE2EScale / count : 1;
    
    // Calculate offsets (average difference)
    let totalTTFTOffset = 0;
    let totalTPOTOffset = 0;
    count = 0;
    
    for (const result of results) {
      totalTTFTOffset += result.realStats.ttft.mean - result.simulatorMetrics.ttftMs;
      totalTPOTOffset += result.realStats.tpot.mean - result.simulatorMetrics.tpotMs;
      count++;
    }
    
    const avgTTFTOffset = count > 0 ? totalTTFTOffset / count : 0;
    const avgTPOTOffset = count > 0 ? totalTPOTOffset / count : 0;
    
    // Calculate recommended config updates
    const basePrefillTime = this.simulator['config']?.prefillBaseMs ?? 25;
    const baseDecodeTime = this.simulator['config']?.decodeBaseMs ?? 10;
    
    const configUpdates: Partial<{
      prefillBaseMs: number;
      prefillMsPerToken: number;
      decodeBaseMs: number;
      decodeMsPerToken: number;
      kvBaseMs: number;
      kvMsPerToken: number;
    }> = {};
    
    // Adjust based on observed patterns
    if (avgTTFTScale > 1.2) {
      configUpdates.prefillBaseMs = Math.round(basePrefillTime * avgTTFTScale * 10) / 10;
    }
    if (avgTPOTScale > 1.2) {
      configUpdates.decodeBaseMs = Math.round(baseDecodeTime * avgTPOTScale * 10) / 10;
    }
    
    return {
      prefillScaleFactor: Math.round(avgTTFTScale * 1000) / 1000,
      decodeScaleFactor: Math.round(avgTPOTScale * 1000) / 1000,
      ttftOffset: Math.round(avgTTFTOffset * 10) / 10,
      tpotOffset: Math.round(avgTPOTOffset * 10) / 10,
      confidenceLevel: 0.95,
      sampleSize: results.reduce((sum, r) => sum + r.realMetrics.length, 0)
    };
  }
  
  /**
   * Generate recommendations based on validation results.
   */
  private generateRecommendations(
    results: ValidationResult[],
    overallMAPE: { ttft: number; tpot: number; e2e: number }
  ): string[] {
    const recommendations: string[] = [];
    
    // Analyze error patterns
    const largeTTFTErrors = results.filter(r => r.errors.ttftMAPE > this.tolerances.ttft * 1.5);
    const largeTPOTErrors = results.filter(r => r.errors.tpotMAPE > this.tolerances.tpot * 1.5);
    
    // Generate specific recommendations
    if (overallMAPE.ttft > this.tolerances.ttft) {
      recommendations.push(
        `TTFT prediction needs improvement. Consider:`,
        `  - Adjusting prefill time coefficients (prefillBaseMs, prefillMsPerToken)`,
        `  - Improving KV transfer time modeling (kvBaseMs, kvMsPerToken)`,
        `  - Checking for network latency variations`
      );
    }
    
    if (overallMAPE.tpot > this.tolerances.tpot) {
      recommendations.push(
        `TPOT prediction needs improvement. Consider:`,
        `  - Adjusting decode time coefficients (decodeBaseMs, decodeMsPerToken)`,
        `  - Modeling interference effects more accurately`,
        `  - Accounting for batch size variations`
      );
    }
    
    if (overallMAPE.e2e > this.tolerances.e2e) {
      recommendations.push(
        `E2E prediction needs improvement. Consider:`,
        `  - Combined adjustments to both TTFT and TPOT components`,
        `  - Modeling queueing delays for concurrent requests`,
        `  - Calibrating against longer-running tests`
      );
    }
    
    // Check for patterns based on token count
    const largeTokenResults = results.filter(r => r.inputTokens >= 2048);
    if (largeTokenResults.length > 0) {
      const avgLargeTokenTTFTError = largeTokenResults.reduce((sum, r) => sum + r.errors.ttftMAPE, 0) / largeTokenResults.length;
      if (avgLargeTokenTTFTError > 20) {
        recommendations.push(
          `Large token inputs show higher error rates. Consider:`,
          `  - Improving scaling for large context scenarios`,
          `  - Adding specialized handling for 2K+ token inputs`
        );
      }
    }
    
    if (recommendations.length === 0) {
      recommendations.push(
        `All predictions are within acceptable tolerance.`,
        `Simulator is ready for production use.`,
        `Consider periodic re-calibration to maintain accuracy.`
      );
    }
    
    return recommendations;
  }
  
  /**
   * Apply calibration parameters to simulator.
   */
  applyCalibration(params: CalibrationParams): void {
    // This would update the simulator's internal configuration
    // Implementation depends on how the simulator exposes its config
    console.log("Applying calibration parameters:", params);
    console.log("Note: Full implementation requires simulator to expose updateConfig method");
  }
  
  /**
   * Get the current validation configuration.
   */
  getConfig(): ValidationConfig {
    return { ...this.config };
  }
  
  /**
   * Update tolerances for validation.
   */
  setTolerances(tolerances: { ttft: number; tpot: number; e2e: number }): void {
    this.tolerances = tolerances;
  }
}

/**
 * Generate markdown report from validation results.
 */
export function generateMarkdownReport(report: ValidationReport): string {
  let md = `# Simulation Validation Report\n\n`;
  md += `**Generated:** ${report.generatedAt}\n\n`;
  
  // Configuration section
  md += `## Test Configuration\n\n`;
  md += `| Parameter | Value |\n`;
  md += `|-----------|-------|\n`;
  md += `| Prompt Lengths | ${report.config.promptLengths.join(", ")} tokens |\n`;
  md += `| Output Tokens | ${report.config.outputTokens} |\n`;
  md += `| Repetitions | ${report.config.repetitions} |\n`;
  md += `| Delay Between Requests | ${report.config.delayBetweenRequests}ms |\n\n`;
  
  // Results table
  md += `## Detailed Results\n\n`;
  md += `| Config | Input Tokens | Real TTFT (ms) | Sim TTFT (ms) | TTFT MAPE | Real TPOT (ms) | Sim TPOT (ms) | TPOT MAPE | Status |\n`;
  md += `|--------|--------------|----------------|---------------|-----------|----------------|---------------|-----------|--------|\n`;
  
  for (const result of report.results) {
    const status = result.withinTolerance ? "✅ PASS" : "❌ FAIL";
    md += `| ${result.configId} | ${result.inputTokens} | ${result.realStats.ttft.mean.toFixed(1)} ± ${result.realStats.ttft.std.toFixed(1)} | ${result.simulatorMetrics.ttftMs.toFixed(1)} | ${result.errors.ttftMAPE.toFixed(2)}% | ${result.realStats.tpot.mean.toFixed(2)} ± ${result.realStats.tpot.std.toFixed(2)} | ${result.simulatorMetrics.tpotMs.toFixed(2)} | ${result.errors.tpotMAPE.toFixed(2)}% | ${status} |\n`;
  }
  
  md += `\n`;
  
  // Overall MAPE
  md += `## Overall MAPE Analysis\n\n`;
  md += `| Metric | MAPE | SMAPE | Tolerance | Status |\n`;
  md += `|--------|------|-------|-----------|--------|\n`;
  md += `| TTFT | ${report.overallMAPE.ttft.toFixed(2)}% | ${report.overallSMAPE.ttft.toFixed(2)}% | ${report.calibrationParams.prefillScaleFactor > 0 ? "15%" : "-"} | ${report.overallMAPE.ttft <= 15 ? "✅" : "❌"} |\n`;
  md += `| TPOT | ${report.overallMAPE.tpot.toFixed(2)}% | ${report.overallSMAPE.tpot.toFixed(2)}% | ${report.calibrationParams.decodeScaleFactor > 0 ? "10%" : "-"} | ${report.overallMAPE.tpot <= 10 ? "✅" : "❌"} |\n`;
  md += `| E2E | ${report.overallMAPE.e2e.toFixed(2)}% | ${report.overallSMAPE.e2e.toFixed(2)}% | "-"} | ${report.overallMAPE.e2e <= 15 ? "✅" : "❌"} |\n\n`;
  
  // Summary
  md += `## Summary\n\n`;
  md += `- **Total Tests:** ${report.summary.totalTests}\n`;
  md += `- **Passed:** ${report.summary.passedTests}\n`;
  md += `- **Failed:** ${report.summary.failedTests}\n`;
  md += `- **Pass Rate:** ${report.summary.passRate.toFixed(1)}%\n`;
  md += `- **Converged:** ${report.converged ? "YES ✅" : "NO ❌"}\n\n`;
  
  // Calibration parameters
  md += `## Recommended Calibration Parameters\n\n`;
  md += `| Parameter | Value |\n`;
  md += `|-----------|-------|\n`;
  md += `| Prefill Scale Factor | ${report.calibrationParams.prefillScaleFactor.toFixed(3)} |\n`;
  md += `| Decode Scale Factor | ${report.calibrationParams.decodeScaleFactor.toFixed(3)} |\n`;
  md += `| TTFT Offset (ms) | ${report.calibrationParams.ttftOffset.toFixed(1)} |\n`;
  md += `| TPOT Offset (ms) | ${report.calibrationParams.tpotOffset.toFixed(1)} |\n`;
  md += `| Sample Size | ${report.calibrationParams.sampleSize} |\n\n`;
  
  // Recommendations
  md += `## Recommendations\n\n`;
  for (const rec of report.recommendations) {
    md += `${rec}\n`;
  }
  
  return md;
}

/**
 * Factory function to create a SimulationValidator.
 */
export function createSimulationValidator(
  adapter?: DeepSeekAdapter,
  config?: Partial<ValidationConfig>
): SimulationValidator {
  const deepseekAdapter = adapter ?? new DeepSeekAdapter();
  return new SimulationValidator(deepseekAdapter, undefined, config);
}
