/**
 * Minimal SSE parser for OpenAI-compatible streaming responses.
 *
 * Streaming is the only way this project can observe client-side TTFT/ITL; full
 * response fallback records wall-clock latency but must not invent token timing.
 */
export type SSEEvent = {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
};

export class SSEParser {
  private buffer = "";

  push(chunk: string): SSEEvent[] {
    this.buffer += chunk;
    const events: SSEEvent[] = [];
    let boundary = findEventBoundary(this.buffer);
    while (boundary >= 0) {
      const raw = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary).replace(/^(\r?\n){2}/, "");
      const event = parseSSEEvent(raw);
      if (event) events.push(event);
      boundary = findEventBoundary(this.buffer);
    }
    return events;
  }

  flush(): SSEEvent[] {
    const raw = this.buffer;
    this.buffer = "";
    const event = parseSSEEvent(raw);
    return event ? [event] : [];
  }
}

export function parseSSEEvent(raw: string): SSEEvent | undefined {
  const lines = raw.split(/\r?\n/);
  const data: string[] = [];
  const event: SSEEvent = { data: "" };
  for (const line of lines) {
    if (!line.trim() || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator >= 0 ? line.slice(0, separator).trim() : line.trim();
    const value = separator >= 0 ? line.slice(separator + 1).replace(/^ /, "") : "";
    if (field === "data") data.push(value);
    else if (field === "event") event.event = value;
    else if (field === "id") event.id = value;
    else if (field === "retry") {
      const retry = Number(value);
      if (Number.isFinite(retry)) event.retry = retry;
    }
  }
  if (data.length === 0 && !event.event && !event.id) return undefined;
  event.data = data.join("\n");
  return event;
}

export function isDoneEvent(event: SSEEvent): boolean {
  return event.data.trim() === "[DONE]";
}

function findEventBoundary(text: string): number {
  const lf = text.indexOf("\n\n");
  const crlf = text.indexOf("\r\n\r\n");
  if (lf < 0) return crlf;
  if (crlf < 0) return lf;
  return Math.min(lf, crlf);
}
