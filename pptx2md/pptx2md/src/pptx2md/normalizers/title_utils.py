from __future__ import annotations


def clean_title_text(text: str | None) -> str:
    """
    Clean title-like text for storage and display.

    Goals:
    - remove leading bullet markers
    - keep multi-line titles if present
    - trim blank lines
    """
    if not text:
        return ""

    lines: list[str] = []

    for raw_line in text.splitlines():
        line = raw_line.strip()

        if line.startswith("- "):
            line = line[2:].strip()

        if line:
            lines.append(line)

    return "\n".join(lines).strip()