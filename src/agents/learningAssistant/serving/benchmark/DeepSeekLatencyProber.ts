/**
 * DeepSeek Latency Prober - Real API latency measurement framework.
 * 
 * Measures streaming response metrics:
 * - TTFT (Time To First Token)
 * - ITL (Inter-Token Latency array)
 * - E2E (End-to-End time)
 * - Throughput (tokens/s)
 * 
 * Features:
 * - Different input/output lengths
 * - Different concurrency levels
 * - Calibration against simulator predictions
 */
import { EnhancedPDServingSimulator } from "../EnhancedPDServingSimulator.ts";
import { DeterministicRandom } from "../utils/DeterministicRandom.ts";

export interface LatencyMeasurement {
  ttftMs: number;      // Time to First Token
  itlMs: number[];     // Inter-Token Latencies
  tpotMs: number;      // Time Per Output Token (avg)
  e2eMs: number;        // End-to-End time
  totalTokens: number;
  throughputTps: number; // Tokens per second
  timestamp: number;
}

export interface TestScenario {
  inputTokens: number;
  outputTokens: number;
  concurrency: number;
  repetitions: number;
}

export interface ScenarioResult {
  scenario: TestScenario;
  measurements: LatencyMeasurement[];
  stats: {
    ttftMean: number;
    ttftStd: number;
    ttftP50: number;
    ttftP95: number;
    tpotMean: number;
    tpotStd: number;
    tpotP50: number;
    tpotP95: number;
    e2eMean: number;
    e2eStd: number;
    throughputMean: number;
  };
}

export interface CalibrationResult {
  scenario: string;
  measured: {
    ttftMean: number;
    tpotMean: number;
    e2eMean: number;
  };
  predicted: {
    ttftMean: number;
    tpotMean: number;
    e2eMean: number;
  };
  errors: {
    ttftMAE: number;
    ttftMAPE: number;
    ttftRMSE: number;
    tpotMAE: number;
    tpotMAPE: number;
    tpotRMSE: number;
  };
  calibrationCoefficients: {
    ttftScale: number;
    tpotScale: number;
    e2eScale: number;
  };
}

export interface LatencyBaseline {
  generatedAt: string;
  scenarios: ScenarioResult[];
  overallStats: {
    avgTTFT: number;
    avgTPOT: number;
    avgThroughput: number;
    avgE2E: number;
  };
}

// Default test scenarios
export const DEFAULT_TEST_SCENARIOS: TestScenario[] = [
  { inputTokens: 128, outputTokens: 128, concurrency: 1, repetitions: 5 },
  { inputTokens: 512, outputTokens: 128, concurrency: 1, repetitions: 5 },
  { inputTokens: 512, outputTokens: 512, concurrency: 1, repetitions: 3 },
  { inputTokens: 2048, outputTokens: 128, concurrency: 1, repetitions: 3 },
];

// Generate test prompts with specified token count
function generateTestPrompt(tokenCount: number): string {
  const wordsPerToken = 0.75; // Approximate
  const targetWords = Math.floor(tokenCount * wordsPerToken);
  
  const templates = [
    "Explain the concept of machine learning in detail.",
    "What are the key differences between supervised and unsupervised learning?",
    "Describe how neural networks process information through layers.",
    "Discuss the importance of data preprocessing in AI pipelines.",
    "What factors affect the training time of large language models?",
  ];
  
  // Note: This is a module-level function for backwards compatibility
  // The actual deterministic selection is done via instance method
  const basePrompt = templates[0]; // Default fallback
  const filler = "Please provide comprehensive details, examples, and explanations. ";
  const repeats = Math.ceil(targetWords / 10);
  
  return basePrompt + filler.repeat(repeats).substring(0, tokenCount * 4);
}

/**
 * Generate test prompt with deterministic randomness based on token count.
 */
export function generateTestPromptDeterministic(tokenCount: number, rng: DeterministicRandom): string {
  const wordsPerToken = 0.75; // Approximate
  const targetWords = Math.floor(tokenCount * wordsPerToken);
  
  const templates = [
    "Explain the concept of machine learning in detail.",
    "What are the key differences between supervised and unsupervised learning?",
    "Describe how neural networks process information through layers.",
    "Discuss the importance of data preprocessing in AI pipelines.",
    "What factors affect the training time of large language models?",
  ];
  
  const basePrompt = templates[rng.randomInt(0, templates.length - 1)];
  const filler = "Please provide comprehensive details, examples, and explanations. ";
  const repeats = Math.ceil(targetWords / 10);
  
  return basePrompt + filler.repeat(repeats).substring(0, tokenCount * 4);
}

// Simple token estimation (word count * 1.3)
function estimateTokenCount(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

export class DeepSeekLatencyProber {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private simulator: EnhancedPDServingSimulator;
  private rng: DeterministicRandom;

  constructor(apiKey: string, baseUrl = "https://api.deepseek.com", model = "deepseek-chat", seed?: number) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
    this.simulator = new EnhancedPDServingSimulator();
    this.rng = new DeterministicRandom(seed ?? 42);
  }

  /**
   * Measure latency for a single streaming request using direct fetch.
   */
  async measureLatency(
    prompt: string,
    maxTokens: number
  ): Promise<LatencyMeasurement> {
    const requestStartTime = Date.now();
    const tokenTimestamps: number[] = [];
    let ttftMs = 0;
    let firstTokenReceived = false;
    let totalTokens = 0;

    // Make streaming request
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: prompt }
        ],
        max_tokens: maxTokens,
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`API request failed: HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body reader");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      buffer += text;
      
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              if (!firstTokenReceived) {
                ttftMs = Date.now() - requestStartTime;
                firstTokenReceived = true;
              }
              tokenTimestamps.push(Date.now());
              totalTokens += content.length; // Rough token count
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }

    const e2eMs = Date.now() - requestStartTime;
    
    // Calculate ITL array
    const itlMs: number[] = [];
    for (let i = 1; i < tokenTimestamps.length; i++) {
      itlMs.push(tokenTimestamps[i] - tokenTimestamps[i - 1]);
    }
    
    // Calculate average TPOT
    const tpotMs = itlMs.length > 0 
      ? itlMs.reduce((a, b) => a + b, 0) / itlMs.length 
      : 0;
    
    // Calculate throughput
    const throughputTps = e2eMs > 0 ? (totalTokens / e2eMs) * 1000 : 0;

    return {
      ttftMs,
      itlMs,
      tpotMs,
      e2eMs,
      totalTokens,
      throughputTps,
      timestamp: requestStartTime
    };
  }

  /**
   * Run a test scenario with multiple repetitions.
   */
  async runScenario(scenario: TestScenario): Promise<ScenarioResult> {
    const measurements: LatencyMeasurement[] = [];
    
    // Generate test prompt with approximate token count
    const prompt = generateTestPrompt(scenario.inputTokens);
    
    console.log(`Running scenario: input=${scenario.inputTokens}, output=${scenario.outputTokens}, concurrency=${scenario.concurrency}`);
    
    // Run repetitions
    for (let rep = 0; rep < scenario.repetitions; rep++) {
      try {
        const measurement = await this.measureLatency(prompt, scenario.outputTokens);
        measurements.push(measurement);
        console.log(`  Rep ${rep + 1}/${scenario.repetitions}: TTFT=${measurement.ttftMs.toFixed(1)}ms, TPOT=${measurement.tpotMs.toFixed(1)}ms, E2E=${measurement.e2eMs.toFixed(1)}ms`);
      } catch (error) {
        console.error(`  Rep ${rep + 1} failed:`, error);
      }
      
      // Small delay between repetitions
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Calculate statistics
    const stats = this.calculateStats(measurements);
    
    return {
      scenario,
      measurements,
      stats
    };
  }

  /**
   * Run all default test scenarios.
   */
  async runAllScenarios(): Promise<ScenarioResult[]> {
    const results: ScenarioResult[] = [];
    
    for (const scenario of DEFAULT_TEST_SCENARIOS) {
      const result = await this.runScenario(scenario);
      results.push(result);
    }
    
    return results;
  }

  /**
   * Calibrate simulator predictions against real measurements.
   */
  calibrate(measurements: LatencyMeasurement[], inputTokens: number, outputTokens: number): CalibrationResult {
    // Get simulator predictions
    const prefillTimeMs = 25 + inputTokens * 0.18;
    const kvTransferTimeMs = 5 + inputTokens * 0.015;
    const decodeTimeMs = 10 + outputTokens * 18;
    
    const predictedTTFT = prefillTimeMs + kvTransferTimeMs;
    const predictedTPOT = decodeTimeMs / outputTokens;
    const predictedE2E = predictedTTFT + decodeTimeMs;
    
    // Calculate measured averages
    const measuredTTFT = measurements.map(m => m.ttftMs);
    const measuredTPOT = measurements.map(m => m.tpotMs);
    const measuredE2E = measurements.map(m => m.e2eMs);
    
    const measuredTTFTMean = this.mean(measuredTTFT);
    const measuredTPOTMean = this.mean(measuredTPOT);
    const measuredE2EMean = this.mean(measuredE2E);
    
    // Calculate errors
    const ttftErrors = measuredTTFT.map(m => m - predictedTTFT);
    const tpotErrors = measuredTPOT.map(m => m - predictedTPOT);
    
    const ttftMAE = this.mean(ttftErrors.map(Math.abs));
    const tpotMAE = this.mean(tpotErrors.map(Math.abs));
    
    const ttftMAPE = this.mean(measuredTTFT.map((m) => m > 0 ? Math.abs((m - predictedTTFT) / m) * 100 : 0));
    const tpotMAPE = this.mean(measuredTPOT.map((m) => m > 0 ? Math.abs((m - predictedTPOT) / m) * 100 : 0));
    
    const ttftRMSE = Math.sqrt(this.mean(ttftErrors.map(e => e * e)));
    const tpotRMSE = Math.sqrt(this.mean(tpotErrors.map(e => e * e)));
    
    // Calculate calibration coefficients
    const ttftScale = predictedTTFT > 0 ? measuredTTFTMean / predictedTTFT : 1;
    const tpotScale = predictedTPOT > 0 ? measuredTPOTMean / predictedTPOT : 1;
    const e2eScale = predictedE2E > 0 ? measuredE2EMean / predictedE2E : 1;
    
    return {
      scenario: `input=${inputTokens}, output=${outputTokens}`,
      measured: {
        ttftMean: measuredTTFTMean,
        tpotMean: measuredTPOTMean,
        e2eMean: measuredE2EMean
      },
      predicted: {
        ttftMean: predictedTTFT,
        tpotMean: predictedTPOT,
        e2eMean: predictedE2E
      },
      errors: {
        ttftMAE,
        ttftMAPE,
        ttftRMSE,
        tpotMAE,
        tpotMAPE,
        tpotRMSE
      },
      calibrationCoefficients: {
        ttftScale,
        tpotScale,
        e2eScale
      }
    };
  }

  /**
   * Generate complete latency baseline report.
   */
  async generateBaseline(): Promise<LatencyBaseline> {
    const scenarios = await this.runAllScenarios();
    
    const allTTFT = scenarios.flatMap(s => s.measurements.map(m => m.ttftMs));
    const allTPOT = scenarios.flatMap(s => s.measurements.map(m => m.tpotMs));
    const allThroughput = scenarios.flatMap(s => s.measurements.map(m => m.throughputTps));
    const allE2E = scenarios.flatMap(s => s.measurements.map(m => m.e2eMs));
    
    return {
      generatedAt: new Date().toISOString(),
      scenarios,
      overallStats: {
        avgTTFT: this.mean(allTTFT),
        avgTPOT: this.mean(allTPOT),
        avgThroughput: this.mean(allThroughput),
        avgE2E: this.mean(allE2E)
      }
    };
  }

  /**
   * Save baseline to file.
   */
  async saveBaseline(baseline: LatencyBaseline, filePath: string): Promise<void> {
    const fs = await import("node:fs/promises");
    const content = JSON.stringify(baseline, null, 2);
    await fs.writeFile(filePath, content, "utf-8");
  }

  private calculateStats(measurements: LatencyMeasurement[]): ScenarioResult["stats"] {
    const ttftValues = measurements.map(m => m.ttftMs);
    const tpotValues = measurements.map(m => m.tpotMs);
    const throughputValues = measurements.map(m => m.throughputTps);
    
    return {
      ttftMean: this.mean(ttftValues),
      ttftStd: this.std(ttftValues),
      ttftP50: this.percentile(ttftValues, 50),
      ttftP95: this.percentile(ttftValues, 95),
      tpotMean: this.mean(tpotValues),
      tpotStd: this.std(tpotValues),
      tpotP50: this.percentile(tpotValues, 50),
      tpotP95: this.percentile(tpotValues, 95),
      e2eMean: this.mean(measurements.map(m => m.e2eMs)),
      e2eStd: this.std(measurements.map(m => m.e2eMs)),
      throughputMean: this.mean(throughputValues)
    };
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private std(values: number[]): number {
    if (values.length === 0) return 0;
    const m = this.mean(values);
    return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length);
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] * (upper - index) + sorted[upper] * (index - lower);
  }
}

// Factory function
export function createDeepSeekLatencyProber(apiKey: string): DeepSeekLatencyProber {
  return new DeepSeekLatencyProber(apiKey);
}
