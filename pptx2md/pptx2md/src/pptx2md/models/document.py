from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .slide import SlideModel


@dataclass
class DocumentModel:
    document_id: str
    source_path: Path
    source_name: str
    title: str | None
    slide_width: int
    slide_height: int
    slides: list[SlideModel] = field(default_factory=list)