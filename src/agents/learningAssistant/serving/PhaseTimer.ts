/**
 * Small phase timer around performance.now().
 *
 * It keeps observability local to the request path and avoids coupling business
 * logic to a tracing framework.
 */
import { performance } from "node:perf_hooks";

export class PhaseTimer {
  private marks = new Map<string, number>();
  private measures = new Map<string, number>();

  mark(label: string): void {
    this.marks.set(label, performance.now());
  }

  measure(name: string, startLabel: string, endLabel: string): number | undefined {
    const start = this.marks.get(startLabel);
    const end = this.marks.get(endLabel);
    if (start === undefined || end === undefined) return undefined;
    const value = round(end - start);
    this.measures.set(name, value);
    return value;
  }

  measureSince(name: string, startLabel: string): number | undefined {
    const start = this.marks.get(startLabel);
    if (start === undefined) return undefined;
    const value = round(performance.now() - start);
    this.measures.set(name, value);
    return value;
  }

  toJSON(): Record<string, number> {
    return Object.fromEntries(this.measures.entries());
  }
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
