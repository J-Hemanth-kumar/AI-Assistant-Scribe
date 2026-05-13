from __future__ import annotations

from io import BytesIO
from typing import Any

from PIL import Image
import pytesseract
from pytesseract import Output

from app.core.config import settings
from app.parsers.base import ParsedBlock


def parse_image(data: bytes) -> list[ParsedBlock]:
    img = Image.open(BytesIO(data))
    # Tesseract works best on RGB.
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    # Use PSM 3 (Auto Page Segmentation) to better detect columns/paragraphs.
    ocr = pytesseract.image_to_data(
        img,
        lang=settings.tesseract_lang,
        config="--oem 3 --psm 3",
        output_type=Output.DICT,
    )

    n = len(ocr.get("text", []))
    
    blocks: list[ParsedBlock] = []
    current_block_num = -1
    current_words = []
    current_bbox = None
    current_page_no = 1

    for i in range(n):
        word_text = (ocr["text"][i] or "").strip()
        if not word_text:
            continue

        b_num = ocr["block_num"][i]
        page_no = ocr.get("page_num", [1]*n)[i]

        # When the block number or page number changes, finalize the previous block
        if (b_num != current_block_num or page_no != current_page_no) and current_words:
            blocks.append(
                ParsedBlock(
                    page_no=int(current_page_no),
                    block_index=len(blocks),
                    text=" ".join(current_words).strip(),
                    parser_type="ocr",
                    section=None,
                    bbox=current_bbox,
                    font=None,
                    size=None,
                )
            )
            current_words = []
            current_bbox = None

        # Start or continue the current block
        current_block_num = b_num
        current_page_no = page_no
        current_words.append(word_text)
        
        # Update bounding box for the block
        x0, y0 = ocr["left"][i], ocr["top"][i]
        x1, y1 = x0 + ocr["width"][i], y0 + ocr["height"][i]
        
        if current_bbox is None:
            current_bbox = {"x0": x0, "y0": y0, "x1": x1, "y1": y1}
        else:
            current_bbox["x0"] = min(current_bbox["x0"], x0)
            current_bbox["y0"] = min(current_bbox["y0"], y0)
            current_bbox["x1"] = max(current_bbox["x1"], x1)
            current_bbox["y1"] = max(current_bbox["y1"], y1)

    # Finalize the last block
    if current_words:
        blocks.append(
            ParsedBlock(
                page_no=int(current_page_no),
                block_index=len(blocks),
                text=" ".join(current_words).strip(),
                parser_type="ocr",
                section=None,
                bbox=current_bbox,
                font=None,
                size=None,
            )
        )

    return blocks
