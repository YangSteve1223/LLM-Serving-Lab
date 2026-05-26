/**
 * Simulation Constants
 * 
 * Centralized constants for delay/simulation timing calculations.
 * These values represent per-token processing delays in milliseconds.
 */

/**
 * Prefill phase: ~0.18ms per token (very fast, highly parallel)
 */
export const SIMULATION_CONSTANTS = {
  PREFILL_MS_PER_TOKEN: 0.18,
  DECODE_MS_PER_TOKEN: 21,    // Calibrated: DeepSeek-chat ~45 tokens/s (1000/21≈47.6)
  BASE_PREFILL_OVERHEAD_MS: 25,
  BASE_DECODE_OVERHEAD_MS: 10,
} as const;
