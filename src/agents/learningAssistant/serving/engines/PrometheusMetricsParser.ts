/**
 * Tiny Prometheus text-format parser.
 *
 * It avoids adding a metrics dependency while supporting the subset of counters,
 * gauges, and histogram samples needed for vLLM/SGLang benchmark reports.
 */
export type PrometheusMetricSample = {
  labels: Record<string, string>;
  value: number;
};

export type PrometheusMetricMap = Map<string, PrometheusMetricSample[]>;

export class PrometheusMetricsParser {
  parse(text: string): PrometheusMetricMap {
    const metrics: PrometheusMetricMap = new Map();
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const parsed = parseMetricLine(line);
      if (!parsed) continue;
      const values = metrics.get(parsed.name) ?? [];
      values.push({ labels: parsed.labels, value: parsed.value });
      metrics.set(parsed.name, values);
    }
    return metrics;
  }
}

export function parseMetricLine(line: string): { name: string; labels: Record<string, string>; value: number } | undefined {
  const match = line.match(/^([^\s{]+)(?:\{([^}]*)\})?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|NaN|\+Inf|-Inf)(?:\s+\d+)?$/);
  if (!match) return undefined;
  const value = Number(match[3].replace("+Inf", "Infinity").replace("-Inf", "-Infinity"));
  if (!Number.isFinite(value) && !["Infinity", "-Infinity"].includes(String(value))) return undefined;
  return {
    name: match[1],
    labels: parseLabels(match[2] ?? ""),
    value
  };
}

function parseLabels(text: string): Record<string, string> {
  const labels: Record<string, string> = {};
  let index = 0;
  while (index < text.length) {
    const keyMatch = text.slice(index).match(/^\s*([A-Za-z_][A-Za-z0-9_]*)="/);
    if (!keyMatch) break;
    const key = keyMatch[1];
    index += keyMatch[0].length;
    let value = "";
    let escaped = false;
    while (index < text.length) {
      const char = text[index];
      index += 1;
      if (escaped) {
        value += char === "n" ? "\n" : char;
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        break;
      } else {
        value += char;
      }
    }
    labels[key] = value;
    if (text[index] === ",") index += 1;
  }
  return labels;
}
