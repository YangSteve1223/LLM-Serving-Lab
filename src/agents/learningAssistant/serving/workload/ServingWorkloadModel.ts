/**
 * Serving Workload Model.
 * 
 * Models 6-dimensional workload profiles for LLM serving scenarios.
 * Supports trace generation, workload analysis, and experiment variable computation.
 */
import type { EnhancedPDWorkloadRequest, PDWorkloadRequest } from "../ServingTrace.ts";
import { DeterministicRandom } from "../utils/DeterministicRandom.ts";

// ==================== Types ====================

export type TaskType = "choice" | "explanation" | "code" | "calculation" | "discussion";

export type ArrivalPattern = "poisson" | "multimodal_gamma";

export interface WorkloadProfile {
  // 6-dimensional workload characteristics
  prefixReuseRate: number; // PRC: Ratio of shared prefix tokens
  arrivalPattern: ArrivalPattern;
  inputLengthMean: number; // tokens (log-normal μ)
  inputLengthStd: number; // tokens (log-normal σ)
  outputLengthShort: number; // tokens for short answers (choice/calculation)
  outputLengthLong: number; // tokens for long answers (explanation/discussion)
  multiTurnRounds: { min: number; max: number };
  taskTypeDistribution: Record<TaskType, number>;

  // Derived metrics
  lcr: number; // Long Context Ratio
  prc: number; // Prefix Reuse Coefficient
  tii: number; // Tidal Intensity Index
}

export interface WorkloadConfig {
  numClients: number;
  numTenants: number;
  avgConcurrentUsers: number;
  peakConcurrentUsers: number;
  avgDialogueTurns: number;
  loadFluctuation: number; // 0-1, higher = more pronounced tidal pattern
  prefixReuseRate: number;
  courseMaterialTokens: number;
  systemPromptTokens: number;
}

export interface SyntheticRequest {
  id: string;
  clientId: string;
  tenantId: string;
  arrivalTimeMs: number;
  inputTokens: number;
  outputTokens: number;
  prefixTokens: number;
  dynamicTokens: number;
  taskType: TaskType;
  dialogueRound: number;
  ttlTokens: number; // Total context length
}

export interface WorkloadAnalysis {
  profile: WorkloadProfile;
  theoreticalCacheHitUpperBound: number;
  prefixReuseAnalysis: {
    avgSharedPrefix: number;
    maxSharedPrefix: number;
    prefixDiversity: number;
  };
  arrivalAnalysis: {
    avgInterArrivalMs: number;
    peakHour: number;
    offPeakHour: number;
    coefficientOfVariation: number;
  };
  lengthAnalysis: {
    inputCV: number; // Coefficient of variation
    outputCV: number;
    bimodalRatio: number;
  };
  experimentVariables: {
    LCR: number; // Long Context Ratio
    PRC: number; // Prefix Reuse Coefficient
    TII: number; // Tidal Intensity Index
  };
}

// ==================== Statistical Distributions ====================

/**
 * Generate a Poisson-distributed random value.
 * Uses provided RNG if available, otherwise falls back to Math.random() for backwards compatibility.
 */
function poisson(lambda: number, rng?: DeterministicRandom): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng ? rng.random() : Math.random();
  } while (p > L);
  return k - 1;
}

/**
 * Generate a log-normal distributed value.
 */
function logNormal(mu: number, sigma: number, rng: DeterministicRandom): number {
  const u = rng.randomGaussian(0, 1);
  return Math.round(Math.exp(mu + sigma * u));
}

/**
 * Generate Gamma-distributed random value (for multimodal patterns).
 */
function gamma(shape: number, scale: number, rng: DeterministicRandom): number {
  if (shape < 1) {
    return gamma(shape + 1, scale, rng) * Math.pow(rng.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number, v: number;
    do {
      x = rng.randomGaussian(0, 1);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

// ==================== Workload Profile ====================

export class ServingWorkloadModel {
  private config: WorkloadConfig;
  private profile: WorkloadProfile;
  private rng: DeterministicRandom;

  constructor(config: WorkloadConfig, seed?: number) {
    this.config = config;
    this.profile = this.computeProfile(config);
    this.rng = new DeterministicRandom(seed ?? 42);
  }

  private computeProfile(config: WorkloadConfig): WorkloadProfile {
    const { prefixReuseRate, avgConcurrentUsers, peakConcurrentUsers } = config;

    return {
      prefixReuseRate,
      arrivalPattern: config.loadFluctuation > 0.5 ? "multimodal_gamma" : "poisson",
      inputLengthMean: Math.log(config.courseMaterialTokens + config.systemPromptTokens),
      inputLengthStd: 0.5,
      outputLengthShort: 50, // Short answer tokens
      outputLengthLong: 500, // Long answer tokens
      multiTurnRounds: { min: 1, max: config.avgDialogueTurns },
      taskTypeDistribution: {
        choice: 0.3,
        explanation: 0.25,
        code: 0.15,
        calculation: 0.15,
        discussion: 0.15
      },
      // Derived metrics
      lcr: this.computeLCR(config),
      prc: prefixReuseRate,
      tii: this.computeTII(avgConcurrentUsers, peakConcurrentUsers)
    };
  }

  private computeLCR(config: WorkloadConfig): number {
    // LCR = actual input token / max context window
    // Assume max context window of 128K tokens
    const maxContext = 128 * 1024;
    const avgInput = config.courseMaterialTokens + config.systemPromptTokens + 200;
    return avgInput / maxContext;
  }

  private computeTII(avg: number, peak: number): number {
    // TII = peak concurrent / avg concurrent
    return peak / Math.max(1, avg);
  }

  getProfile(): WorkloadProfile {
    return { ...this.profile };
  }

  /**
   * Generate synthetic trace requests.
   */
  generateTrace(
    durationMinutes: number = 60,
    seed?: number
  ): SyntheticRequest[] {
    const requests: SyntheticRequest[] = [];
    const durationMs = durationMinutes * 60 * 1000;
    const startTime = Date.now();

    let requestId = 0;
    const taskTypes = Object.keys(this.profile.taskTypeDistribution) as TaskType[];
    const taskProbs = Object.values(this.profile.taskTypeDistribution);

    for (let clientIdx = 0; clientIdx < this.config.numClients; clientIdx++) {
      const clientId = `student_${clientIdx}`;
      const tenantId = `course_${clientIdx % this.config.numTenants}`;
      const dialogueState = {
        round: 0,
        sharedHistoryTokens: 0
      };

      // Generate arrival times based on pattern
      let currentTime = startTime;
      while (currentTime < startTime + durationMs) {
        const interArrival = this.generateInterArrival();
        currentTime += interArrival;

        if (currentTime > startTime + durationMs) break;

        // Generate request
        const taskType = this.sampleTaskType(taskTypes, taskProbs);
        const inputTokens = this.generateInputLength();
        const outputTokens = this.generateOutputLength(taskType);
        const prefixTokens = Math.floor(inputTokens * this.profile.prefixReuseRate);
        const dynamicTokens = inputTokens - prefixTokens;

        dialogueState.round++;
        dialogueState.sharedHistoryTokens += prefixTokens;

        requests.push({
          id: `req_${requestId++}`,
          clientId,
          tenantId,
          arrivalTimeMs: currentTime - startTime,
          inputTokens,
          outputTokens,
          prefixTokens,
          dynamicTokens,
          taskType,
          dialogueRound: dialogueState.round,
          ttlTokens: inputTokens + outputTokens
        });
      }
    }

    return requests.sort((a, b) => a.arrivalTimeMs - b.arrivalTimeMs);
  }

  /**
   * Generate trace compatible with PDWorkloadRequest format.
   */
  generatePDWorkloadTrace(durationMinutes: number = 60): PDWorkloadRequest[] {
    const syntheticTrace = this.generateTrace(durationMinutes);
    return syntheticTrace.map(req => ({
      id: req.id,
      arrivalMs: req.arrivalTimeMs,
      prefillTokens: req.inputTokens,
      decodeTokens: req.outputTokens,
      cacheablePrefixTokens: req.prefixTokens,
      priority: req.taskType === "choice" ? "interactive" : "background"
    }));
  }

  /**
   * Export trace to JSONL format.
   */
  exportToJSONL(requests: SyntheticRequest[]): string {
    return requests.map(r => JSON.stringify(r)).join("\n");
  }

  /**
   * Analyze workload characteristics.
   */
  analyze(requests: SyntheticRequest[]): WorkloadAnalysis {
    const profile = this.analyzeWorkloadProfile(requests);
    const prefixAnalysis = this.analyzePrefixReuse(requests);
    const arrivalAnalysis = this.analyzeArrivalPattern(requests);
    const lengthAnalysis = this.analyzeLengthDistribution(requests);

    return {
      profile,
      theoreticalCacheHitUpperBound: this.computeTheoreticalHitBound(requests),
      prefixReuseAnalysis: prefixAnalysis,
      arrivalAnalysis,
      lengthAnalysis,
      experimentVariables: {
        LCR: this.profile.lcr,
        PRC: this.profile.prc,
        TII: this.profile.tii
      }
    };
  }

  private analyzeWorkloadProfile(requests: SyntheticRequest[]): WorkloadProfile {
    const inputTokens = requests.map(r => r.inputTokens);
    const mean = inputTokens.reduce((a, b) => a + b, 0) / inputTokens.length;
    const variance = inputTokens.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / inputTokens.length;

    return {
      ...this.profile,
      inputLengthMean: Math.log(mean),
      inputLengthStd: Math.sqrt(Math.log(1 + variance / (mean * mean)))
    };
  }

  private analyzePrefixReuse(requests: SyntheticRequest[]): WorkloadAnalysis["prefixReuseAnalysis"] {
    let totalShared = 0;
    let maxShared = 0;
    const uniquePrefixes = new Set<string>();

    for (const req of requests) {
      totalShared += req.prefixTokens;
      maxShared = Math.max(maxShared, req.prefixTokens);
      uniquePrefixes.add(`${req.tenantId}_${req.prefixTokens}`);
    }

    const avgShared = totalShared / Math.max(1, requests.length);
    const prefixDiversity = uniquePrefixes.size / Math.max(1, this.config.numTenants);

    return {
      avgSharedPrefix: avgShared,
      maxSharedPrefix: maxShared,
      prefixDiversity
    };
  }

  private analyzeArrivalPattern(requests: SyntheticRequest[]): WorkloadAnalysis["arrivalAnalysis"] {
    if (requests.length < 2) {
      return {
        avgInterArrivalMs: 0,
        peakHour: 9,
        offPeakHour: 3,
        coefficientOfVariation: 0
      };
    }

    const interArrivals: number[] = [];
    for (let i = 1; i < requests.length; i++) {
      interArrivals.push(requests[i].arrivalTimeMs - requests[i - 1].arrivalTimeMs);
    }

    const meanInterArrival = interArrivals.reduce((a, b) => a + b, 0) / interArrivals.length;
    const varianceInterArrival = interArrivals.reduce((a, b) => a + Math.pow(b - meanInterArrival, 2), 0) / interArrivals.length;
    const cv = Math.sqrt(varianceInterArrival) / Math.max(1, meanInterArrival);

    // Find peak and off-peak hours (simplified - assume uniform distribution)
    const hourCounts = new Array(24).fill(0);
    for (const req of requests) {
      const hour = Math.floor((req.arrivalTimeMs / (60 * 60 * 1000)) % 24);
      hourCounts[hour]++;
    }
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    const offPeakHour = hourCounts.indexOf(Math.min(...hourCounts.filter(h => h > 0)));

    return {
      avgInterArrivalMs: meanInterArrival,
      peakHour,
      offPeakHour,
      coefficientOfVariation: cv
    };
  }

  private analyzeLengthDistribution(requests: SyntheticRequest[]): WorkloadAnalysis["lengthAnalysis"] {
    const inputs = requests.map(r => r.inputTokens);
    const outputs = requests.map(r => r.outputTokens);

    const inputCV = this.coefficientOfVariation(inputs);
    const outputCV = this.coefficientOfVariation(outputs);

    // Bimodal ratio: ratio of short vs long answers
    const shortAnswers = outputs.filter(o => o < this.profile.outputLengthShort * 2).length;
    const bimodalRatio = shortAnswers / Math.max(1, requests.length);

    return {
      inputCV,
      outputCV,
      bimodalRatio
    };
  }

  private coefficientOfVariation(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    return Math.sqrt(variance) / Math.max(1, mean);
  }

  private computeTheoreticalHitBound(requests: SyntheticRequest[]): number {
    // Upper bound: all requests with same tenantId could share prefix
    const courseGroups = new Map<string, number>();
    for (const req of requests) {
      courseGroups.set(req.tenantId, (courseGroups.get(req.tenantId) || 0) + 1);
    }

    let potentialHits = 0;
    for (const [, count] of courseGroups) {
      // In course, after first request, all others could potentially hit
      if (count > 1) {
        potentialHits += count - 1;
      }
    }

    return potentialHits / Math.max(1, requests.length);
  }

  private generateInterArrival(): number {
    const { avgConcurrentUsers, loadFluctuation } = this.config;
    const baseRate = avgConcurrentUsers; // requests per second per user

    if (this.profile.arrivalPattern === "multimodal_gamma") {
      // Morning and evening peaks
      const hour = (Date.now() / (60 * 60 * 1000)) % 24;
      let peakMultiplier = 1;
      if (hour >= 8 && hour <= 10) peakMultiplier = 1 + loadFluctuation;
      if (hour >= 19 && hour <= 21) peakMultiplier = 1 + loadFluctuation * 0.8;
      if (hour >= 1 && hour <= 5) peakMultiplier = 0.2;

      const lambda = baseRate * peakMultiplier;
      return poisson(lambda, this.rng) * 1000; // ms
    }

    return poisson(baseRate, this.rng) * 1000;
  }

  private generateInputLength(): number {
    return logNormal(this.profile.inputLengthMean, this.profile.inputLengthStd, this.rng);
  }

  private generateOutputLength(taskType: TaskType): number {
    const { outputLengthShort, outputLengthLong } = this.profile;
    if (taskType === "choice" || taskType === "calculation") {
      return Math.round(outputLengthShort * (0.5 + this.rng.random()));
    }
    if (taskType === "code") {
      return Math.round(outputLengthLong * 0.8 * (0.8 + this.rng.random() * 0.4));
    }
    // explanation or discussion
    return Math.round(outputLengthLong * (0.6 + this.rng.random() * 0.8));
  }

  private sampleTaskType(types: TaskType[], probs: number[]): TaskType {
    const r = this.rng.random();
    let cumProb = 0;
    for (let i = 0; i < types.length; i++) {
      cumProb += probs[i];
      if (r < cumProb) return types[i];
    }
    return types[0];
  }
}

// ==================== Factory Functions ====================

export function createTypicalWorkload(): ServingWorkloadModel {
  return new ServingWorkloadModel({
    numClients: 100,
    numTenants: 10,
    avgConcurrentUsers: 20,
    peakConcurrentUsers: 80,
    avgDialogueTurns: 8,
    loadFluctuation: 0.6,
    prefixReuseRate: 0.35,
    courseMaterialTokens: 2048,
    systemPromptTokens: 512
  });
}

export function createHeavyWorkload(): ServingWorkloadModel {
  return new ServingWorkloadModel({
    numClients: 500,
    numTenants: 50,
    avgConcurrentUsers: 100,
    peakConcurrentUsers: 500,
    avgDialogueTurns: 12,
    loadFluctuation: 0.8,
    prefixReuseRate: 0.25,
    courseMaterialTokens: 4096,
    systemPromptTokens: 768
  });
}

export function createLightWorkload(): ServingWorkloadModel {
  return new ServingWorkloadModel({
    numClients: 20,
    numTenants: 5,
    avgConcurrentUsers: 5,
    peakConcurrentUsers: 15,
    avgDialogueTurns: 5,
    loadFluctuation: 0.3,
    prefixReuseRate: 0.5,
    courseMaterialTokens: 1024,
    systemPromptTokens: 384
  });
}

// ==================== Static Workload Generation ====================

export interface SyntheticWorkloadOptions {
  prefillHeavy?: boolean;
  decodeHeavy?: boolean;
  highPriorityRatio?: number;
  idPrefix?: string;
}

/**
 * Generate synthetic PD workload requests.
 * 
 * This is a unified static method that can replace duplicated workload generation
 * logic across EnhancedPDServingSimulator, ContinuousBatchingScheduler, and other modules.
 */
export function generateSyntheticWorkload(
  requestCount: number,
  qps: number,
  options?: SyntheticWorkloadOptions
): PDWorkloadRequest[] {
  const interval = qps > 0 ? 1000 / qps : 500;
  const highPriorityRatio = options?.highPriorityRatio ?? 0.3;
  const idPrefix = options?.idPrefix ?? "synthetic";
  
  return Array.from({ length: requestCount }, (_, index) => {
    const phase = index % 5;
    let prefillTokens: number;
    let decodeTokens: number;
    
    if (options?.prefillHeavy) {
      prefillTokens = 1200 + phase * 400 + (index % 7) * 100;
      decodeTokens = 50 + (index % 4) * 30;
    } else if (options?.decodeHeavy) {
      prefillTokens = 400 + phase * 100 + (index % 5) * 20;
      decodeTokens = 200 + (index % 4) * 100 + (phase === 4 ? 150 : 0);
    } else {
      prefillTokens = 650 + phase * 280 + (index % 7) * 35;
      decodeTokens = 70 + (index % 4) * 45 + (phase === 4 ? 120 : 0);
    }
    
    const isHighPriority = index < Math.floor(requestCount * highPriorityRatio);
    
    return {
      id: `${idPrefix}-${index + 1}`,
      arrivalMs: Math.round(index * interval),
      prefillTokens,
      decodeTokens,
      cacheablePrefixTokens: Math.floor(prefillTokens * (phase <= 2 ? 0.62 : 0.38)),
      priority: isHighPriority ? "interactive" : "background"
    };
  });
}
