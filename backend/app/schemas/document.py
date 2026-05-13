import uuid
from pydantic import BaseModel


class UploadResponse(BaseModel):
    doc_id: uuid.UUID
    status: str


class DocumentStatusResponse(BaseModel):
    doc_id: uuid.UUID
    filename: str
    status: str
    progress: int = 0
