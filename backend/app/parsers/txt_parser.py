from __future__ import annotations

import chardet
import re

from app.parsers.base import ParsedBlock


def parse_txt(data: bytes) -> list[ParsedBlock]:
    detection = chardet.detect(data)
    encoding = detection.get("encoding") or "utf-8"
    text = data.decode(encoding, errors="replace")

    # Module 2 should output paragraph-level blocks (Module 3 does token chunking).
    paragraphs = re.split(r"\n\s*\n+", text)
    blocks_text: list[str] = []
    for p in paragraphs:
        cleaned = p.strip()
        if cleaned:
            blocks_text.append(cleaned)

    return [
        ParsedBlock(
            page_no=None,
            block_index=i,
            text=t,
            parser_type="txt",
            section=None,
            bbox=None,
            font=None,
            size=None,
        )
        for i, t in enumerate(blocks_text)
    ]

