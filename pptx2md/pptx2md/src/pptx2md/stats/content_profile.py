from __future__ import annotations

import re

from pptx2md.stats.language_profile import estimate_language_distribution


_LINK_PATTERN = re.compile(r"(?<!\!)\[[^\]]+\]\([^)]+\)")
_IMAGE_PATTERN = re.compile(r"!\[[^\]]*\]\([^)]+\)")


def build_content_profile(markdown_content: str, document) -> dict:
    lines = markdown_content.splitlines()

    heading_count = 0
    structure_level_max = 0
    list_count = 0
    link_count = 0

    for line in lines:
        stripped = line.strip()

        if stripped.startswith("#"):
            heading_count += 1
            level = len(stripped) - len(stripped.lstrip("#"))
            structure_level_max = max(structure_level_max, level)

        if stripped.startswith("- "):
            list_count += 1

        # count normal markdown links but exclude image syntax
        link_count += len(_LINK_PATTERN.findall(line))
        _ = _IMAGE_PATTERN.findall(line)

    table_count = sum(
        1
        for slide in document.slides
        for block in slide.blocks
        if block.block_type == "table" and not block.is_filtered
    )

    image_count = sum(
        1
        for slide in document.slides
        for block in slide.blocks
        if block.block_type == "image" and not block.is_filtered
    )

    paragraph_count = 0
    current_nonempty = False
    for line in lines:
        if line.strip():
            if not current_nonempty:
                paragraph_count += 1
                current_nonempty = True
        else:
            current_nonempty = False

    word_count = len(markdown_content.split())
    language_distribution = estimate_language_distribution(markdown_content)

    return {
        "char_count": len(markdown_content),
        "word_count": word_count,
        "line_count": len(lines),
        "heading_count": heading_count,
        "paragraph_count": paragraph_count,
        "image_count": image_count,
        "table_count": table_count,
        "formula_count": 0,
        "code_block_count": 0,
        "list_count": list_count,
        "quote_block_count": 0,
        "link_count": link_count,
        "structure_level_max": structure_level_max,
        "language_distribution": language_distribution
    }