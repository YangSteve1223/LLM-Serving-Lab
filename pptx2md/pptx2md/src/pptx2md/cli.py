from __future__ import annotations

from pathlib import Path
from datetime import datetime
import hashlib
import json
import re
import shutil

import typer

from pptx2md import __version__
from pptx2md.extractors.presentation_extractor import PresentationExtractor
from pptx2md.renderers.debug_renderer import DebugRenderer
from pptx2md.renderers.summary_renderer import SummaryRenderer
from pptx2md.stats.content_profile import build_content_profile
from pptx2md.validators.metadata_validator import MetadataValidator
from pptx2md.normalizers.title_utils import clean_title_text

app = typer.Typer(
    help="PPTX to Markdown CLI tool",
    no_args_is_help=True
)


def ensure_output_dir(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)


def write_text_file(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def write_json_file(path: Path, data: dict | list) -> None:
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def sha256_of_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def build_document_id(file_hash: str) -> str:
    date_str = datetime.now().strftime("%Y%m%d")
    return f"doc_{date_str}_{file_hash[:8]}"


def build_task_id() -> str:
    return f"task_{datetime.now().strftime('%Y%m%d_%H%M%S')}"


def get_project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def get_default_schema_path() -> Path:
    return get_project_root() / "spec" / "metadata.schema.json"


def sanitize_name(name: str) -> str:
    name = re.sub(r"[^\w\u4e00-\u9fff-]+", "_", name.strip())
    name = re.sub(r"_+", "_", name).strip("_")
    return name or "document"


def pad_rows(rows: list[list[str]]) -> list[list[str]]:
    if not rows:
        return rows
    max_cols = max(len(r) for r in rows)
    return [r + [""] * (max_cols - len(r)) for r in rows]


def render_markdown_table(rows: list[list[str]]) -> list[str]:
    if not rows:
        return ["(Empty table)"]

    rows = pad_rows(rows)
    header = rows[0]
    body = rows[1:]

    lines: list[str] = []
    lines.append("| " + " | ".join(header) + " |")
    lines.append("| " + " | ".join(["---"] * len(header)) + " |")

    for row in body:
        lines.append("| " + " | ".join(row) + " |")

    return lines


def render_image_markdown(block) -> list[str]:
    rel_path = block.extra.get("image_rel_path", "")
    media_kind = block.extra.get("media_kind", "image")
    base_alt = block.shape_name or Path(rel_path).stem or "image"

    if media_kind == "gif":
        return [f"![GIF: {base_alt}]({rel_path})"]

    return [f"![{base_alt}]({rel_path})"]


def render_chart_markdown(block) -> list[str]:
    chart_type = block.extra.get("chart_type")
    chart_title = block.extra.get("chart_title")
    categories = block.extra.get("categories", [])
    series = block.extra.get("series", [])

    lines: list[str] = []
    lines.append("- chart")

    if chart_type:
        lines.append(f"  - chart_type: {chart_type}")

    if chart_title:
        lines.append(f"  - title: {chart_title}")

    if categories:
        lines.append("  - categories: " + ", ".join(str(x) for x in categories))

    if series:
        lines.append("  - series:")
        for s in series:
            name = s.get("name", "")
            values = s.get("values", [])
            lines.append(f"    - {name}: {values}")

    return lines


def render_video_markdown(block) -> list[str]:
    media_rel_path = block.extra.get("media_rel_path")
    poster_rel_path = block.extra.get("poster_rel_path")
    external_target = block.extra.get("external_target")
    mime_type = block.extra.get("mime_type")
    display_name = block.shape_name or "video"

    lines: list[str] = []

    if poster_rel_path:
        lines.append(f"![{display_name} poster]({poster_rel_path})")

    if media_rel_path:
        lines.append(f"[视频文件：{display_name}]({media_rel_path})")
    elif external_target:
        lines.append(f"[视频链接：{display_name}]({external_target})")
    else:
        lines.append(f"- 视频：{display_name}")

    if mime_type:
        lines.append(f"- mime_type: {mime_type}")

    return lines


def is_dense_media_slide(slide) -> bool:
    text_blocks = [
        b for b in slide.blocks
        if not b.is_filtered and b.block_type == "text" and b.text and b.role_hint not in {"title", "title_like"}
    ]
    media_blocks = [
        b for b in slide.blocks
        if not b.is_filtered and b.block_type in {"image", "video"}
    ]
    return len(text_blocks) >= 4 and len(media_blocks) >= 4


def build_markdown(document_title: str, document) -> str:
    lines: list[str] = []
    lines.append(f"# {document_title}")
    lines.append("")
    lines.append("当前为批量增强版本（文本 + GIF/图片 + 视频 + 表格 + 图表 + Notes + 统计 + 校验 + 子命令 + 目录批量转换）。")
    lines.append("")

    for slide in document.slides:
        lines.append(f"## Slide {slide.slide_index}")
        lines.append("")

        if slide.title_detected and slide.title:
            lines.append("### Title")
            lines.append(clean_title_text(slide.title))
            lines.append("")

        text_blocks = [
            block for block in slide.blocks
            if not block.is_filtered
            and block.block_type == "text"
            and block.text
            and block.role_hint not in {"title", "title_like"}
        ]
        image_blocks = [
            block for block in slide.blocks
            if not block.is_filtered and block.block_type == "image"
        ]
        video_blocks = [
            block for block in slide.blocks
            if not block.is_filtered and block.block_type == "video"
        ]
        table_blocks = [
            block for block in slide.blocks
            if not block.is_filtered and block.block_type == "table"
        ]
        chart_blocks = [
            block for block in slide.blocks
            if not block.is_filtered and block.block_type == "chart"
        ]

        if is_dense_media_slide(slide):
            lines.append("### Main Content")
            if text_blocks:
                for block in text_blocks:
                    lines.append(block.text)
                    lines.append("")
            else:
                lines.append("(No text extracted)")
                lines.append("")

            if image_blocks or video_blocks:
                lines.append("### Media")
                for block in image_blocks + video_blocks:
                    if block.block_type == "image":
                        lines.extend(render_image_markdown(block))
                    else:
                        lines.extend(render_video_markdown(block))
                    lines.append("")

            if table_blocks:
                lines.append("### Tables")
                for block in table_blocks:
                    rows = block.extra.get("rows", [])
                    lines.extend(render_markdown_table(rows))
                    lines.append("")

            if chart_blocks:
                lines.append("### Charts")
                for block in chart_blocks:
                    lines.extend(render_chart_markdown(block))
                    lines.append("")
        else:
            lines.append("### Main Content")

            content_blocks = [
                block for block in slide.blocks
                if not block.is_filtered
                and (
                    (block.block_type == "text" and block.text and block.role_hint not in {"title", "title_like"})
                    or block.block_type in {"image", "video", "table", "chart"}
                )
            ]

            if content_blocks:
                for block in content_blocks:
                    if block.block_type == "text":
                        lines.append(block.text)
                        lines.append("")
                    elif block.block_type == "image":
                        lines.extend(render_image_markdown(block))
                        lines.append("")
                    elif block.block_type == "video":
                        lines.extend(render_video_markdown(block))
                        lines.append("")
                    elif block.block_type == "table":
                        rows = block.extra.get("rows", [])
                        lines.extend(render_markdown_table(rows))
                        lines.append("")
                    elif block.block_type == "chart":
                        lines.extend(render_chart_markdown(block))
                        lines.append("")
            else:
                lines.append("(No content extracted)")
                lines.append("")

        if slide.notes_text:
            lines.append("### Notes")
            lines.append(slide.notes_text)
            lines.append("")

    return "\n".join(lines).strip() + "\n"


def build_metadata(document, input_file: Path, markdown_content: str) -> dict:
    file_hash = sha256_of_file(input_file)
    document_id = build_document_id(file_hash)
    task_id = build_task_id()
    now = datetime.now().astimezone().isoformat()

    has_speaker_notes = any(slide.notes_text for slide in document.slides)

    table_shape_count = sum(
        1 for slide in document.slides for block in slide.blocks
        if block.block_type == "table"
    )
    text_shape_count = sum(
        1 for slide in document.slides for block in slide.blocks
        if block.block_type == "text"
    )
    image_shape_count = sum(
        1 for slide in document.slides for block in slide.blocks
        if block.block_type == "image"
    )
    gif_image_count = sum(
        1 for slide in document.slides for block in slide.blocks
        if block.block_type == "image" and block.extra.get("media_kind") == "gif"
    )
    video_shape_count = sum(
        1 for slide in document.slides for block in slide.blocks
        if block.block_type == "video"
    )
    external_video_count = sum(
        1 for slide in document.slides for block in slide.blocks
        if block.block_type == "video" and block.extra.get("external_target")
    )
    chart_shape_count = sum(
        1 for slide in document.slides for block in slide.blocks
        if block.block_type == "chart"
    )

    content_profile = build_content_profile(markdown_content, document)

    return {
        "metadata_version": "1.0.0",
        "document_id": document_id,
        "task_id": task_id,
        "created_at": now,
        "updated_at": now,
        "status": "completed",
        "source": {
            "source_type": "pptx",
            "source_name": input_file.name,
            "source_uri": str(input_file.resolve()),
            "source_id": None,
            "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "file_size_bytes": input_file.stat().st_size,
            "checksum": {
                "algorithm": "sha256",
                "value": file_hash
            },
            "language": ["unknown"],
            "title": input_file.stem,
            "authors": [],
            "published_at": None,
            "collected_at": now,
            "access_method": "local_file",
            "details": {
                "slide_count": len(document.slides),
                "has_speaker_notes": has_speaker_notes,
                "embedded_media_count": image_shape_count + video_shape_count,
                "table_shape_count": table_shape_count,
                "text_shape_count": text_shape_count,
                "image_shape_count": image_shape_count,
                "gif_image_count": gif_image_count,
                "video_shape_count": video_shape_count,
                "external_video_count": external_video_count,
                "chart_shape_count": chart_shape_count
            }
        },
        "output": {
            "format": "markdown",
            "markdown_file": "out.md",
            "assets_dir": "assets/",
            "image_reference_mode": "relative_path",
            "markdown_encoding": "utf-8",
            "markdown_dialect": "commonmark",
            "has_front_matter": False
        },
        "content_profile": content_profile,
        "downstream": {
            "chunking_ready": True,
            "recommended_chunk_strategy": "slide_based",
            "embedding_status": "pending"
        }
    }


def auto_validate_metadata(metadata_path: Path) -> tuple[bool | None, list[str]]:
    schema_path = get_default_schema_path()
    if not schema_path.exists():
        return None, ["Schema file not found"]

    validator = MetadataValidator()
    return validator.validate(metadata_path, schema_path)


def run_convert_pipeline(input_file: Path, output_dir: Path) -> dict:
    ensure_output_dir(output_dir)

    assets_dir = output_dir / "assets"
    debug_dir = output_dir / "debug"

    ensure_output_dir(assets_dir)
    ensure_output_dir(debug_dir)

    markdown_path = output_dir / "out.md"
    metadata_path = output_dir / "metadata.json"
    summary_md_path = output_dir / "slide_summaries.md"
    slide_structure_path = debug_dir / "slide_structure.json"
    warnings_path = debug_dir / "warnings.json"
    slide_summaries_json_path = debug_dir / "slide_summaries.json"

    extractor = PresentationExtractor(assets_dir=assets_dir, pptx_path=input_file)
    document = extractor.extract(input_file)

    markdown_content = build_markdown(
        document_title=input_file.stem,
        document=document,
    )
    write_text_file(markdown_path, markdown_content)

    metadata = build_metadata(document, input_file, markdown_content)
    write_json_file(metadata_path, metadata)

    slide_structure_data = DebugRenderer.build_slide_structure(document)
    warnings_data = DebugRenderer.build_warnings(document)
    slide_summaries_json = SummaryRenderer.build_slide_summaries_json(document)
    slide_summaries_md = SummaryRenderer.build_slide_summaries_markdown(input_file.stem, document)

    DebugRenderer.write_json(slide_structure_path, slide_structure_data)
    DebugRenderer.write_json(warnings_path, warnings_data)
    SummaryRenderer.write_json(slide_summaries_json_path, slide_summaries_json)
    SummaryRenderer.write_text(summary_md_path, slide_summaries_md)

    ok, messages = auto_validate_metadata(metadata_path)

    return {
        "input_file": str(input_file),
        "output_dir": str(output_dir),
        "slide_count": len(document.slides),
        "metadata_path": str(metadata_path),
        "markdown_path": str(markdown_path),
        "summary_md_path": str(summary_md_path),
        "validation_ok": ok,
        "validation_messages": messages,
        "metadata": metadata
    }


def build_batch_report(manifest: dict) -> str:
    lines: list[str] = []
    lines.append("# Batch Conversion Report")
    lines.append("")
    lines.append(f"- input_dir: {manifest['input_dir']}")
    lines.append(f"- recursive: {manifest['recursive']}")
    lines.append(f"- total_files: {manifest['total_files']}")
    lines.append(f"- succeeded: {manifest['succeeded']}")
    lines.append(f"- failed: {manifest['failed']}")
    lines.append("")

    lines.append("## Items")
    lines.append("")

    for item in manifest["items"]:
        lines.append(f"### {item['input_name']}")
        lines.append(f"- status: {item['status']}")
        lines.append(f"- output_dir: {item['output_dir']}")

        if item["status"] == "success":
            lines.append(f"- slide_count: {item['slide_count']}")
            lines.append(f"- image_shape_count: {item['image_shape_count']}")
            lines.append(f"- gif_image_count: {item['gif_image_count']}")
            lines.append(f"- video_shape_count: {item['video_shape_count']}")
            lines.append(f"- has_speaker_notes: {item['has_speaker_notes']}")
            lines.append(f"- validation_ok: {item['validation_ok']}")
        else:
            lines.append(f"- error: {item['error']}")

        lines.append("")

    return "\n".join(lines).strip() + "\n"


def collect_pptx_files(input_dir: Path, recursive: bool) -> list[Path]:
    pattern = "**/*.pptx" if recursive else "*.pptx"
    return sorted(input_dir.glob(pattern))


@app.command("convert")
def convert_cmd(
    input_file: Path = typer.Argument(..., exists=True, readable=True, help="Input .pptx file"),
    output_dir: Path = typer.Option(..., "--output", "-o", help="Output directory"),
) -> None:
    if input_file.suffix.lower() != ".pptx":
        typer.secho("错误：输入文件必须是 .pptx", fg=typer.colors.RED)
        raise typer.Exit(code=1)

    result = run_convert_pipeline(input_file, output_dir)

    ok = result["validation_ok"]
    messages = result["validation_messages"]

    if ok is True:
        typer.secho("Metadata schema validation: PASSED", fg=typer.colors.GREEN)
    elif ok is False:
        typer.secho("Metadata schema validation: FAILED", fg=typer.colors.RED)
        for msg in messages:
            typer.echo(f"- {msg}")
    else:
        typer.secho("Metadata schema validation skipped: schema file not found", fg=typer.colors.YELLOW)

    typer.secho(f"转换完成（版本 {__version__}）", fg=typer.colors.GREEN)
    typer.echo(f"Slides parsed: {result['slide_count']}")
    typer.echo(f"Markdown: {output_dir / 'out.md'}")
    typer.echo(f"Metadata: {output_dir / 'metadata.json'}")
    typer.echo(f"Slide summaries markdown: {output_dir / 'slide_summaries.md'}")
    typer.echo(f"Assets dir: {output_dir / 'assets'}")
    typer.echo(f"Debug slide structure: {output_dir / 'debug' / 'slide_structure.json'}")
    typer.echo(f"Debug warnings: {output_dir / 'debug' / 'warnings.json'}")
    typer.echo(f"Debug slide summaries: {output_dir / 'debug' / 'slide_summaries.json'}")


@app.command("convert-dir")
def convert_dir_cmd(
    input_dir: Path = typer.Argument(..., exists=True, file_okay=False, readable=True, help="Input directory containing .pptx files"),
    output_dir: Path = typer.Option(..., "--output", "-o", help="Output directory for batch conversion"),
    recursive: bool = typer.Option(False, "--recursive", help="Recursively search for .pptx files"),
) -> None:
    files = collect_pptx_files(input_dir, recursive)

    if not files:
        typer.secho("未找到任何 .pptx 文件。", fg=typer.colors.YELLOW)
        raise typer.Exit(code=0)

    ensure_output_dir(output_dir)

    manifest = {
        "created_at": datetime.now().astimezone().isoformat(),
        "input_dir": str(input_dir.resolve()),
        "recursive": recursive,
        "total_files": len(files),
        "succeeded": 0,
        "failed": 0,
        "items": []
    }

    used_names: set[str] = set()

    for file in files:
        base_name = sanitize_name(file.stem)
        unique_name = base_name
        counter = 2
        while unique_name in used_names:
            unique_name = f"{base_name}_{counter}"
            counter += 1
        used_names.add(unique_name)

        doc_output_dir = output_dir / unique_name

        try:
            result = run_convert_pipeline(file, doc_output_dir)
            details = result["metadata"]["source"]["details"]
            manifest["items"].append({
                "input_name": file.name,
                "input_file": str(file.resolve()),
                "output_dir": str(doc_output_dir.resolve()),
                "status": "success",
                "slide_count": details["slide_count"],
                "image_shape_count": details["image_shape_count"],
                "gif_image_count": details["gif_image_count"],
                "video_shape_count": details["video_shape_count"],
                "has_speaker_notes": details["has_speaker_notes"],
                "validation_ok": result["validation_ok"],
            })
            manifest["succeeded"] += 1
            typer.secho(f"[OK] {file.name} -> {doc_output_dir}", fg=typer.colors.GREEN)
        except Exception as e:
            manifest["items"].append({
                "input_name": file.name,
                "input_file": str(file.resolve()),
                "output_dir": str(doc_output_dir.resolve()),
                "status": "failed",
                "error": str(e),
            })
            manifest["failed"] += 1
            typer.secho(f"[FAILED] {file.name}: {e}", fg=typer.colors.RED)

    batch_manifest_path = output_dir / "batch_manifest.json"
    batch_report_path = output_dir / "batch_report.md"

    write_json_file(batch_manifest_path, manifest)
    write_text_file(batch_report_path, build_batch_report(manifest))

    typer.secho("目录批量转换完成。", fg=typer.colors.GREEN)
    typer.echo(f"Batch manifest: {batch_manifest_path}")
    typer.echo(f"Batch report: {batch_report_path}")


@app.command("validate")
def validate_cmd(
    metadata_file: Path = typer.Argument(..., exists=True, readable=True, help="Metadata JSON file"),
    schema: Path | None = typer.Option(None, "--schema", help="Optional schema path"),
) -> None:
    schema_path = schema if schema is not None else get_default_schema_path()

    if not schema_path.exists():
        typer.secho(f"错误：Schema 文件不存在: {schema_path}", fg=typer.colors.RED)
        raise typer.Exit(code=1)

    validator = MetadataValidator()
    ok, messages = validator.validate(metadata_file, schema_path)

    if ok:
        typer.secho("Metadata schema validation: PASSED", fg=typer.colors.GREEN)
        typer.echo(f"Metadata: {metadata_file}")
        typer.echo(f"Schema: {schema_path}")
        raise typer.Exit(code=0)

    typer.secho("Metadata schema validation: FAILED", fg=typer.colors.RED)
    typer.echo(f"Metadata: {metadata_file}")
    typer.echo(f"Schema: {schema_path}")
    for msg in messages:
        typer.echo(f"- {msg}")
    raise typer.Exit(code=1)


if __name__ == "__main__":
    app()