from typing import List, Optional
from pydantic import BaseModel


class EditRequest(BaseModel):
    doc_id: str
    prompt: str
    version_id: Optional[int] = None


class EditItem(BaseModel):
    chunk_index: int
    page_no: int
    original_text: str
    updated_text: str
    reason: str


class EditResponse(BaseModel):
    edits: List[EditItem]
