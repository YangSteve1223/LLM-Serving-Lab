from __future__ import annotations

from pathlib import Path
import json


def _clean_point(line: str) -> str:
    line = line.strip()
    if line.startswith("- "):
        line = line[2:].strip()
    return line


def _collect_key_points(slide, max_points: int = 6) -> list[str]:
    points: list[str] = []

    for block in slide.blocks:
        if block.is_filtered:
            continue
        if block.block_type != "text":
            continue
        if block.role_hint in {"title", "title_like"}:
            continue
        if not block.text:
            continue

        for line in block.text.splitlines():
            cleaned = _clean_point(line)
            if not cleaned:
                continue
            if cleaned not in points:
                points.append(cleaned)
            if len(points) >= max_points:
                return points

    return points


class SummaryRenderer:
    @staticmethod
    def write_json(path: Path, data: dict | list) -> None:
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

    @staticmethod
    def write_text(path: Path, content: str) -> None:
        path.write_text(content, encoding="utf-8")

    @staticmethod
    def build_slide_summaries_json(document) -> dict:
        slides: list[dict] = []

        for slide in document.slides:
            image_count = sum(1 for b in slide.blocks if b.block_type == "image" and not b.is_filtered)
            gif_count = sum(
                1 for b in slide.blocks
                if b.block_type == "image" and not b.is_filtered and b.extra.get("media_kind") == "gif"
            )
            video_count = sum(1 for b in slide.blocks if b.block_type == "video" and not b.is_filtered)
            table_count = sum(1 for b in slide.blocks if b.block_type == "table" and not b.is_filtered)
            chart_count = sum(1 for b in slide.blocks if b.block_type == "chart" and not b.is_filtered)
            key_points = _collect_key_points(slide)

            slides.append({
                "slide_index": slide.slide_index,
                "title": slide.title,
                "title_detected": slide.title_detected,
                "layout_name": slide.layout_name,
                "has_notes": bool(slide.notes_text),
                "image_count": image_count,
                "gif_count": gif_count,
                "video_count": video_count,
                "table_count": table_count,
                "chart_count": chart_count,
                "key_points": key_points
            })

        return {
            "slide_count": len(document.slides),
            "slides": slides
        }

    @staticmethod
    def build_slide_summaries_markdown(document_title: str, document) -> str:
        lines: list[str] = []
        lines.append(f"# {document_title} - Slide Summaries")
        lines.append("")

        for slide in document.slides:
            image_count = sum(1 for b in slide.blocks if b.block_type == "image" and not b.is_filtered)
            gif_count = sum(
                1 for b in slide.blocks
                if b.block_type == "image" and not b.is_filtered and b.extra.get("media_kind") == "gif"
            )
            video_count = sum(1 for b in slide.blocks if b.block_type == "video" and not b.is_filtered)
            table_count = sum(1 for b in slide.blocks if b.block_type == "table" and not b.is_filtered)
            chart_count = sum(1 for b in slide.blocks if b.block_type == "chart" and not b.is_filtered)
            key_points = _collect_key_points(slide)

            lines.append(f"## Slide {slide.slide_index}")
            lines.append("")
            lines.append(f"- title: {slide.title or '(none)'}")
            lines.append(f"- has_notes: {bool(slide.notes_text)}")
            lines.append(f"- image_count: {image_count}")
            lines.append(f"- gif_count: {gif_count}")
            lines.append(f"- video_count: {video_count}")
            lines.append(f"- table_count: {table_count}")
            lines.append(f"- chart_count: {chart_count}")
            lines.append("")
            lines.append("### Key Points")

            if key_points:
                for point in key_points:
                    lines.append(f"- {point}")
            else:
                lines.append("- (no key points extracted)")

            lines.append("")

        return "\n".join(lines).strip() + "\n"