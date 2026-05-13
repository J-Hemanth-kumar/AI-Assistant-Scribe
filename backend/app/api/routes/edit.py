import uuid
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.db.models import Document, DocumentVersion, ParsedContent
from app.schemas.llm import EditRequest, EditResponse
from app.services.edit_service import safe_generate, save_version, undo_last_version
from app.services.retrieval_service import RetrievalService

router = APIRouter(prefix="/edit", tags=["llm-editing"])
logger = logging.getLogger(__name__)


def _build_context_from_db(doc_uuid: uuid.UUID, db: Session) -> str:
    """
    Build context string directly from ParsedContent rows in PostgreSQL.
    Each chunk is labeled [chunk_index=N] so the LLM returns the correct
    block_index in its edit diffs, matching what _apply_edits_to_text() expects.

    This is used as a fallback when Qdrant has no vectors for the document
    (e.g. Celery embed task hasn't run yet, or Qdrant is unreachable).
    """
    chunks = (
        db.query(ParsedContent)
        .filter(ParsedContent.doc_id == doc_uuid)
        .order_by(ParsedContent.page_no, ParsedContent.block_index)
        .all()
    )
    if not chunks:
        return ""
    parts = [
        f"[chunk_index={pc.block_index}]\n{pc.text.strip()}"
        for pc in chunks
        if pc.text and pc.text.strip()
    ]
    return "\n\n---\n\n".join(parts)


@router.post("", response_model=dict)
async def generate_edits(request: EditRequest, db: Session = Depends(get_db)):
    doc_uuid = uuid.UUID(request.doc_id)

    # Verify document exists before doing anything expensive
    doc = db.query(Document).filter(Document.id == doc_uuid).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    # 1. Try Qdrant first (semantic retrieval)
    context = ""
    try:
        retriever = RetrievalService()
        context = retriever.retrieve_context(request.doc_id, request.prompt, top_k=10)
    except Exception as exc:
        logger.warning("Qdrant retrieval failed for doc_id=%s: %s — falling back to DB.", request.doc_id, exc)

    # 2. Fallback: build context directly from PostgreSQL ParsedContent
    if not context:
        logger.info(
            "No Qdrant context for doc_id=%s — using PostgreSQL ParsedContent as fallback.",
            request.doc_id,
        )
        context = _build_context_from_db(doc_uuid, db)

    if not context:
        raise HTTPException(
            status_code=422,
            detail="Document has not been parsed yet or contains no text. Please wait for parsing to complete.",
        )

    try:
        result = await safe_generate(request.prompt, context)
        version_id, version_number = save_version(db, doc_uuid, request.prompt, result)
        
        return {
            "version_id": version_id,
            "version_number": version_number,
            "edits": [e.model_dump() for e in result.edits],
        }
    except Exception as exc:
        logger.exception("Edit generation failed for doc_id=%s", request.doc_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/undo/{doc_id}")
def undo_edit(doc_id: str, db: Session = Depends(get_db)):
    doc_uuid = uuid.UUID(doc_id)
    deleted = undo_last_version(db, doc_uuid)
    if not deleted:
        raise HTTPException(status_code=404, detail="No edits to undo for this document.")
    return {"message": f"Reverted to version {deleted - 1}.", "deleted_version": deleted}


@router.get("/chunks/{doc_id}")
def get_parsed_content(doc_id: str, db: Session = Depends(get_db)) -> List[dict]:
    """
    GET /api/v1/edit/chunks/{doc_id}
    FIX: frontend was calling /api/v1/chunks/{doc_id} which didn't exist.
    """
    try:
        doc_uuid = uuid.UUID(doc_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid document ID format.")

    doc = db.query(Document).filter(Document.id == doc_uuid).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    chunks = (
        db.query(ParsedContent)
        .filter(ParsedContent.doc_id == doc_uuid)
        .order_by(ParsedContent.page_no, ParsedContent.block_index)
        .all()
    )
    return [
        {
            "id": c.id,
            "page_no": c.page_no,
            "block_index": c.block_index,
            "text": c.text,
            "section": c.section,
            "parser_type": c.parser_type,
        }
        for c in chunks
    ]


@router.get("/diff/{version_id}")
def get_edit_diffs(version_id: int, db: Session = Depends(get_db)):
    """
    GET /api/v1/edit/diff/{version_id}
    FIX: frontend was calling /api/v1/diff/{version_id} which didn't exist.
    """
    version = db.query(DocumentVersion).filter(DocumentVersion.id == version_id).first()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found.")
    return {
        "version_id": version.id,
        "doc_id": str(version.doc_id),
        "version_number": version.version_number,
        "prompt": version.prompt,
        "diffs": version.edit_diff_json,
    }


@router.get("/versions/{doc_id}")
def get_document_versions(doc_id: str, db: Session = Depends(get_db)) -> List[dict]:
    """
    GET /api/v1/edit/versions/{doc_id}
    FIX: frontend was calling /api/v1/versions/{doc_id} which didn't exist.
    """
    try:
        doc_uuid = uuid.UUID(doc_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid document ID format.")

    doc = db.query(Document).filter(Document.id == doc_uuid).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    versions = (
        db.query(DocumentVersion)
        .filter(DocumentVersion.doc_id == doc_uuid)
        .order_by(DocumentVersion.version_number.desc())
        .all()
    )
    return [
        {
            "id": v.id,
            "version_number": v.version_number,
            "prompt": v.prompt,
            "edits_count": len(v.edit_diff_json.get("edits", [])),
            "created_at": v.created_at.isoformat(),
        }
        for v in versions
    ]


@router.get("/preview/{doc_id}")
def get_document_edit_preview(
    doc_id: str,
    version_id: int | None = None,
    db: Session = Depends(get_db),
):
    """
    GET /api/v1/edit/preview/{doc_id}?version_id=N

    Returns the full edited text for a specific version (or latest if not specified).
    Stores full_text in the version row so preview is instant — no re-apply needed.

    NEW: This endpoint enables the LLM-edited document preview feature.
    """
    try:
        doc_uuid = uuid.UUID(doc_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid document ID format.")

    doc = db.query(Document).filter(Document.id == doc_uuid).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    # Resolve which version to show
    if version_id is not None:
        version = db.query(DocumentVersion).filter(
            DocumentVersion.doc_id == doc_uuid,
            DocumentVersion.id == version_id,
        ).first()
    else:
        version = (
            db.query(DocumentVersion)
            .filter(DocumentVersion.doc_id == doc_uuid)
            .order_by(DocumentVersion.version_number.desc())
            .first()
        )

    if not version:
        # No edits yet — return original parsed content assembled as plain text
        chunks = (
            db.query(ParsedContent)
            .filter(ParsedContent.doc_id == doc_uuid)
            .order_by(ParsedContent.page_no, ParsedContent.block_index)
            .all()
        )
        original_text = "\n\n".join(c.text for c in chunks)
        return {
            "doc_id": doc_id,
            "filename": doc.filename,
            "version_id": None,
            "version_number": 0,
            "prompt": None,
            "full_text": original_text,
            "edits": [],
            "is_original": True,
        }

    return {
        "doc_id": doc_id,
        "filename": doc.filename,
        "version_id": version.id,
        "version_number": version.version_number,
        "prompt": version.prompt,
        "full_text": version.full_text or "",
        "edits": version.edit_diff_json.get("edits", []),
        "is_original": False,
        "created_at": version.created_at.isoformat(),
    }
