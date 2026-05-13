from typing import List
from datetime import datetime
import uuid
from app.schemas.document import DocumentStatusResponse
from pydantic import BaseModel, Field


class SessionCreateRequest(BaseModel):
    title: str = Field(default="Untitled Session")


class SessionUpdateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=256)


class SessionResponse(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChatMessageResponse(BaseModel):
    id: str
    role: str
    content: str
    timestamp: datetime

    model_config = {"from_attributes": True}

class SessionWithDocsResponse(SessionResponse):
    documents_count: int = 0
    documents: List[DocumentStatusResponse] = []
    messages: List[ChatMessageResponse] = []
