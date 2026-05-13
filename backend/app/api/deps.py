from collections.abc import Generator

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.services.document_service import DocumentService
from app.services.minio_service import MinioService


# FIX: added rollback on error — prevents dirty transaction state
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_document_service() -> DocumentService:
    return DocumentService()


def get_minio_service() -> MinioService:
    return MinioService()
