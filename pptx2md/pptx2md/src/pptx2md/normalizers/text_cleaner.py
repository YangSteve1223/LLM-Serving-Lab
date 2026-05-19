from __future__ import annotations

import re


def normalize_ppt_text(text: str | None) -> str:
    """
    Normalize text extracted from PPT.

    Goals:
    - remove strange control characters often seen in PPT soft line breaks
    - unify line breaks
    - trim extra spaces
    - keep meaningful multi-line structure
    """
    if not text:
        return ""

    # unify common line-break related characters
    text = text.replace("\r\n", "\n")
    text = text.replace("\r", "\n")

    # PPT soft line breaks may appear as vertical tab / control char
    text = text.replace("\x0b", "\n")

    cleaned_lines: list[str] = []
    for raw_line in text.split("\n"):
        line = re.sub(r"[ \t]+", " ", raw_line).strip()
        if line:
            cleaned_lines.append(line)

    return "\n".join(cleaned_lines)