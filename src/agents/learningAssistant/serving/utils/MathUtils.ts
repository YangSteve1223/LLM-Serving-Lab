/**
 * Math Utility Functions
 * Shared utilities for numerical operations across serving modules.
 */

/**
 * Round a number to specified decimal places.
 */
export function round(value: number, decimals: number = 2): number {
  return Number(value.toFixed(decimals));
}

/**
 * Calculate the percentile of a sorted array.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p / 100);
  return sorted[Math.min(idx, sorted.length - 1)];
}
