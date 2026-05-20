"""
Edit service — generates LLM edits, saves versions with full text preview.

Fixes:
  1. `raise Exception(f"... {e}")` used `e` outside the except block → NameError.
     Now properly re-raises the last captured exception.
  2. save_version() now computes and stores full_text for the preview endpoint.
"""
import json
import logging
import uuid
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import DocumentVersion, ParsedContent
from app.schemas.llm import EditResponse
from app.services.groq_service import generate_edit_response

logger = logging.getLogger(__name__)


async def safe_generate(prompt: str, context: str) -> EditResponse:
    """
    Call Groq with up to 3 retries.
    FIX: captures last exception properly so re-raise works outside the loop.
    """
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            raw_output = await generate_edit_response(prompt, context)
            cleaned = raw_output.strip().lstrip("```json").rstrip("```").strip()
            parsed = json.loads(cleaned)
            return EditResponse(**parsed)
        except Exception as exc:
            last_exc = exc
            logger.warning("Attempt %d/3 failed: %s", attempt + 1, exc)

    raise RuntimeError(f"LLM generation failed after 3 retries.") from last_exc


def _apply_edits_to_text(original_chunks: list[ParsedContent], edits: list) -> str:
    """
    Apply edit diffs to original parsed chunks to produce the full edited text.
    This is stored in DocumentVersion.full_text so the preview endpoint can
    return it instantly without re-applying diffs on every request.
    """
    # Build a dict of chunk_index -> text for fast lookup
    chunk_map: dict[int, str] = {
        pc.block_index: pc.text for pc in original_chunks
    }

    # Apply edits — only replace text for content edits (updated_text != "").
    # Style-only edits (updated_text == "") keep the original text intact;
    # the export service reads style metadata separately.
    for edit in edits:
        chunk_idx = edit.get("chunk_index")
        updated = edit.get("updated_text", "").strip()
        if chunk_idx is not None and chunk_idx in chunk_map and updated:
            chunk_map[chunk_idx] = updated

    # Reassemble in block_index order
    ordered_indices = sorted(chunk_map.keys())
    return "\n\n".join(chunk_map[i] for i in ordered_indices)


def save_version(
    db: Session,
    doc_id: uuid.UUID,
    prompt: str,
    result: EditResponse,
) -> int:
    """
    Save a new edit version with full_text for instant preview.
    Returns the tuple (new_version_id, version_number).
    """
    query = select(func.max(DocumentVersion.version_number)).where(
        DocumentVersion.doc_id == doc_id
    )
    max_version = db.execute(query).scalar() or 0
    version_number = max_version + 1

    # Load original parsed content to compute full edited text
    original_chunks = (
        db.query(ParsedContent)
        .filter(ParsedContent.doc_id == doc_id)
        .order_by(ParsedContent.page_no, ParsedContent.block_index)
        .all()
    )

    edits_list = [e.model_dump() for e in result.edits]
    full_text = _apply_edits_to_text(original_chunks, edits_list)

    new_version = DocumentVersion(
        doc_id=doc_id,
        version_number=version_number,
        prompt=prompt,
        edit_diff_json=result.model_dump(),
        full_text=full_text,
    )
    db.add(new_version)
    db.commit()
    db.refresh(new_version)
    return new_version.id, version_number


def undo_last_version(db: Session, doc_id: uuid.UUID) -> Optional[int]:
    """Remove the latest version for a document. Returns deleted version number."""
    query = (
        select(DocumentVersion)
        .where(DocumentVersion.doc_id == doc_id)
        .order_by(DocumentVersion.version_number.desc())
        .limit(1)
    )
    latest = db.execute(query).scalar_one_or_none()
    if not latest:
        return None

    deleted_version_number = latest.version_number
    db.delete(latest)
    db.commit()
    return deleted_version_number