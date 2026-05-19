from __future__ import annotations

from pptx.shapes.base import BaseShape

from pptx2md.models.block import BlockModel
from pptx2md.normalizers.text_cleaner import normalize_ppt_text


class TableExtractor:
    """
    Extract simple table data from a shape if it contains a table.
    """

    def extract(self, shape: BaseShape, block_index: int) -> BlockModel | None:
        if not getattr(shape, "has_table", False):
            return None

        table = shape.table
        rows_data: list[list[str]] = []

        for row in table.rows:
            row_data: list[str] = []
            for cell in row.cells:
                row_data.append(normalize_ppt_text(cell.text))
            rows_data.append(row_data)

        if not rows_data:
            return None

        text_lines = [" | ".join(row) for row in rows_data]
        full_text = "\n".join(text_lines).strip()

        placeholder_type = None
        if getattr(shape, "is_placeholder", False):
            try:
                placeholder_type = str(shape.placeholder_format.type)
            except Exception:
                placeholder_type = None

        return BlockModel(
            block_id=f"block_{block_index}",
            block_type="table",
            role_hint="table",
            shape_id=getattr(shape, "shape_id", None),
            shape_name=getattr(shape, "name", None),
            shape_type=str(getattr(shape, "shape_type", None)),
            placeholder_type=placeholder_type,
            left=getattr(shape, "left", None),
            top=getattr(shape, "top", None),
            width=getattr(shape, "width", None),
            height=getattr(shape, "height", None),
            z_order=block_index,
            text=full_text,
            extra={
                "rows": rows_data
            }
        )