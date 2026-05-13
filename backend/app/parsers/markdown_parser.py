from __future__ import annotations

import re

import mistune
from bs4 import BeautifulSoup

from app.parsers.base import ParsedBlock


def parse_markdown(data: bytes) -> list[ParsedBlock]:
    text = data.decode("utf-8", errors="replace")

    # Render Markdown to HTML via mistune, then extract block-level content via BeautifulSoup.
    md = mistune.create_markdown(renderer=mistune.HTMLRenderer())
    html = md(text)

    soup = BeautifulSoup(html, "html.parser")

    block_tags = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li"]
    blocks: list[ParsedBlock] = []
    current_section: str | None = None

    for el in soup.find_all(block_tags):
        block_text = el.get_text(" ", strip=True)
        # Skip empty / whitespace-only nodes.
        if not block_text or not block_text.strip():
            continue
        # Collapse repeated whitespace.
        block_text = re.sub(r"\\s+", " ", block_text).strip()
        if not block_text:
            continue

        # Preserve heading hierarchy in-text for downstream RAG.
        tag_name = getattr(el, "name", None) or ""
        if tag_name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            level = int(tag_name[1])
            block_text = f"{'#' * max(1, min(level, 6))} {block_text}"
            # Set the active section for subsequent blocks.
            current_section = el.get_text(" ", strip=True).strip()

        blocks.append(
            ParsedBlock(
                page_no=None,
                block_index=len(blocks),
                text=block_text,
                parser_type="md",
                section=current_section,
                bbox=None,
                font=None,
                size=None,
            )
        )

    return blocks

