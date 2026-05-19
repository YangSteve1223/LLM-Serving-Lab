from __future__ import annotations

from pptx2md.models.block import BlockModel


class BlockFilter:
    """
    Mark obvious noise blocks.

    Current conservative rule:
    - slide number placeholder => filtered

    We do NOT directly delete blocks.
    We only mark them as filtered so debug output can still show them.
    """

    def mark_filters(self, blocks: list[BlockModel]) -> None:
        for block in blocks:
            self._mark_single_block(block)

    def _mark_single_block(self, block: BlockModel) -> None:
        placeholder = (block.placeholder_type or "").upper()
        shape_name = (block.shape_name or "").upper()

        # 1. explicit slide number placeholder
        if "SLIDE_NUMBER" in placeholder:
            block.is_filtered = True
            block.filter_reason = "slide_number_placeholder"
            return

        # 2. fallback by shape name keyword
        if "编号占位符" in shape_name or "SLIDE NUMBER" in shape_name:
            block.is_filtered = True
            block.filter_reason = "slide_number_shape_name"
            return