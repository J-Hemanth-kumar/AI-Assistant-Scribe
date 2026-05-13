import logging
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Document, DocumentStatus
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)


class DocumentService:
    def create_document(
        self,
        filename: str,
        s3_key: str,
        content_type: str,
        doc_id: uuid.UUID | None = None,
        session_id: uuid.UUID | None = None,
    ) -> uuid.UUID:
        doc_id = doc_id or uuid.uuid4()
        with SessionLocal() as db:
            doc = Document(
                id=doc_id,
                filename=filename,
                s3_key=s3_key,
                content_type=content_type,
                status=DocumentStatus.uploaded,
                session_id=session_id,
            )
            db.add(doc)
            db.commit()
        logger.info("Created document record: %s", doc_id)
        return doc_id

    def get_document(self, doc_id: uuid.UUID) -> Document:
        with SessionLocal() as db:
            doc = db.execute(select(Document).where(Document.id == doc_id)).scalar_one()
            db.expunge(doc)
            return doc

    def set_status(self, doc_id: uuid.UUID, status: DocumentStatus, *, progress: int | None = None) -> None:
        with SessionLocal() as db:
            doc = db.execute(select(Document).where(Document.id == doc_id)).scalar_one()
            doc.status = status
            if progress is not None:
                doc.progress = max(0, min(100, int(progress)))
            db.commit()
