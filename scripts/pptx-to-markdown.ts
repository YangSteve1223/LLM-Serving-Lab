import { promises as fs } from "node:fs";
import path from "node:path";
import { pptxToMarkdown } from "../src/agents/learningAssistant/material/pptxToMarkdown.ts";

const [, , inputPath, outputPathArg] = process.argv;
const rootDir = process.cwd();

if (!inputPath) {
  console.error("Usage: node scripts/pptx-to-markdown.ts <input.pptx> [output.md]");
  process.exit(1);
}

const resolvedInput = path.resolve(inputPath);
assertInside(rootDir, resolvedInput, "input file");
const outputPath =
  outputPathArg ??
  path.join(
    path.dirname(resolvedInput),
    `${path.basename(resolvedInput, path.extname(resolvedInput))}.learning-material.md`
  );
const resolvedOutput = path.resolve(outputPath);
assertInside(rootDir, resolvedOutput, "output file");

const result = await pptxToMarkdown({
  type: "pptx",
  filePath: resolvedInput,
  metadata: {
    workspaceRoot: rootDir
  }
});

await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
await fs.writeFile(resolvedOutput, result.markdown, "utf8");

console.log(
  JSON.stringify(
    {
      input: resolvedInput,
      output: resolvedOutput,
      title: result.material.title,
      pageCount: result.material.pageCount,
      parser: result.material.metadata?.parser ?? "unknown"
    },
    null,
    2
  )
);

function assertInside(root: string, target: string, label: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to use ${label} outside workspace: ${target}`);
  }
}
