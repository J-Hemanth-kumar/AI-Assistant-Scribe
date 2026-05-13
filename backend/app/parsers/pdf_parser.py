from __future__ import annotations

from typing import Any

import fitz  # PyMuPDF

from app.parsers.base import ParsedBlock


def parse_pdf(data: bytes) -> list[ParsedBlock]:
    doc = fitz.open(stream=data, filetype="pdf")
    blocks: list[ParsedBlock] = []

    for page_no in range(doc.page_count):
        try:
            page = doc.load_page(page_no)
            text_dict = page.get_text("dict")
        except Exception:
            # Do not fail the entire document if one page fails.
            continue

        page_block_index = 0
        blocks_in_page = text_dict.get("blocks", []) or []
        # Improve reading order by sorting blocks top-to-bottom, then left-to-right.
        blocks_in_page_sorted = sorted(
            blocks_in_page,
            key=lambda b: (
                (b.get("bbox") or [0, 0, 0, 0])[1],  # y0
                (b.get("bbox") or [0, 0, 0, 0])[0],  # x0
            ),
        )

        for b in blocks_in_page_sorted:
            # In PyMuPDF "dict" mode, text blocks have type == 0.
            if b.get("type") != 0:
                continue

            lines = b.get("lines", []) or []
            spans: list[dict[str, Any]] = []
            for line in lines:
                for span in (line.get("spans") or []):
                    if span.get("text"):
                        spans.append(span)

            text = ""
            if lines:
                line_texts: list[str] = []
                for line in lines:
                    parts = [s.get("text", "") for s in (line.get("spans") or [])]
                    line_texts.append("".join(parts))
                text = "\n".join([t for t in line_texts if t.strip()]).strip()
            else:
                text = " ".join([s.get("text", "") for s in spans]).strip()

            if not text:
                continue

            bbox = b.get("bbox")
            if bbox:
                x0, y0, x1, y1 = float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])
                bbox_payload = {
                    # Common RAG/layout coordinates (PyMuPDF block bbox).
                    "x0": x0,
                    "y0": y0,
                    "x1": x1,
                    "y1": y1,
                    # Also include x/y/width/height for downstream exporters.
                    "x": x0,
                    "y": y0,
                    "width": x1 - x0,
                    "height": y1 - y0,
                }
            else:
                bbox_payload = None

            font = spans[0].get("font") if spans else None
            size = float(spans[0].get("size")) if spans and spans[0].get("size") is not None else None

            blocks.append(
                ParsedBlock(
                    page_no=page_no + 1,
                    block_index=page_block_index,
                    text=text,
                    parser_type="pdf",
                    section=None,
                    bbox=bbox_payload,
                    font=font,
                    size=size,
                )
            )
            page_block_index += 1

    return blocks

