from __future__ import annotations

from pathlib import Path, PurePosixPath
import posixpath
import re
import zipfile

from lxml import etree

from pptx2md.models.block import BlockModel


class VideoExtractor:
    """
    Extract video information from the .pptx package by parsing slide XML + rels.

    Rationale:
    - embedded video is stored as a media part in the package
    - movie shapes are represented in slide XML and linked by relationships
    """

    NS = {
        "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "p14": "http://schemas.microsoft.com/office/powerpoint/2010/main",
    }

    CONTENT_TYPE_TO_EXT = {
        "video/mp4": "mp4",
        "video/mpeg": "mpeg",
        "video/quicktime": "mov",
        "video/x-msvideo": "avi",
        "video/x-ms-wmv": "wmv",
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
    }

    def __init__(self, pptx_path: Path, assets_dir: Path) -> None:
        self.pptx_path = pptx_path
        self.assets_dir = assets_dir
        self.assets_dir.mkdir(parents=True, exist_ok=True)
        self._content_type_map = self._load_content_types()
        self._video_map = self._build_video_map()

    def extract_for_slide(self, slide_index: int, start_block_index: int) -> list[BlockModel]:
        infos = self._video_map.get(slide_index, [])
        blocks: list[BlockModel] = []

        current_index = start_block_index
        for seq, info in enumerate(infos, start=1):
            media_rel_path = None
            media_abs_path = None
            poster_rel_path = None
            poster_abs_path = None

            internal_media_part = info.get("internal_media_part")
            internal_poster_part = info.get("internal_poster_part")
            external_target = info.get("external_target")
            mime_type = info.get("mime_type")

            if internal_media_part:
                media_ext = self._guess_ext(internal_media_part, mime_type, "mp4")
                media_filename = f"slide_{slide_index}_video_{seq}.{media_ext}"
                media_path = self.assets_dir / media_filename
                self._export_internal_part(internal_media_part, media_path)
                media_rel_path = f"assets/{media_filename}"
                media_abs_path = str(media_path.resolve())

            if internal_poster_part:
                poster_content_type = self._content_type_for_part(internal_poster_part)
                poster_ext = self._guess_ext(internal_poster_part, poster_content_type, "png")
                poster_filename = f"slide_{slide_index}_video_{seq}_poster.{poster_ext}"
                poster_path = self.assets_dir / poster_filename
                self._export_internal_part(internal_poster_part, poster_path)
                poster_rel_path = f"assets/{poster_filename}"
                poster_abs_path = str(poster_path.resolve())

            summary_lines: list[str] = []
            summary_lines.append("video")
            if info.get("shape_name"):
                summary_lines.append(f"name: {info['shape_name']}")
            if mime_type:
                summary_lines.append(f"mime_type: {mime_type}")
            if external_target:
                summary_lines.append("external_target: yes")
            summary_text = "\n".join(summary_lines)

            block = BlockModel(
                block_id=f"block_{current_index}",
                block_type="video",
                role_hint="video",
                shape_id=info.get("shape_id"),
                shape_name=info.get("shape_name"),
                shape_type="MEDIA",
                placeholder_type=None,
                left=info.get("left"),
                top=info.get("top"),
                width=info.get("width"),
                height=info.get("height"),
                z_order=current_index,
                text=summary_text,
                is_filtered=False,
                filter_reason=None,
                extra={
                    "media_kind": "video",
                    "mime_type": mime_type,
                    "media_rel_path": media_rel_path,
                    "media_abs_path": media_abs_path,
                    "poster_rel_path": poster_rel_path,
                    "poster_abs_path": poster_abs_path,
                    "external_target": external_target,
                    "internal_media_part": internal_media_part,
                    "internal_poster_part": internal_poster_part,
                }
            )
            blocks.append(block)
            current_index += 1

        return blocks

    def _load_content_types(self) -> dict[str, str]:
        result: dict[str, str] = {}
        defaults: dict[str, str] = {}

        with zipfile.ZipFile(self.pptx_path, "r") as zf:
            if "[Content_Types].xml" not in zf.namelist():
                return result

            root = etree.fromstring(zf.read("[Content_Types].xml"))

            for elem in root.findall("{*}Default"):
                ext = elem.get("Extension")
                ctype = elem.get("ContentType")
                if ext and ctype:
                    defaults[ext.lower()] = ctype

            for elem in root.findall("{*}Override"):
                part_name = elem.get("PartName")
                ctype = elem.get("ContentType")
                if part_name and ctype:
                    result[part_name.lstrip("/")] = ctype

        result["__defaults__"] = defaults  # type: ignore[assignment]
        return result

    def _content_type_for_part(self, part_name: str | None) -> str | None:
        if not part_name:
            return None

        exact = self._content_type_map.get(part_name)
        if exact:
            return exact

        defaults = self._content_type_map.get("__defaults__", {})
        ext = Path(part_name).suffix.lower().lstrip(".")
        if isinstance(defaults, dict):
            return defaults.get(ext)

        return None

    def _guess_ext(self, part_name: str, content_type: str | None, fallback: str) -> str:
        suffix = Path(part_name).suffix.lower().lstrip(".")
        if suffix:
            return suffix

        if content_type and content_type in self.CONTENT_TYPE_TO_EXT:
            return self.CONTENT_TYPE_TO_EXT[content_type]

        return fallback

    def _resolve_part_name(self, base_part: str, target: str) -> str:
        base_dir = posixpath.dirname(base_part)
        return posixpath.normpath(posixpath.join(base_dir, target))

    def _rels_path_for_slide(self, slide_part: str) -> str:
        base_dir = posixpath.dirname(slide_part)
        basename = posixpath.basename(slide_part)
        return posixpath.join(base_dir, "_rels", basename + ".rels")

    def _load_relationships(self, zf: zipfile.ZipFile, slide_part: str) -> dict[str, dict]:
        rels_path = self._rels_path_for_slide(slide_part)
        if rels_path not in zf.namelist():
            return {}

        rels_root = etree.fromstring(zf.read(rels_path))
        rels: dict[str, dict] = {}

        for rel in rels_root.findall("{*}Relationship"):
            rid = rel.get("Id")
            target = rel.get("Target")
            rel_type = rel.get("Type")
            target_mode = rel.get("TargetMode", "Internal")

            if not rid or not target:
                continue

            resolved_target = target
            if target_mode != "External":
                resolved_target = self._resolve_part_name(slide_part, target)

            rels[rid] = {
                "target": resolved_target,
                "type": rel_type,
                "target_mode": target_mode,
                "content_type": None if target_mode == "External" else self._content_type_for_part(resolved_target),
            }

        return rels

    def _parse_pic_geometry(self, pic_elem) -> tuple[int | None, int | None, int | None, int | None]:
        xfrm = pic_elem.find("./p:spPr/a:xfrm", namespaces=self.NS)
        if xfrm is None:
            return None, None, None, None

        off = xfrm.find("./a:off", namespaces=self.NS)
        ext = xfrm.find("./a:ext", namespaces=self.NS)

        left = int(off.get("x")) if off is not None and off.get("x") else None
        top = int(off.get("y")) if off is not None and off.get("y") else None
        width = int(ext.get("cx")) if ext is not None and ext.get("cx") else None
        height = int(ext.get("cy")) if ext is not None and ext.get("cy") else None

        return left, top, width, height

    def _build_video_map(self) -> dict[int, list[dict]]:
        result: dict[int, list[dict]] = {}

        with zipfile.ZipFile(self.pptx_path, "r") as zf:
            slide_parts = sorted(
                [name for name in zf.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)],
                key=lambda n: int(re.search(r"slide(\d+)\.xml", n).group(1))
            )

            for slide_part in slide_parts:
                slide_index = int(re.search(r"slide(\d+)\.xml", slide_part).group(1))
                rels = self._load_relationships(zf, slide_part)
                slide_root = etree.fromstring(zf.read(slide_part))
                result[slide_index] = []

                for pic in slide_root.findall(".//p:pic", namespaces=self.NS):
                    nv_pr = pic.find("./p:nvPicPr/p:nvPr", namespaces=self.NS)
                    if nv_pr is None:
                        continue

                    video_file = nv_pr.find("./a:videoFile", namespaces=self.NS)
                    media_tag = nv_pr.find(".//p14:media", namespaces=self.NS)

                    if video_file is None and media_tag is None:
                        continue

                    c_nv_pr = pic.find("./p:nvPicPr/p:cNvPr", namespaces=self.NS)
                    shape_id = int(c_nv_pr.get("id")) if c_nv_pr is not None and c_nv_pr.get("id") else None
                    shape_name = c_nv_pr.get("name") if c_nv_pr is not None else None

                    left, top, width, height = self._parse_pic_geometry(pic)

                    media_rid = None
                    external_rid = None
                    if media_tag is not None:
                        media_rid = media_tag.get(f"{{{self.NS['r']}}}embed")
                    if video_file is not None:
                        external_rid = video_file.get(f"{{{self.NS['r']}}}link")

                    poster_blip = pic.find("./p:blipFill/a:blip", namespaces=self.NS)
                    poster_rid = None
                    if poster_blip is not None:
                        poster_rid = poster_blip.get(f"{{{self.NS['r']}}}embed")

                    internal_media_part = None
                    external_target = None
                    mime_type = None

                    if media_rid and media_rid in rels:
                        media_rel = rels[media_rid]
                        if media_rel["target_mode"] == "External":
                            external_target = media_rel["target"]
                        else:
                            internal_media_part = media_rel["target"]
                            mime_type = media_rel["content_type"]

                    if not internal_media_part and external_rid and external_rid in rels:
                        link_rel = rels[external_rid]
                        if link_rel["target_mode"] == "External":
                            external_target = link_rel["target"]
                        else:
                            internal_media_part = link_rel["target"]
                            mime_type = link_rel["content_type"]

                    internal_poster_part = None
                    if poster_rid and poster_rid in rels:
                        poster_rel = rels[poster_rid]
                        if poster_rel["target_mode"] != "External":
                            internal_poster_part = poster_rel["target"]

                    result[slide_index].append({
                        "shape_id": shape_id,
                        "shape_name": shape_name,
                        "left": left,
                        "top": top,
                        "width": width,
                        "height": height,
                        "internal_media_part": internal_media_part,
                        "internal_poster_part": internal_poster_part,
                        "external_target": external_target,
                        "mime_type": mime_type,
                    })

        return result

    def _export_internal_part(self, part_name: str, output_path: Path) -> None:
        if output_path.exists():
            return

        with zipfile.ZipFile(self.pptx_path, "r") as zf:
            if part_name not in zf.namelist():
                return
            output_path.write_bytes(zf.read(part_name))