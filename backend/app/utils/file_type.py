from __future__ import annotations

import mimetypes
from enum import Enum
from pathlib import Path


class FileType(str, Enum):
    pdf = "pdf"
    docx = "docx"
    image = "image"
    txt = "txt"
    markdown = "markdown"
    unknown = "unknown"


def guess_file_type(*, content_type: str | None, filename: str | None = None) -> FileType:
    ct = (content_type or "").lower().strip()
    name = (filename or "").lower().strip()

    # Prefer explicit content_type coming from client/DB.
    if ct in {"application/pdf"}:
        return FileType.pdf

    if ct in {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
        "application/vnd.ms-word",
    }:
        return FileType.docx

    if ct.startswith("image/") or name.endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff")):
        return FileType.image

    if ct in {"text/markdown", "text/x-markdown"}:
        return FileType.markdown

    if ct in {"text/plain", "application/octet-stream"} or name.endswith((".txt", ".log")):
        return FileType.txt

    # Fallback: if content_type is missing/opaque, infer from filename extension.
    if name.endswith((".md", ".markdown")):
        return FileType.markdown

    if ct == "" and name.endswith((".docx",)):
        return FileType.docx

    if ct == "" and name.endswith((".pdf",)):
        return FileType.pdf

    # As a last resort, try guessing from filename extension.
    if name:
        guessed, _ = mimetypes.guess_type(name)
        if guessed == "application/pdf":
            return FileType.pdf
        if guessed and guessed.startswith("image/"):
            return FileType.image
        if guessed in {"text/markdown", "text/x-markdown"}:
            return FileType.markdown
        if guessed == "text/plain":
            return FileType.txt

    return FileType.unknown

