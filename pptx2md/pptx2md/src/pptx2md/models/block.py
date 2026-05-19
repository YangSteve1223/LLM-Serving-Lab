from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class BlockModel:
    block_id: str
    block_type: str
    role_hint: str | None = None
    shape_id: int | None = None
    shape_name: str | None = None
    shape_type: str | None = None
    placeholder_type: str | None = None
    left: int | None = None
    top: int | None = None
    width: int | None = None
    height: int | None = None
    z_order: int | None = None
    text: str | None = None
    is_filtered: bool = False
    filter_reason: str | None = None
    extra: dict = field(default_factory=dict)