import logging
import re
from uuid import UUID

from sqlalchemy import delete

from app.db.models import ParsedContent
from app.db.session import SessionLocal
from app.parsers.base import ParsedBlock
from app.parsers.docx_parser import parse_docx
from app.parsers.image_parser import parse_image
from app.parsers.markdown_parser import parse_markdown
from app.parsers.pdf_parser import parse_pdf
from app.parsers.txt_parser import parse_txt
from app.utils.file_type import FileType, guess_file_type

logger = logging.getLogger(__name__)


class ParsingService:
    ALLOWED_PARSER_TYPES = {"pdf", "docx", "ocr", "txt", "md"}

    # Minimum usable text length (after cleaning) to persist as a block.
    MIN_TEXT_LEN = 10

    # If a block is shorter than this, we try to merge it into the previous block
    # to avoid noisy fragments like "This" / "is" / "bad".
    MERGE_SHORT_THRESHOLD = 30

    def normalize_text(self, text: str) -> str:
        # Normalize whitespace aggressively to produce chunk-ready text.
        #  - Replace any newline / tabs with a single space
        #  - Collapse repeated whitespace
        #  - Remove soft hyphen artifacts
        text = text.replace("\u00ad", "")
        text = re.sub(r"-\s*\n\s*", "", text)  # join broken hyphenated words
        text = re.sub(r"\s+", " ", text).strip()
        return text

    def clean_ocr_text(self, text: str) -> str:
        # OCR tends to include stray characters; keep only a safe character set.
        # 1) remove extra whitespace
        text = re.sub(r"\s+", " ", text).strip()
        # 2) remove junk characters
        # Keep common OCR-safe characters plus whitespace.
        # Place `-` at the end of the character class to avoid "range" parsing issues.
        text = re.sub(r"[^a-zA-Z0-9.,=()/\\\- ]", "", text)
        # 3) final whitespace normalization
        text = re.sub(r"\s+", " ", text).strip()
        return text

    def is_noise(self, text: str, *, parser_type: str) -> bool:
        t = text.strip()
        if not t:
            return True

        # Very short tokens are usually OCR/PDF artifacts.
        if len(t) < 3:
            return True

        letters = len(re.findall(r"[A-Za-z]", t))
        # For OCR, be stricter: too few letters means low quality.
        if parser_type == "ocr":
            return letters < 3 and len(t) < 25
        return letters < 2 and len(t) < 15

    def _looks_like_section_heading(self, text: str) -> bool:
        t = text.strip()
        if len(t) < 3 or len(t) > 80:
            return False
        # Heuristic: title-ish line with few words and no ending punctuation.
        if "." in t or ":" in t:
            return False
        words = t.split()
        if len(words) > 12:
            return False
        # Start with a capital letter (common for headings).
        return bool(re.match(r"^[A-Z][A-Za-z0-9 _\\/-]*$", t))

    def _extract_section_from_heading_text(self, text: str) -> str | None:
        # If it's already stored with a markdown-style prefix, strip it.
        t = text.strip()
        if t.startswith("# "):
            t = t[2:].strip()
        if self._looks_like_section_heading(t):
            return t
        return None

    def merge_blocks(self, blocks: list[ParsedBlock]) -> list[ParsedBlock]:
        # Merge small fragments into paragraph-like blocks so Module 3 can chunk reliably.
        ordered = sorted(blocks, key=lambda b: ((b.page_no or 1), b.block_index))

        merged: list[ParsedBlock] = []
        active_section: str | None = None

        for b in ordered:
            parser_type = (b.parser_type or "").strip().lower()
            if parser_type not in self.ALLOWED_PARSER_TYPES:
                # Never allow "unknown" to reach the DB contract.
                parser_type = "txt"

            page_no = b.page_no or 1

            cleaned = self.normalize_text(b.text)
            if parser_type == "ocr":
                cleaned = self.clean_ocr_text(cleaned)
            if self.is_noise(cleaned, parser_type=parser_type):
                continue

            # Section propagation:
            #  - DOCX/MD parsers already fill `section` when possible
            #  - Otherwise infer from '# ...' prefix or the first heading-like line.
            if b.section:
                active_section = b.section
            else:
                inferred = self._extract_section_from_heading_text(cleaned)
                if inferred:
                    active_section = inferred

            # If this block is a heading marker, keep it separate.
            is_heading = cleaned.startswith("# ")
            section_value = active_section or ""

            if not merged:
                # Seed first merged block; even if short, we may merge subsequent text into it.
                merged.append(
                    ParsedBlock(
                        page_no=page_no,
                        block_index=0,
                        text=cleaned,
                        parser_type=parser_type,
                        section=section_value,
                        bbox=b.bbox,
                        font=b.font,
                        size=b.size,
                    )
                )
                continue

            prev = merged[-1]
            same_page = prev.page_no == page_no

            # Merge short fragments into previous paragraph blocks.
            if same_page and not is_heading and len(cleaned) < self.MERGE_SHORT_THRESHOLD:
                sep = " " if not prev.text.endswith(" ") else ""
                merged[-1] = ParsedBlock(
                    page_no=prev.page_no,
                    block_index=prev.block_index,
                    text=self.normalize_text(prev.text + sep + cleaned),
                    parser_type=prev.parser_type,
                    section=prev.section or section_value,
                    bbox=prev.bbox,
                    font=prev.font,
                    size=prev.size,
                )
                continue

            # OCR-related merge (e.g., sentence parts + formula fragments)
            if same_page and not is_heading and parser_type == "ocr":
                prev_text = prev.text.strip()
                cur_text = cleaned.strip()
                prev_ends_mid_sentence = not re.search(r"[.!?]$", prev_text)
                cur_is_formulaish = bool(re.search(r"[=()/\\-]", cur_text))
                # Avoid invalid regex ranges in character classes by escaping `-`.
                cur_starts_without_space = cur_text[:1] in {"=", "(", "/", "-"} or bool(
                    re.match(r"^[=()/\\\-0-9]+", cur_text)
                )
                if prev_ends_mid_sentence and (cur_is_formulaish or cur_starts_without_space):
                    merged[-1] = ParsedBlock(
                        page_no=prev.page_no,
                        block_index=prev.block_index,
                        text=self.normalize_text(prev.text + " " + cur_text),
                        parser_type=prev.parser_type,
                        section=prev.section or active_section,
                        bbox=prev.bbox,
                        font=prev.font,
                        size=prev.size,
                    )
                    continue

            # Otherwise, start a new block.
            merged.append(
                ParsedBlock(
                    page_no=page_no,
                    block_index=0,
                    text=cleaned,
                    parser_type=parser_type,
                    section=section_value,
                    bbox=b.bbox,
                    font=b.font,
                    size=b.size,
                )
            )

        # Re-index and filter invalid output (still keep headings if they carry section).
        out: list[ParsedBlock] = []
        for i, b in enumerate(merged):
            b_text = b.text.strip()
            if len(b_text) < self.MIN_TEXT_LEN and not b_text.startswith("# "):
                continue
            out.append(
                ParsedBlock(
                    page_no=b.page_no or 1,
                    block_index=i,
                    text=b_text,
                    parser_type=b.parser_type,
                    section=b.section or "",
                    bbox=b.bbox,
                    font=b.font,
                    size=b.size,
                )
            )
        return out

    def parse_bytes(self, *, data: bytes, filename: str, content_type: str) -> list[ParsedBlock]:
        ftype = guess_file_type(content_type=content_type, filename=filename)

        if ftype == FileType.pdf:
            return parse_pdf(data)
        if ftype == FileType.docx:
            return parse_docx(data)
        if ftype == FileType.image:
            return parse_image(data)
        if ftype == FileType.txt:
            return parse_txt(data)
        if ftype == FileType.markdown:
            return parse_markdown(data)

        # Fallback: treat as text.
        return parse_txt(data)

    def clean_and_prepare_blocks(self, blocks: list[ParsedBlock]) -> list[ParsedBlock]:
        # Normalize/clean and merge small fragments.
        return self.merge_blocks(blocks)

    def save_parsed_blocks(self, *, doc_id: UUID, blocks: list[ParsedBlock]) -> None:
        # Replace existing blocks if task is retried.
        with SessionLocal() as session:
            session.execute(delete(ParsedContent).where(ParsedContent.doc_id == doc_id))

            if not blocks:
                raise ValueError(f"Refusing to save empty parsed blocks for doc_id={doc_id}")

            for block in blocks:
                # Enforce Module-2 contract on the DB write path too,
                # in case upstream parsers ever return unexpected values.
                parser_type = (block.parser_type or "").strip().lower()
                if parser_type not in self.ALLOWED_PARSER_TYPES:
                    parser_type = "txt"

                page_no = block.page_no if block.page_no is not None else 1
                section = block.section if block.section is not None else ""

                if page_no != block.page_no or section != block.section or parser_type != block.parser_type:
                    block = ParsedBlock(
                        page_no=page_no,
                        block_index=block.block_index,
                        text=block.text,
                        parser_type=parser_type,
                        section=section,
                        bbox=block.bbox,
                        font=block.font,
                        size=block.size,
                    )

                session.add(
                    ParsedContent(
                        doc_id=doc_id,
                        page_no=block.page_no,
                        block_index=block.block_index,
                        text=block.text,
                        parser_type=block.parser_type,
                        section=block.section,
                        bbox=block.bbox,
                        font=block.font,
                        size=block.size,
                    )
                )
            session.commit()

