/**
 * Approximate simulator calibration from real benchmark output.
 *
 * Calibration is intentionally conservative: observed streaming metrics can
 * suggest coefficients, but they do not prove real PD behavior without an
 * actual disaggregated engine.
 */
import { promises as fs } from "node:fs";
import type { PDSimulationConfig } from "./ServingTrace.ts";
import type { EngineBenchmarkReport } from "./engines/EngineBenchmarkTypes.ts";

export type SimulatorCalibrationSuggestion = {
  prefillMsPerToken?: number;
  decodeMsPerToken?: number;
  kvMsPerToken?: number;
  confidence: "low" | "medium" | "high";
  notes: string[];
};

export class SimulatorCalibrator {
  async calibrateFromFile(filePath: string): Promise<SimulatorCalibrationSuggestion> {
    const report = JSON.parse(await fs.readFile(filePath, "utf8")) as EngineBenchmarkReport;
    return this.calibrate(report);
  }

  calibrate(report: EngineBenchmarkReport): SimulatorCalibrationSuggestion {
    const usable = report.summaries.filter((summary) => summary.requests > 0);
    const full = usable.find((summary) => summary.policy === "full") ?? usable[0];
    const avgPromptTokens = full?.promptTokensAvg;
    const ttft = full?.ttftP50 ?? full?.ttftP90;
    const itl = full?.itlP50 ?? full?.itlP90;
    const notes = [
      "Calibration is approximate: prompt tokens and completion tokens may come from heuristic or provider usage fields.",
      "Observed TTFT includes network, queueing, scheduling, and prefill effects; it is not pure prefill kernel time."
    ];
    const suggestion: SimulatorCalibrationSuggestion = {
      confidence: full?.ttftP50 && full.itlP50 ? "medium" : "low",
      notes
    };
    if (avgPromptTokens && ttft) suggestion.prefillMsPerToken = round(Math.max(0.001, ttft / Math.max(1, avgPromptTokens)));
    if (itl) suggestion.decodeMsPerToken = round(Math.max(0.001, itl));
    const cacheFirst = usable.find((summary) => summary.policy === "cache_first");
    if (cacheFirst?.nixlBytesTransferredDelta && cacheFirst.cachedPromptTokensDelta) {
      suggestion.kvMsPerToken = round(Math.max(0.001, cacheFirst.nixlBytesTransferredDelta / Math.max(1, cacheFirst.cachedPromptTokensDelta) / 1_000_000));
      suggestion.notes.push("KV transfer coefficient was estimated from NIXL bytes and cached prompt token deltas.");
    }
    return suggestion;
  }
}

export function applyCalibration(config: PDSimulationConfig, calibration: SimulatorCalibrationSuggestion): PDSimulationConfig {
  return {
    ...config,
    prefillMsPerToken: calibration.prefillMsPerToken ?? config.prefillMsPerToken,
    decodeMsPerToken: calibration.decodeMsPerToken ?? config.decodeMsPerToken,
    kvMsPerToken: calibration.kvMsPerToken ?? config.kvMsPerToken
  };
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
