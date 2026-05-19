from __future__ import annotations

from pathlib import Path

from pptx.shapes.base import BaseShape

from pptx2md.models.block import BlockModel


class ImageExtractor:
    """
    Extract image shapes, save image blobs to assets directory,
    and return image blocks.

    GIF is treated as a special kind of image block.
    """

    def __init__(self, assets_dir: Path) -> None:
        self.assets_dir = assets_dir
        self.assets_dir.mkdir(parents=True, exist_ok=True)

    def extract(self, shape: BaseShape, slide_index: int, block_index: int) -> BlockModel | None:
        # avoid treating a movie/media shape as a normal image
        shape_type_str = str(getattr(shape, "shape_type", None))
        if "MEDIA" in shape_type_str:
            return None

        try:
            image = shape.image
        except Exception:
            return None

        ext = (getattr(image, "ext", None) or "bin").lower()
        content_type = getattr(image, "content_type", None)
        image_sha1 = getattr(image, "sha1", None)

        filename = f"slide_{slide_index}_image_{block_index}.{ext}"
        output_path = self.assets_dir / filename
        output_path.write_bytes(image.blob)

        placeholder_type = None
        if getattr(shape, "is_placeholder", False):
            try:
                placeholder_type = str(shape.placeholder_format.type)
            except Exception:
                placeholder_type = None

        media_kind = "gif" if ext == "gif" or content_type == "image/gif" else "image"

        return BlockModel(
            block_id=f"block_{block_index}",
            block_type="image",
            role_hint="image",
            shape_id=getattr(shape, "shape_id", None),
            shape_name=getattr(shape, "name", None),
            shape_type=shape_type_str,
            placeholder_type=placeholder_type,
            left=getattr(shape, "left", None),
            top=getattr(shape, "top", None),
            width=getattr(shape, "width", None),
            height=getattr(shape, "height", None),
            z_order=block_index,
            text=None,
            is_filtered=False,
            filter_reason=None,
            extra={
                "media_kind": media_kind,
                "filename": filename,
                "image_rel_path": f"assets/{filename}",
                "image_abs_path": str(output_path.resolve()),
                "content_type": content_type,
                "sha1": image_sha1,
            }
        )