"""
LLM schemas — typed contracts for edit requests and responses.

EditItem carries two orthogonal concerns:

  1. Content edit  (updated_text != "")
     The text content of this chunk changes.
     updated_text must be plain text — never HTML, never markup.
     The LLM must only change words/sentences, not inject tags.

  2. Style edit  (style != None)
     Formatting metadata for this chunk.
     The export service reads `style` and applies it via python-docx
     (DOCX) or PyMuPDF (PDF) — NOT by injecting HTML into the text.
     updated_text is left empty ("") for pure style edits.

Both can be set simultaneously (content change + style change on same chunk).
"""
from typing import List, Optional
from pydantic import BaseModel, Field


class EditStyle(BaseModel):
    """
    Structured styling metadata for a chunk.
    Export service maps these to python-docx / PyMuPDF calls.
    All fields are optional — only set the ones the user asked for.
    """
    font_name:  Optional[str]   = None   # e.g. "Times New Roman", "Arial"
    font_size:  Optional[float] = None   # in points — e.g. 15.0 for headings
    bold:       Optional[bool]  = None   # True / False
    italic:     Optional[bool]  = None   # True / False
    underline:  Optional[bool]  = None   # True / False
    color_hex:  Optional[str]   = None   # "#FF0000" — applied to text colour
    alignment:  Optional[str]   = None   # "left" | "center" | "right" | "justify"
    line_spacing: Optional[float] = None # line spacing multiplier e.g. 1.5
    is_heading: Optional[bool]  = None   # True = treat as heading in DOCX


class EditItem(BaseModel):
    chunk_index:  int
    page_no:      int
    original_text: str
    # For content changes only. Plain text — NO HTML, NO tags.
    # Leave empty string "" for style-only changes.
    updated_text: str = ""
    reason:       str
    # Structured styling — never embed styling in updated_text
    style:        Optional[EditStyle] = None


class EditResponse(BaseModel):
    edits: List[EditItem]


class EditRequest(BaseModel):
    doc_id:     str
    prompt:     str
    version_id: Optional[int] = None