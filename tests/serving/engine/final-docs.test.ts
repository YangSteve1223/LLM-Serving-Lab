import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const requiredDocs = [
  "docs/final-research-report.md",
  "docs/learning-guide.md",
  "docs/pd-serving-lab.md",
  "docs/sota-engine-bridge.md"
];

test("required final docs exist and mention limitations", () => {
  for (const file of requiredDocs) {
    assert.equal(existsSync(file), true, `${file} should exist`);
  }
  const finalReport = readFileSync("docs/final-research-report.md", "utf8");
  assert.match(finalReport, /not a production serving engine/i);
  assert.match(finalReport, /No GPU endpoint/i);
  assert.match(finalReport, /Dry-run latency fields are `n\/a`/i);
});

test("docs state that real metrics require endpoint or GPU-backed engine", () => {
  const bridge = readFileSync("docs/sota-engine-bridge.md", "utf8");
  assert.match(bridge, /endpoint does not stream, TTFT\/ITL remain unavailable/i);
  assert.match(bridge, /`\/metrics` is unavailable/i);
  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /No GPU is required/i);
  assert.match(readme, /Real TTFT\/ITL\/E2E require a streaming endpoint/i);
});
