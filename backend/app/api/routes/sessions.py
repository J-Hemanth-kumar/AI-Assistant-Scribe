import uuid
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.db.models import Session as SessionModel
from app.schemas.document import DocumentStatusResponse
from app.schemas.session import (
    SessionCreateRequest,
    SessionUpdateRequest,
    SessionResponse,
    SessionWithDocsResponse,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])
logger = logging.getLogger(__name__)


@router.post("", response_model=SessionResponse)
def create_session(
    request: SessionCreateRequest = SessionCreateRequest(),
    db: Session = Depends(get_db),
) -> SessionResponse:
    session = SessionModel(title=request.title)
    db.add(session)
    db.commit()
    db.refresh(session)
    return SessionResponse.model_validate(session)


@router.get("", response_model=List[SessionWithDocsResponse])
def list_sessions(db: Session = Depends(get_db)):
    sessions = db.query(SessionModel).order_by(SessionModel.updated_at.desc()).all()
    res = []
    for s in sessions:
        docs = []
        if s.documents:
            for d in s.documents:
                docs.append(DocumentStatusResponse(
                    doc_id=d.id,
                    filename=d.filename,
                    status=d.status,
                    progress=100 if d.status in ['parsed', 'indexed'] else (d.progress or 0)
                ))
        
        res.append(SessionWithDocsResponse(
            **SessionResponse.model_validate(s).model_dump(),
            documents_count=len(s.documents) if s.documents else 0,
            documents=docs
        ))
    return res


@router.get("/{session_id}", response_model=SessionWithDocsResponse)
def get_session(session_id: str, db: Session = Depends(get_db)):
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID format.")

    session = db.query(SessionModel).filter(SessionModel.id == session_uuid).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    docs = []
    if session.documents:
        for d in session.documents:
            docs.append(DocumentStatusResponse(
                doc_id=d.id,
                filename=d.filename,
                status=d.status,
                progress=100 if d.status in ['parsed', 'indexed'] else (d.progress or 0)
            ))

    from app.db.models import ChatMessage
    from app.schemas.session import ChatMessageResponse
    
    chat_messages = db.query(ChatMessage).filter(ChatMessage.session_id == session_uuid).order_by(ChatMessage.created_at.asc()).all()
    messages = []
    for m in chat_messages:
        messages.append(ChatMessageResponse(
            id=str(m.id),
            role=m.role,
            content=m.content,
            timestamp=m.created_at
        ))

    return SessionWithDocsResponse(
        **SessionResponse.model_validate(session).model_dump(),
        documents_count=len(session.documents) if session.documents else 0,
        documents=docs,
        messages=messages
    )


@router.patch("/{session_id}", response_model=SessionResponse)
def rename_session(session_id: str, request: SessionUpdateRequest, db: Session = Depends(get_db)):
    """Rename a session — used by the sidebar inline edit."""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID format.")

    session = db.query(SessionModel).filter(SessionModel.id == session_uuid).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    session.title = request.title.strip()
    db.commit()
    db.refresh(session)
    return SessionResponse.model_validate(session)


@router.delete("/{session_id}")
def delete_session(session_id: str, db: Session = Depends(get_db)):
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID format.")

    session = db.query(SessionModel).filter(SessionModel.id == session_uuid).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    db.delete(session)
    db.commit()
    return {"message": f"Session {session_id} deleted."}
