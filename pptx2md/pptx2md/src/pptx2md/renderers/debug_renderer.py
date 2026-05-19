from __future__ import annotations

from pathlib import Path
import json


class DebugRenderer:
    @staticmethod
    def write_json(path: Path, data: dict | list) -> None:
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

    @staticmethod
    def _safe_file_size(path_str: str | None) -> int | None:
        if not path_str:
            return None
        try:
            p = Path(path_str)
            if p.exists():
                return p.stat().st_size
        except Exception:
            return None
        return None

    @staticmethod
    def build_slide_structure(document) -> dict:
        slides_data: list[dict] = []

        for slide in document.slides:
            text_block_count = sum(1 for b in slide.blocks if b.block_type == "text")
            table_block_count = sum(1 for b in slide.blocks if b.block_type == "table")
            image_block_count = sum(1 for b in slide.blocks if b.block_type == "image")
            chart_block_count = sum(1 for b in slide.blocks if b.block_type == "chart")
            video_block_count = sum(1 for b in slide.blocks if b.block_type == "video")
            filtered_block_count = sum(1 for b in slide.blocks if b.is_filtered)

            slide_item = {
                "slide_index": slide.slide_index,
                "slide_id": slide.slide_id,
                "hidden": slide.hidden,
                "layout_name": slide.layout_name,
                "title": slide.title,
                "title_detected": slide.title_detected,
                "notes_text": slide.notes_text,
                "block_count": len(slide.blocks),
                "text_block_count": text_block_count,
                "table_block_count": table_block_count,
                "image_block_count": image_block_count,
                "chart_block_count": chart_block_count,
                "video_block_count": video_block_count,
                "filtered_block_count": filtered_block_count,
                "blocks": []
            }

            for block in slide.blocks:
                slide_item["blocks"].append({
                    "block_id": block.block_id,
                    "block_type": block.block_type,
                    "role_hint": block.role_hint,
                    "shape_id": block.shape_id,
                    "shape_name": block.shape_name,
                    "shape_type": block.shape_type,
                    "placeholder_type": block.placeholder_type,
                    "is_filtered": block.is_filtered,
                    "filter_reason": block.filter_reason,
                    "bbox": {
                        "left": block.left,
                        "top": block.top,
                        "width": block.width,
                        "height": block.height
                    },
                    "z_order": block.z_order,
                    "text": block.text,
                    "extra": block.extra
                })

            slides_data.append(slide_item)

        return {
            "slide_count": len(document.slides),
            "slides": slides_data
        }

    @staticmethod
    def build_warnings(document) -> list[dict]:
        warnings: list[dict] = []

        for slide in document.slides:
            unfiltered_blocks = [b for b in slide.blocks if not b.is_filtered]

            if not unfiltered_blocks and not slide.notes_text:
                warnings.append({
                    "slide_index": slide.slide_index,
                    "level": "warning",
                    "code": "NO_CONTENT_EXTRACTED",
                    "message": "No unfiltered blocks or notes were extracted from this slide."
                })

            if not slide.title_detected:
                warnings.append({
                    "slide_index": slide.slide_index,
                    "level": "warning",
                    "code": "TITLE_NOT_DETECTED",
                    "message": "No title was detected for this slide."
                })

            media_blocks = [b for b in slide.blocks if b.block_type in {"image", "video"} and not b.is_filtered]
            text_blocks = [b for b in slide.blocks if b.block_type == "text" and not b.is_filtered]
            if len(media_blocks) >= 4 and len(text_blocks) >= 4:
                warnings.append({
                    "slide_index": slide.slide_index,
                    "level": "info",
                    "code": "DENSE_MEDIA_SLIDE",
                    "message": "This slide contains many media and text blocks; Markdown may be reorganized for readability."
                })

            for block in slide.blocks:
                if block.is_filtered:
                    warnings.append({
                        "slide_index": slide.slide_index,
                        "level": "info",
                        "code": "FILTERED_BLOCK",
                        "block_id": block.block_id,
                        "shape_id": block.shape_id,
                        "shape_name": block.shape_name,
                        "filter_reason": block.filter_reason,
                        "message": "A block was filtered from Markdown output."
                    })

                if block.block_type == "image":
                    media_kind = block.extra.get("media_kind", "image")
                    image_abs_path = block.extra.get("image_abs_path")
                    image_rel_path = block.extra.get("image_rel_path")
                    image_size = DebugRenderer._safe_file_size(image_abs_path)

                    code = "GIF_EXTRACTED" if media_kind == "gif" else "IMAGE_EXTRACTED"
                    warnings.append({
                        "slide_index": slide.slide_index,
                        "level": "info",
                        "code": code,
                        "block_id": block.block_id,
                        "shape_id": block.shape_id,
                        "shape_name": block.shape_name,
                        "image_rel_path": image_rel_path,
                        "file_size_bytes": image_size,
                        "message": "An image-like block was extracted and written to assets."
                    })

                    if image_size is not None and image_size == 0:
                        warnings.append({
                            "slide_index": slide.slide_index,
                            "level": "warning",
                            "code": "EMPTY_MEDIA_FILE",
                            "block_id": block.block_id,
                            "shape_id": block.shape_id,
                            "shape_name": block.shape_name,
                            "message": "Extracted image/GIF file size is 0 bytes."
                        })

                if block.block_type == "chart":
                    warnings.append({
                        "slide_index": slide.slide_index,
                        "level": "info",
                        "code": "CHART_EXTRACTED",
                        "block_id": block.block_id,
                        "shape_id": block.shape_id,
                        "shape_name": block.shape_name,
                        "chart_type": block.extra.get("chart_type"),
                        "message": "A chart block was extracted."
                    })

                if block.block_type == "video":
                    media_abs_path = block.extra.get("media_abs_path")
                    media_rel_path = block.extra.get("media_rel_path")
                    poster_rel_path = block.extra.get("poster_rel_path")
                    external_target = block.extra.get("external_target")
                    video_size = DebugRenderer._safe_file_size(media_abs_path)

                    warnings.append({
                        "slide_index": slide.slide_index,
                        "level": "info",
                        "code": "VIDEO_EXTRACTED",
                        "block_id": block.block_id,
                        "shape_id": block.shape_id,
                        "shape_name": block.shape_name,
                        "media_rel_path": media_rel_path,
                        "poster_rel_path": poster_rel_path,
                        "external_target": external_target,
                        "file_size_bytes": video_size,
                        "message": "A video block was extracted."
                    })

                    if external_target and not media_rel_path:
                        warnings.append({
                            "slide_index": slide.slide_index,
                            "level": "info",
                            "code": "EXTERNAL_VIDEO_REFERENCE",
                            "block_id": block.block_id,
                            "shape_id": block.shape_id,
                            "shape_name": block.shape_name,
                            "external_target": external_target,
                            "message": "The video is an external reference rather than an embedded media file."
                        })

                    if media_rel_path and not poster_rel_path:
                        warnings.append({
                            "slide_index": slide.slide_index,
                            "level": "info",
                            "code": "VIDEO_POSTER_MISSING",
                            "block_id": block.block_id,
                            "shape_id": block.shape_id,
                            "shape_name": block.shape_name,
                            "message": "Video extracted without a poster image."
                        })

                    if video_size is not None and video_size == 0:
                        warnings.append({
                            "slide_index": slide.slide_index,
                            "level": "warning",
                            "code": "EMPTY_VIDEO_FILE",
                            "block_id": block.block_id,
                            "shape_id": block.shape_id,
                            "shape_name": block.shape_name,
                            "message": "Extracted video file size is 0 bytes."
                        })

        return warnings