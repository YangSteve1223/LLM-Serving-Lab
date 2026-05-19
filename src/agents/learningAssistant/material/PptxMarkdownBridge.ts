import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PptxMarkdownBridgeResult = {
  markdownPath: string;
  metadataPath?: string;
  summaryPath?: string;
  outputDir: string;
  engine: "external-pptx2md";
  stdout?: string;
  stderr?: string;
};

export type PptxMarkdownBridgeOptions = {
  workspaceRoot?: string;
  outputRoot?: string;
  mode?: "auto" | "external" | "off";
  pythonCommand?: string;
  toolRoot?: string;
  timeoutMs?: number;
};

export async function tryConvertPptxToMarkdown(
  pptxPath: string,
  options: PptxMarkdownBridgeOptions = {}
): Promise<PptxMarkdownBridgeResult | undefined> {
  const mode = options.mode ?? normalizeMode(process.env.PPTX2MD_MODE);
  if (mode === "off") return undefined;

  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const toolRoot = path.resolve(options.toolRoot ?? process.env.PPTX2MD_ROOT ?? path.join(workspaceRoot, "pptx2md", "pptx2md"));
  const cliPath = path.join(toolRoot, "src", "pptx2md", "cli.py");
  const outputRoot = path.resolve(options.outputRoot ?? path.join(workspaceRoot, "reports", "pptx2md-cache"));
  const inputPath = path.resolve(pptxPath);
  const outputDir = path.join(outputRoot, cacheName(inputPath));

  assertInside(workspaceRoot, toolRoot, "pptx2md tool root");
  assertInside(workspaceRoot, outputRoot, "pptx2md output root");

  try {
    await fs.access(cliPath);
  } catch (error) {
    if (mode === "external") throw new Error(`pptx2md CLI was not found at ${cliPath}`);
    return undefined;
  }

  await fs.mkdir(outputDir, { recursive: true });

  const pythonCommand = options.pythonCommand ?? process.env.PPTX2MD_PYTHON ?? "python";
  const env = {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONPATH: joinPythonPath(path.join(toolRoot, "src"), process.env.PYTHONPATH)
  };

  try {
    const { stdout, stderr } = await execFileAsync(
      pythonCommand,
      ["-m", "pptx2md.cli", "convert", inputPath, "-o", outputDir],
      {
        cwd: toolRoot,
        env,
        timeout: options.timeoutMs ?? 120_000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      }
    );

    const markdownPath = path.join(outputDir, "out.md");
    await fs.access(markdownPath);

    return {
      markdownPath,
      metadataPath: await optionalPath(path.join(outputDir, "metadata.json")),
      summaryPath: await optionalPath(path.join(outputDir, "slide_summaries.md")),
      outputDir,
      engine: "external-pptx2md",
      stdout,
      stderr
    };
  } catch (error) {
    if (mode === "external") {
      const message = error instanceof Error ? error.message : "unknown pptx2md failure";
      throw new Error(`pptx2md external conversion failed: ${message}`);
    }
    return undefined;
  }
}

function normalizeMode(value: string | undefined): "auto" | "external" | "off" {
  if (value === "external" || value === "off") return value;
  return "auto";
}

function joinPythonPath(extraPath: string, existing?: string): string {
  return existing ? `${extraPath}${path.delimiter}${existing}` : extraPath;
}

async function optionalPath(filePath: string): Promise<string | undefined> {
  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    return undefined;
  }
}

function cacheName(filePath: string): string {
  const parsed = path.parse(filePath);
  const stamp = Buffer.from(filePath).toString("base64url").slice(0, 16);
  const name = parsed.name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 64) || "deck";
  return `${name}-${stamp}`;
}

function assertInside(rootDir: string, targetPath: string, label: string): void {
  const relative = path.relative(rootDir, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to use ${label} outside workspace: ${targetPath}`);
  }
}
