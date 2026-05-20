/**
 * Safe in-memory/JSONL request trace store.
 *
 * The store is intentionally lossy and privacy-preserving: it keeps hashes,
 * counts, modes, and aggregate timing, but not raw prompts, raw answers, or keys.
 */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ServingPhaseTrace } from "./ServingTrace.ts";

export type RequestTraceStoreOptions = {
  limit?: number;
  tracePath?: string;
  enabledJsonl?: boolean;
};

export class RequestTraceStore {
  private traces: ServingPhaseTrace[] = [];
  private limit: number;
  private tracePath?: string;
  private enabledJsonl: boolean;

  constructor(options: RequestTraceStoreOptions = {}) {
    this.limit = options.limit ?? 200;
    this.tracePath = options.tracePath ?? process.env.SERVING_TRACE_PATH;
    this.enabledJsonl = options.enabledJsonl ?? Boolean(this.tracePath);
  }

  async add(trace: ServingPhaseTrace): Promise<void> {
    const sanitized = sanitizeTrace(trace);
    this.traces.push(sanitized);
    if (this.traces.length > this.limit) this.traces.splice(0, this.traces.length - this.limit);
    if (this.enabledJsonl && this.tracePath) {
      await fs.mkdir(path.dirname(this.tracePath), { recursive: true });
      await fs.appendFile(this.tracePath, `${JSON.stringify(sanitized)}\n`, "utf8");
    }
  }

  list(options: { limit?: number } = {}): ServingPhaseTrace[] {
    const count = Math.min(options.limit ?? this.limit, this.traces.length);
    return this.traces.slice(-count).reverse();
  }

  clear(): void {
    this.traces = [];
  }
}

export function createQueryHash(query: string): string {
  return createHash("sha256").update(query).digest("hex");
}

export function createRequestId(): string {
  return randomUUID();
}

export function sanitizeTrace(trace: ServingPhaseTrace): ServingPhaseTrace {
  return JSON.parse(JSON.stringify(trace)) as ServingPhaseTrace;
}
