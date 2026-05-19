import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LearningMaterialInput, SlidePreview, SlidePreviewManifest } from "../types.ts";
import type { SlideRenderer } from "./SlideRenderer.ts";
import { unavailablePreview } from "./SlideRenderer.ts";

export type PowerPointComSlideRendererOptions = {
  rootDir: string;
  cacheRoot?: string;
  width?: number;
  height?: number;
};

export class PowerPointComSlideRenderer implements SlideRenderer {
  readonly rendererName = "powerpoint-com";
  private rootDir: string;
  private cacheRoot: string;
  private width: number;
  private height: number;

  constructor(options: PowerPointComSlideRendererOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.cacheRoot = path.resolve(options.cacheRoot ?? path.join(this.rootDir, ".cache", "slide-previews"));
    this.width = options.width ?? 1280;
    this.height = options.height ?? 720;
  }

  async canRender(input: LearningMaterialInput): Promise<boolean> {
    if (!isPptxInput(input)) return false;
    try {
      const output = await runPowerShell(powerPointProbeScript());
      return /ready/i.test(output);
    } catch {
      return false;
    }
  }

  async renderPage(input: LearningMaterialInput, pageIndex: number): Promise<SlidePreview> {
    const manifest = await this.renderDeck(input);
    return manifest.previews.find((preview) => preview.pageIndex === pageIndex) ?? unavailablePreview(materialIdFromInput(input), pageIndex, manifest.error);
  }

  async renderDeck(input: LearningMaterialInput): Promise<SlidePreviewManifest> {
    if (!isPptxInput(input) || !input.filePath) {
      return failedManifest(input, this.rendererName, "PowerPoint COM renderer requires a .pptx file path.");
    }

    const filePath = path.resolve(input.filePath);
    try {
      assertInside(this.rootDir, filePath);
    } catch (error) {
      return failedManifest(input, this.rendererName, error instanceof Error ? error.message : "PPTX path is outside the workspace.");
    }

    const materialId = materialIdFromInput(input);
    try {
      const cacheInfo = await this.cacheInfo(filePath, materialId);
      const cached = await readUsableManifest(cacheInfo.manifestPath, cacheInfo.sourceFileHash);
      if (cached) return withPublicMaterialId(cached, materialId);

      await fs.mkdir(cacheInfo.cacheDir, { recursive: true });
      const resultText = await runPowerShell(
        exportDeckScript({
          inputPath: filePath,
          outDir: cacheInfo.cacheDir,
          width: this.width,
          height: this.height
        })
      );
      const result = parsePowerPointResult(resultText);
      const previews = Array.from({ length: result.pageCount }, (_, index) => {
        const pageIndex = index + 1;
        const imagePath = path.join(cacheInfo.cacheDir, `slide-${String(pageIndex).padStart(3, "0")}.png`);
        return {
          materialId,
          pageIndex,
          imagePath,
          width: this.width,
          height: this.height,
          format: "png" as const,
          status: "ready" as const,
          generatedAt: cacheInfo.generatedAt
        };
      });
      const manifest: SlidePreviewManifest = {
        materialId,
        filePath,
        pageCount: result.pageCount,
        previews,
        cacheDir: cacheInfo.cacheDir,
        rendererName: this.rendererName,
        status: previews.length === result.pageCount ? "ready" : "partial",
        generatedAt: cacheInfo.generatedAt,
        sourceFileHash: cacheInfo.sourceFileHash
      };
      await fs.writeFile(cacheInfo.manifestPath, JSON.stringify(manifest, null, 2), "utf8");
      return manifest;
    } catch (error) {
      const message = error instanceof Error ? error.message : "PowerPoint COM export failed.";
      const pageCount = Number(input.metadata?.pageCount ?? 0);
      return {
        materialId,
        filePath,
        pageCount,
        previews: Array.from({ length: pageCount }, (_, index) => unavailablePreview(materialId, index + 1, message)),
        rendererName: this.rendererName,
        status: "failed",
        error: message,
        generatedAt: new Date().toISOString()
      };
    }
  }

  private async cacheInfo(filePath: string, materialId: string) {
    const stat = await fs.stat(filePath);
    const sourceFileHash = createHash("sha1")
      .update(filePath)
      .update(String(stat.size))
      .update(String(stat.mtimeMs))
      .digest("hex");
    const cacheDir = path.join(this.cacheRoot, sourceFileHash);
    return {
      materialId,
      sourceFileHash,
      cacheDir,
      manifestPath: path.join(cacheDir, "manifest.json"),
      generatedAt: new Date().toISOString()
    };
  }
}

async function readUsableManifest(manifestPath: string, sourceFileHash: string): Promise<SlidePreviewManifest | undefined> {
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as SlidePreviewManifest;
    if (manifest.sourceFileHash !== sourceFileHash) return undefined;
    if (manifest.status === "failed") return undefined;
    const checks = await Promise.all(
      manifest.previews
        .filter((preview) => preview.status === "ready" && preview.imagePath)
        .map(async (preview) => {
          try {
            await fs.access(preview.imagePath!);
            return true;
          } catch {
            return false;
          }
        })
    );
    return checks.every(Boolean) ? manifest : undefined;
  } catch {
    return undefined;
  }
}

function parsePowerPointResult(text: string): { pageCount: number } {
  const trimmed = text.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) throw new Error(`PowerPoint export returned no JSON: ${trimmed.slice(0, 200)}`);
  const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
  const pageCount = Number(parsed.pageCount ?? parsed.PageCount ?? 0);
  if (!Number.isFinite(pageCount) || pageCount <= 0) throw new Error("PowerPoint export returned an invalid page count.");
  return { pageCount };
}

function powerPointProbeScript(): string {
  return `
$ErrorActionPreference = 'Stop'
$pp = $null
try {
  $pp = New-Object -ComObject PowerPoint.Application
  Write-Output 'ready'
} finally {
  if ($pp -ne $null) { $pp.Quit() | Out-Null }
}
`;
}

function exportDeckScript(input: { inputPath: string; outDir: string; width: number; height: number }): string {
  return `
$ErrorActionPreference = 'Stop'
$inputPath = ${psString(input.inputPath)}
$outDir = ${psString(input.outDir)}
$width = ${input.width}
$height = ${input.height}
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$pp = $null
$presentation = $null
try {
  $pp = New-Object -ComObject PowerPoint.Application
  $presentation = $pp.Presentations.Open($inputPath, $true, $true, $false)
  $count = $presentation.Slides.Count
  for ($i = 1; $i -le $count; $i++) {
    $target = Join-Path $outDir ("slide-{0:D3}.png" -f $i)
    $presentation.Slides.Item($i).Export($target, 'PNG', $width, $height)
  }
  [pscustomobject]@{ pageCount = $count } | ConvertTo-Json -Compress
} finally {
  if ($presentation -ne $null) { $presentation.Close() | Out-Null }
  if ($pp -ne $null) { $pp.Quit() | Out-Null }
}
`;
}

function psString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function runPowerShell(script: string): Promise<string> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
    });
  });
}

function isPptxInput(input: LearningMaterialInput): boolean {
  return input.type === "pptx" || Boolean(input.filePath?.toLowerCase().endsWith(".pptx"));
}

function materialIdFromInput(input: LearningMaterialInput): string {
  return input.metadata?.materialId?.toString() || (input.filePath ? path.basename(input.filePath, path.extname(input.filePath)) : "pptx-material");
}

function failedManifest(input: LearningMaterialInput, rendererName: string, error: string): SlidePreviewManifest {
  const materialId = materialIdFromInput(input);
  const pageCount = Number(input.metadata?.pageCount ?? 0);
  return {
    materialId,
    filePath: input.filePath,
    pageCount,
    previews: Array.from({ length: pageCount }, (_, index) => unavailablePreview(materialId, index + 1, error)),
    rendererName,
    status: "failed",
    error,
    generatedAt: new Date().toISOString()
  };
}

function withPublicMaterialId(manifest: SlidePreviewManifest, materialId: string): SlidePreviewManifest {
  return {
    ...manifest,
    materialId,
    previews: manifest.previews.map((preview) => ({ ...preview, materialId }))
  };
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to render a PPTX outside workspace: ${target}`);
  }
}
