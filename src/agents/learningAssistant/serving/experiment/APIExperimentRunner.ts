/**
 * API Experiment Runner
 * 
 * Runs experiments using real DeepSeek API and compares with simulator.
 * Calibrates simulator based on real API measurements.
 * 
 * References:
 * - DeepSeek API documentation for latency measurement methodology.
 * - Statistical methods for simulator calibration from measurement data.
 */
import type { SchedulingMetrics } from "../ServingTrace.ts";
import { SpeculativeDecodingSimulator } from "../speculative/SpeculativeDecodingSimulator.ts";

/**
 * Test scenario configuration.
 */
export interface TestScenario {
  /** Scenario name */
  name: string;
  /** Input tokens */
  inputTokens: number;
  /** Expected output tokens */
  outputTokens: number;
  /** Number of concurrent requests */
  concurrency: number;
  /** Test prompt (optional) */
  prompt?: string;
}

/**
 * Real API measurement result.
 */
export interface APIMeasurement {
  scenario: TestScenario;
  ttftMs: number;
  tpotMs: number;
  e2eMs: number;
  throughputTokensPerSec: number;
  success: boolean;
  error?: string;
}

/**
 * Simulation result for comparison.
 */
export interface SimMeasurement {
  scenario: TestScenario;
  ttftMs: number;
  tpotMs: number;
  e2eMs: number;
  throughputTokensPerSec: number;
}

/**
 * Comparison report between simulation and real API.
 */
export interface ComparisonReport {
  scenario: TestScenario;
  simResult: SimMeasurement;
  apiResult: APIMeasurement;
  mape: {
    ttft: number;
    tpot: number;
    e2e: number;
  };
  confidenceInterval: {
    ttft: [number, number];
    tpot: [number, number];
    e2e: [number, number];
  };
  recommendation: string;
}

/**
 * Calibration parameters derived from API measurements.
 */
export interface CalibrationParams {
  /** Scale factor for prefill time */
  prefillScaleFactor: number;
  /** Scale factor for decode time */
  decodeScaleFactor: number;
  /** Offset for TTFT */
  ttftOffset: number;
  /** Offset for TPOT */
  tpotOffset: number;
  /** Confidence level for intervals */
  confidenceLevel: number;
  /** Sample size used for calibration */
  sampleSize: number;
}

/**
 * Standard test scenarios.
 */
export const STANDARD_SCENARIOS: TestScenario[] = [
  {
    name: 'short_input',
    inputTokens: 128,
    outputTokens: 128,
    concurrency: 1,
    prompt: 'What is machine learning?'
  },
  {
    name: 'short_input_high concurrency',
    inputTokens: 128,
    outputTokens: 128,
    concurrency: 5,
    prompt: 'What is machine learning?'
  },
  {
    name: 'medium_input',
    inputTokens: 512,
    outputTokens: 256,
    concurrency: 1,
    prompt: 'Explain the concept of neural networks and backpropagation.'
  },
  {
    name: 'medium_input_concurrent',
    inputTokens: 512,
    outputTokens: 256,
    concurrency: 3,
    prompt: 'Explain the concept of neural networks and backpropagation.'
  },
  {
    name: 'long_input',
    inputTokens: 2048,
    outputTokens: 256,
    concurrency: 1,
    prompt: 'Write a comprehensive essay on the history of artificial intelligence.'
  }
];

/**
 * API Experiment Runner
 * 
 * Runs experiments comparing simulation vs real API.
 * Uses DEEPSEEK_API_KEY from environment variable (never written to file).
 */
export class APIExperimentRunner {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private simulator: SpeculativeDecodingSimulator;
  
  /**
   * Get default scenarios.
   */
  private scenarios: TestScenario[] = STANDARD_SCENARIOS;

  constructor(apiKey?: string) {
    // Get API key from environment variable - NEVER from file
    this.apiKey = apiKey || process.env.DEEPSEEK_API_KEY || '';
    this.baseUrl = 'https://api.deepseek.com';
    this.model = 'deepseek-chat';
    this.simulator = new SpeculativeDecodingSimulator();
  }

  /**
   * Check if API key is available.
   */
  hasAPIKey(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Run a single scenario with real API.
   */
  async runScenario(scenario: TestScenario): Promise<APIMeasurement> {
    if (!this.hasAPIKey()) {
      return {
        scenario,
        ttftMs: 0,
        tpotMs: 0,
        e2eMs: 0,
        throughputTokensPerSec: 0,
        success: false,
        error: 'API key not available. Set DEEPSEEK_API_KEY environment variable.'
      };
    }

    const prompt = scenario.prompt || 'Hello, how are you?';
    
    try {
      const startTime = Date.now();
      const firstTokenTime = Date.now();
      let ttftMs = 0;
      let lastTokenTime = startTime;
      const tokenTimes: number[] = [];
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'user', content: prompt }
          ],
          max_tokens: scenario.outputTokens,
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let firstTokenReceived = false;

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(data);
              if (parsed.choices?.[0]?.delta?.content) {
                const tokenTime = Date.now();
                
                if (!firstTokenReceived) {
                  ttftMs = tokenTime - startTime;
                  firstTokenReceived = true;
                } else if (tokenTimes.length > 0) {
                  tokenTimes.push(tokenTime - lastTokenTime);
                }
                
                lastTokenTime = tokenTime;
                fullContent += parsed.choices[0].delta.content;
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      const endTime = Date.now();
      const e2eMs = endTime - startTime;
      
      // Calculate TPOT (average inter-token latency)
      const avgTpot = tokenTimes.length > 0 
        ? tokenTimes.reduce((a, b) => a + b, 0) / tokenTimes.length 
        : e2eMs / Math.max(1, fullContent.length);
      
      // Throughput
      const throughputTokensPerSec = (fullContent.length / e2eMs) * 1000;

      return {
        scenario,
        ttftMs,
        tpotMs: avgTpot,
        e2eMs,
        throughputTokensPerSec,
        success: true
      };
    } catch (error) {
      return {
        scenario,
        ttftMs: 0,
        tpotMs: 0,
        e2eMs: 0,
        throughputTokensPerSec: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Run simulation for a scenario.
   */
  runSimulation(scenario: TestScenario): SimMeasurement {
    // Use the speculative decoding simulator
    const request = {
      id: `sim-${scenario.name}`,
      arrivalMs: 0,
      prefillTokens: scenario.inputTokens,
      decodeTokens: scenario.outputTokens
    };

    const result = this.simulator.simulate(request);

    return {
      scenario,
      ttftMs: scenario.inputTokens * 0.18 + 25, // Simple prefill model
      tpotMs: 10 / result.speedupRatio, // TPOT with speculation speedup
      e2eMs: (scenario.inputTokens * 0.18 + 25) + result.speculativeLatencyMs,
      throughputTokensPerSec: scenario.outputTokens / 
        ((scenario.inputTokens * 0.18 + 25) + result.speculativeLatencyMs) * 1000
    };
  }

  /**
   * Compare simulation with real API measurement.
   */
  compareSimVsReal(
    simResult: SimMeasurement,
    apiResult: APIMeasurement
  ): ComparisonReport {
    if (!apiResult.success) {
      return {
        scenario: simResult.scenario,
        simResult,
        apiResult,
        mape: { ttft: 0, tpot: 0, e2e: 0 },
        confidenceInterval: {
          ttft: [0, 0],
          tpot: [0, 0],
          e2e: [0, 0]
        },
        recommendation: 'Cannot compare - API measurement failed'
      };
    }

    // Calculate MAPE (Mean Absolute Percentage Error)
    const mape = {
      ttft: this.calculateMAPE(simResult.ttftMs, apiResult.ttftMs),
      tpot: this.calculateMAPE(simResult.tpotMs, apiResult.tpotMs),
      e2e: this.calculateMAPE(simResult.e2eMs, apiResult.e2eMs)
    };

    // Calculate confidence intervals (simplified - assumes normal distribution)
    const confidenceInterval = {
      ttft: this.calculateCI(simResult.ttftMs, 0.1), // ±10% uncertainty
      tpot: this.calculateCI(simResult.tpotMs, 0.15), // ±15% uncertainty
      e2e: this.calculateCI(simResult.e2eMs, 0.1)     // ±10% uncertainty
    };

    // Generate recommendation
    const avgMAPE = (mape.ttft + mape.tpot + mape.e2e) / 3;
    let recommendation: string;

    if (avgMAPE < 10) {
      recommendation = 'Excellent calibration. Simulator closely matches API.';
    } else if (avgMAPE < 20) {
      recommendation = 'Good calibration. Minor adjustments may improve accuracy.';
    } else if (avgMAPE < 30) {
      recommendation = 'Moderate accuracy. Consider recalibrating with more samples.';
    } else {
      recommendation = 'Poor calibration. Significant differences between simulator and API.';
    }

    return {
      scenario: simResult.scenario,
      simResult,
      apiResult,
      mape,
      confidenceInterval,
      recommendation
    };
  }

  /**
   * Run full comparison for multiple scenarios.
   */
  async runComparison(
    scenarios: TestScenario[] = STANDARD_SCENARIOS,
    repetitions: number = 3
  ): Promise<ComparisonReport[]> {
    const reports: ComparisonReport[] = [];

    for (const scenario of scenarios) {
      console.log(`Running scenario: ${scenario.name}`);
      
      // Run simulation
      const simResult = this.runSimulation(scenario);
      
      // Run API measurements (average over repetitions)
      let apiResult: APIMeasurement | null = null;
      
      for (let i = 0; i < repetitions; i++) {
        const result = await this.runScenario(scenario);
        if (result.success) {
          if (!apiResult) {
            apiResult = result;
          } else {
            // Average with previous results
            apiResult = {
              ...apiResult,
              ttftMs: (apiResult.ttftMs + result.ttftMs) / 2,
              tpotMs: (apiResult.tpotMs + result.tpotMs) / 2,
              e2eMs: (apiResult.e2eMs + result.e2eMs) / 2
            };
          }
        }
        // Add delay between requests to avoid rate limiting
        if (i < repetitions - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (apiResult) {
        const report = this.compareSimVsReal(simResult, apiResult);
        reports.push(report);
        console.log(`  MAPE: TTFT=${report.mape.ttft.toFixed(1)}%, TPOT=${report.mape.tpot.toFixed(1)}%, E2E=${report.mape.e2e.toFixed(1)}%`);
      } else {
        console.log(`  Failed to get API results`);
      }
    }

    return reports;
  }

  /**
   * Calibrate simulator from API measurements.
   */
  calibrateFromAPI(measurements: APIMeasurement[]): CalibrationParams {
    const successfulMeasurements = measurements.filter(m => m.success);
    
    if (successfulMeasurements.length === 0) {
      return {
        prefillScaleFactor: 1.0,
        decodeScaleFactor: 1.0,
        ttftOffset: 0,
        tpotOffset: 0,
        confidenceLevel: 0.95,
        sampleSize: 0
      };
    }

    // Calculate average ratios between API and simulated values
    let totalPrefillRatio = 0;
    let totalDecodeRatio = 0;
    let ttftOffsetSum = 0;
    let tpotOffsetSum = 0;

    for (const measurement of successfulMeasurements) {
      const simResult = this.runSimulation(measurement.scenario);
      
      if (measurement.ttftMs > 0) {
        totalPrefillRatio += simResult.ttftMs / measurement.ttftMs;
        ttftOffsetSum += measurement.ttftMs - simResult.ttftMs;
      }
      
      if (measurement.tpotMs > 0) {
        totalDecodeRatio += simResult.tpotMs / measurement.tpotMs;
        tpotOffsetSum += measurement.tpotMs - simResult.tpotMs;
      }
    }

    const n = successfulMeasurements.length;

    return {
      prefillScaleFactor: n > 0 ? totalPrefillRatio / n : 1.0,
      decodeScaleFactor: n > 0 ? totalDecodeRatio / n : 1.0,
      ttftOffset: n > 0 ? ttftOffsetSum / n : 0,
      tpotOffset: n > 0 ? tpotOffsetSum / n : 0,
      confidenceLevel: 0.95,
      sampleSize: n
    };
  }

  /**
   * Calculate MAPE between simulated and actual values.
   */
  private calculateMAPE(simulated: number, actual: number): number {
    if (actual === 0) return 0;
    return Math.abs((simulated - actual) / actual) * 100;
  }

  /**
   * Calculate confidence interval for a measurement.
   */
  private calculateCI(value: number, uncertainty: number): [number, number] {
    const margin = value * uncertainty;
    return [value - margin, value + margin];
  }

  /**
   * Generate markdown report from comparison results.
   */
  generateMarkdownReport(
    reports: ComparisonReport[],
    calibration?: CalibrationParams
  ): string {
    const lines: string[] = [];

    lines.push('# API vs Simulation Comparison Report\n');
    lines.push(`Generated: ${new Date().toISOString()}\n`);

    if (calibration) {
      lines.push('## Calibration Parameters\n');
      lines.push(`- Prefill Scale Factor: ${calibration.prefillScaleFactor.toFixed(3)}`);
      lines.push(`- Decode Scale Factor: ${calibration.decodeScaleFactor.toFixed(3)}`);
      lines.push(`- TTFT Offset: ${calibration.ttftOffset.toFixed(1)}ms`);
      lines.push(`- TPOT Offset: ${calibration.tpotOffset.toFixed(1)}ms`);
      lines.push(`- Sample Size: ${calibration.sampleSize}\n`);
    }

    lines.push('## Comparison Results\n');
    lines.push('| Scenario | Sim TTFT | API TTFT | MAPE TTFT | Sim TPOT | API TPOT | MAPE TPOT |');
    lines.push('|----------|----------|----------|-----------|----------|----------|-----------|');

    for (const report of reports) {
      lines.push(
        `| ${report.scenario.name} | ${report.simResult.ttftMs.toFixed(1)} | ${report.apiResult.ttftMs.toFixed(1)} | ${report.mape.ttft.toFixed(1)}% | ` +
        `${report.simResult.tpotMs.toFixed(1)} | ${report.apiResult.tpotMs.toFixed(1)} | ${report.mape.tpot.toFixed(1)}% |`
      );
    }

    lines.push('\n## Summary\n');
    
    const avgMAPE = reports.length > 0
      ? reports.reduce((sum, r) => sum + (r.mape.ttft + r.mape.tpot + r.mape.e2e) / 3, 0) / reports.length
      : 0;

    lines.push(`Average MAPE: ${avgMAPE.toFixed(1)}%`);
    lines.push(`Scenarios Tested: ${reports.length}`);

    return lines.join('\n');
  }

  /**
   * Set custom scenarios for experiments.
   */
  setScenarios(scenarios: TestScenario[]): void {
    this.scenarios = scenarios;
  }

  /**
   * Get current scenarios.
   */
  getScenarios(): TestScenario[] {
    return this.scenarios;
  }

  /**
   * Run experiments for a workload (converts to scenarios).
   */
  async runExperiments(workload: { prefillTokens: number; decodeTokens: number }[]): Promise<APIMeasurement[]> {
    const scenarios: TestScenario[] = workload.map((w, i) => ({
      name: `workload-${i}`,
      inputTokens: w.prefillTokens,
      outputTokens: w.decodeTokens,
      concurrency: 1
    }));
    
    return this.runComparison(scenarios, 1);
  }
}

/**
 * Default instance.
 */
export const apiExperimentRunner = new APIExperimentRunner();
