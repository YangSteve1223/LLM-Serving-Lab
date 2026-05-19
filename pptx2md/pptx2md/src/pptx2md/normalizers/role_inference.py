from __future__ import annotations

from pptx2md.models.block import BlockModel


class RoleInference:
    """
    Infer simple semantic roles for blocks.

    Current rules:
    - only text blocks can become title/subtitle
    - filtered blocks do not participate
    - fallback title uses top-most short text block
    """

    def infer_block_role(self, block: BlockModel) -> str | None:
        if block.is_filtered:
            return block.role_hint

        if block.block_type != "text":
            return block.role_hint

        placeholder = (block.placeholder_type or "").upper()

        if "CENTER_TITLE" in placeholder or placeholder.startswith("TITLE") or (
            "TITLE" in placeholder and "SUBTITLE" not in placeholder
        ):
            return "title"

        if "SUBTITLE" in placeholder:
            return "subtitle"

        return None

    def choose_slide_title(self, blocks: list[BlockModel]) -> tuple[str | None, str | None]:
        candidates = [
            b for b in blocks
            if b.block_type == "text" and b.text and not b.is_filtered
        ]
        if not candidates:
            return None, None

        for block in candidates:
            if block.role_hint == "title" and block.text:
                return block.block_id, block.text

        candidates.sort(
            key=lambda b: (
                b.top if b.top is not None else 10**18,
                len(b.text or ""),
                b.left if b.left is not None else 10**18,
            )
        )

        chosen = candidates[0]
        if chosen.role_hint is None:
            chosen.role_hint = "title_like"

        return chosen.block_id, chosen.text