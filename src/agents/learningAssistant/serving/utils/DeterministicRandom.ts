/**
 * Deterministic Random Number Generator
 * 
 * Implements Mulberry32 PRNG for reproducible simulation results.
 * All randomness in the serving simulator is controlled via seeds
 * to ensure deterministic behavior during testing and experiments.
 */

/**
 * Mulberry32 PRNG implementation.
 * Fast and provides good statistical properties.
 */
export class DeterministicRandom {
  private state: number;
  
  /**
   * Create a new deterministic random number generator.
   * @param seed Initial seed value (default: 42)
   */
  constructor(seed: number = 42) {
    this.state = seed;
  }
  
  /**
   * Reset the generator to initial state with given seed.
   * @param seed The seed to reset to
   */
  reset(seed: number = 42): void {
    this.state = seed;
  }
  
  /**
   * Get current state value (for serialization/debugging).
   */
  getState(): number {
    return this.state;
  }
  
  /**
   * Set state directly (for deserialization).
   */
  setState(state: number): void {
    this.state = state;
  }
  
  /**
   * Generate next random number in [0, 1).
   */
  random(): number {
    let t = this.state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  
  /**
   * Generate random integer in [min, max] (inclusive).
   */
  randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }
  
  /**
   * Generate random boolean with given probability of true.
   * @param p Probability of returning true (default: 0.5)
   */
  randomBoolean(p: number = 0.5): boolean {
    return this.random() < p;
  }
  
  /**
   * Generate random float in [min, max).
   */
  randomFloat(min: number, max: number): number {
    return min + this.random() * (max - min);
  }
  
  /**
   * Pick random element from array.
   */
  randomChoice<T>(array: T[]): T {
    return array[Math.floor(this.random() * array.length)];
  }
  
  /**
   * Shuffle array in place using Fisher-Yates algorithm.
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
  
  /**
   * Pick n random elements from array without replacement.
   */
  sample<T>(array: T[], n: number): T[] {
    const result: T[] = [];
    const copy = [...array];
    const sampleSize = Math.min(n, array.length);
    
    for (let i = 0; i < sampleSize; i++) {
      const idx = Math.floor(this.random() * copy.length);
      result.push(copy.splice(idx, 1)[0]);
    }
    
    return result;
  }
  
  /**
   * Gaussian/Normal distribution using Box-Muller transform.
   */
  randomGaussian(mean: number = 0, stdDev: number = 1): number {
    const u1 = this.random();
    const u2 = this.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stdDev;
  }
  
  /**
   * Bernoulli trial with noise: returns 1 + noise where noise is uniform [-0.5, 0.5] * factor.
   */
  noise(factor: number = 0.1): number {
    return 1 + (this.random() - 0.5) * factor;
  }
}

// ==================== Global Instance ====================

/**
 * Default global deterministic random instance.
 * Default seed is 42 for reproducibility.
 */
export const DEFAULT_SEED = 42;

const globalRandom = new DeterministicRandom(DEFAULT_SEED);

/**
 * Get the global deterministic random instance.
 * Useful for modules that need shared randomness.
 */
export function getGlobalRandom(): DeterministicRandom {
  return globalRandom;
}

/**
 * Reset the global random generator with a new seed.
 */
export function resetGlobalRandom(seed: number = DEFAULT_SEED): void {
  globalRandom.reset(seed);
}

// ==================== Convenient Functions ====================

/**
 * Global random function using the shared instance.
 */
export function deterministicRandom(): number {
  return globalRandom.random();
}

/**
 * Global randomInt function.
 */
export function deterministicRandomInt(min: number, max: number): number {
  return globalRandom.randomInt(min, max);
}

/**
 * Global randomBoolean function.
 */
export function deterministicRandomBoolean(p: number = 0.5): boolean {
  return globalRandom.randomBoolean(p);
}

/**
 * Global randomFloat function.
 */
export function deterministicRandomFloat(min: number, max: number): number {
  return globalRandom.randomFloat(min, max);
}

/**
 * Global randomChoice function.
 */
export function deterministicRandomChoice<T>(array: T[]): T {
  return globalRandom.randomChoice(array);
}

/**
 * Global noise function with configurable factor.
 */
export function deterministicNoise(factor: number = 0.1): number {
  return globalRandom.noise(factor);
}
