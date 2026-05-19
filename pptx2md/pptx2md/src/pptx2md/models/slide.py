from __future__ import annotations

from dataclasses import dataclass, field

from .block import BlockModel


@dataclass
class SlideModel:
    slide_index: int
    slide_id: str
    hidden: bool | None
    layout_name: str | None
    title: str | None
    title_detected: bool
    notes_text: str | None
    blocks: list[BlockModel] = field(default_factory=list)