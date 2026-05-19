from __future__ import annotations

import re


_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
_LATIN_WORD_RE = re.compile(r"[A-Za-z]+")


def estimate_language_distribution(text: str) -> dict[str, float]:
    """
    Lightweight language distribution estimator.

    Heuristic only:
    - count CJK chars as zh evidence
    - count latin words as en evidence
    - if both absent, return unknown=1.0
    """
    if not text or not text.strip():
        return {"unknown": 1.0}

    zh_count = len(_CJK_RE.findall(text))
    en_count = len(_LATIN_WORD_RE.findall(text))

    if zh_count == 0 and en_count == 0:
        return {"unknown": 1.0}
    if zh_count > 0 and en_count == 0:
        return {"zh": 1.0}
    if en_count > 0 and zh_count == 0:
        return {"en": 1.0}

    total = zh_count + en_count
    zh_ratio = round(zh_count / total, 4)
    en_ratio = round(1.0 - zh_ratio, 4)

    return {
        "zh": zh_ratio,
        "en": en_ratio
    }