from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ParsedBlock:
    page_no: int | None
    block_index: int
    text: str
    parser_type: str
    section: str | None = None
    bbox: dict[str, Any] | None = None
    font: str | None = None
    size: float | None = None

