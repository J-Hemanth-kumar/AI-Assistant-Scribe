from pydantic import BaseModel


class UploadRequest(BaseModel):
    session_id: str | None = None
