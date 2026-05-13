import logging
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_document_service, get_minio_service
from app.db.models import Document, DocumentStatus
from app.schemas.document import DocumentStatusResponse, UploadResponse

router = APIRouter(prefix="/documents", tags=["documents"])
logger = logging.getLogger(__name__)


@router.post("/upload", response_model=UploadResponse)
def upload_document(
    file: UploadFile = File(...),
    session_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    document_service=Depends(get_document_service),
    minio_service=Depends(get_minio_service),
) -> UploadResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename.")

    filename = Path(file.filename).name
    content_type = file.content_type or "application/octet-stream"
    doc_id = uuid.uuid4()
    s3_key = f"documents/{doc_id}/{filename}"

    # Resolve session_id
    session_uuid: uuid.UUID | None = None
    if session_id:
        try:
            session_uuid = uuid.UUID(session_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid session_id format.")

    try:
        file.file.seek(0)
        minio_service.upload_fileobj(file.file, key=s3_key, content_type=content_type)
    except Exception as exc:
        logger.exception("MinIO upload failed")
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {exc}")

    document_service.create_document(
        filename=filename,
        s3_key=s3_key,
        content_type=content_type,
        doc_id=doc_id,
        session_id=session_uuid,
    )

    # Enqueue async parsing
    from app.tasks.document_tasks import parse_document
    parse_document.apply_async(args=[str(doc_id)], queue="parse")

    return UploadResponse(doc_id=doc_id, status=DocumentStatus.uploaded.value)


@router.get("/{doc_id}", response_model=DocumentStatusResponse)
def get_document_status(doc_id: uuid.UUID, document_service=Depends(get_document_service)):
    doc = document_service.get_document(doc_id)
    status = doc.status.value
    if status in ("parsing", "indexing"):
        status = "processing"
    return DocumentStatusResponse(doc_id=doc.id, filename=doc.filename, status=status, progress=doc.progress)


@router.get("", response_model=List[DocumentStatusResponse])
def list_documents(
    session_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Document)
    if session_id:
        try:
            session_uuid = uuid.UUID(session_id)
            query = query.filter(Document.session_id == session_uuid)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid session_id format.")
    docs = query.all()
    return [
        DocumentStatusResponse(
            doc_id=doc.id,
            filename=doc.filename,
            status="processing" if doc.status.value == "parsing" else doc.status.value,
            progress=doc.progress,
        )
        for doc in docs
    ]


@router.get("/{doc_id}/preview")
def get_document_preview(doc_id: uuid.UUID, db: Session = Depends(get_db)):
    """Return parsed content chunks for document preview."""
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    if doc.status != DocumentStatus.parsed:
        raise HTTPException(
            status_code=400,
            detail=f"Document not yet parsed. Current status: {doc.status.value}",
        )
    chunks = [
        {
            "id": c.id,
            "page_no": c.page_no,
            "block_index": c.block_index,
            "text": c.text,
            "section": c.section,
        }
        for c in doc.parsed_contents
    ]
    return {"doc_id": str(doc_id), "filename": doc.filename, "status": doc.status.value, "chunks": chunks, "total_chunks": len(chunks)}


@router.delete("/{doc_id}")
def delete_document(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    minio_service=Depends(get_minio_service),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    try:
        minio_service.delete_file(doc.s3_key)
    except Exception as exc:
        logger.warning("MinIO delete failed (continuing): %s", exc)
    db.delete(doc)
    db.commit()
    return {"message": f"Document {doc_id} deleted."}
