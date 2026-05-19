from __future__ import annotations

from pathlib import Path

from pptx.slide import Slide

from pptx2md.models.slide import SlideModel
from pptx2md.extractors.text_extractor import TextExtractor
from pptx2md.extractors.table_extractor import TableExtractor
from pptx2md.extractors.notes_extractor import NotesExtractor
from pptx2md.extractors.image_extractor import ImageExtractor
from pptx2md.extractors.chart_extractor import ChartExtractor
from pptx2md.extractors.video_extractor import VideoExtractor
from pptx2md.normalizers.role_inference import RoleInference
from pptx2md.normalizers.block_filter import BlockFilter
from pptx2md.normalizers.title_utils import clean_title_text


class SlideExtractor:
    """
    Batch version with:
    - text extraction
    - table extraction
    - image/GIF extraction
    - chart extraction
    - video extraction
    - notes extraction
    - block filtering
    - title inference
    - simple reading-order sort
    """

    def __init__(self, assets_dir: Path, pptx_path: Path) -> None:
        self.text_extractor = TextExtractor()
        self.table_extractor = TableExtractor()
        self.notes_extractor = NotesExtractor()
        self.image_extractor = ImageExtractor(assets_dir)
        self.chart_extractor = ChartExtractor()
        self.video_extractor = VideoExtractor(pptx_path, assets_dir)
        self.role_inference = RoleInference()
        self.block_filter = BlockFilter()

    def extract(self, slide: Slide, slide_index: int) -> SlideModel:
        layout_name = None
        try:
            layout_name = slide.slide_layout.name
        except Exception:
            layout_name = None

        slide_id = f"slide_{slide_index}"
        notes_text = self.notes_extractor.extract(slide)

        slide_model = SlideModel(
            slide_index=slide_index,
            slide_id=slide_id,
            hidden=None,
            layout_name=layout_name,
            title=None,
            title_detected=False,
            notes_text=notes_text,
            blocks=[],
        )

        block_index = 1
        for shape in slide.shapes:
            table_block = self.table_extractor.extract(shape, block_index)
            if table_block is not None:
                slide_model.blocks.append(table_block)
                block_index += 1
                continue

            chart_block = self.chart_extractor.extract(shape, block_index)
            if chart_block is not None:
                slide_model.blocks.append(chart_block)
                block_index += 1
                continue

            image_block = self.image_extractor.extract(shape, slide_index, block_index)
            if image_block is not None:
                slide_model.blocks.append(image_block)
                block_index += 1
                continue

            text_block = self.text_extractor.extract(shape, block_index)
            if text_block is not None:
                slide_model.blocks.append(text_block)
                block_index += 1

        # package-level video extraction
        video_blocks = self.video_extractor.extract_for_slide(slide_index, block_index)
        if video_blocks:
            slide_model.blocks.extend(video_blocks)
            block_index += len(video_blocks)

        self.block_filter.mark_filters(slide_model.blocks)

        for block in slide_model.blocks:
            block.role_hint = self.role_inference.infer_block_role(block)

        title_block_id, title_text = self.role_inference.choose_slide_title(slide_model.blocks)
        if title_text:
            slide_model.title = clean_title_text(title_text)
            slide_model.title_detected = True

        if title_block_id:
            for block in slide_model.blocks:
                if block.block_id == title_block_id and block.role_hint is None:
                    block.role_hint = "title_like"

        slide_model.blocks.sort(
            key=lambda b: (
                0 if b.role_hint in {"title", "title_like"} else 1,
                b.top if b.top is not None else 10**18,
                b.left if b.left is not None else 10**18,
            )
        )

        return slide_model