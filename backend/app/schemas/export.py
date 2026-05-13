import uuid
from typing import List, Optional, Literal
from pydantic import BaseModel


class ExportEditItem(BaseModel):
    chunk_index: int
    page_no: int
    original_text: str
    updated_text: str
    reason: str


class ExportRequest(BaseModel):
    doc_id: str
    version_id: Optional[int] = None
    export_format: Literal["pdf", "docx", "txt", "markdown", "md"] = "pdf"
    edits: Optional[List[ExportEditItem]] = None


class ExportResponse(BaseModel):
    job_id: int
    status: str
    format: str
    download_url: Optional[str] = None
    edits_applied: int = 0
    message: str
