"""
RAG Chat Service — fixed broken import and broken stream_generate call.

Original bugs:
  1. `from backend.scribe_backend.app.services.gemini_service import ...`
     → Wrong absolute path, caused ImportError at startup.
  2. `self.llm_service.stream_generate(...)` — llm_service was a function,
     not a class with a stream_generate method → AttributeError on every message.
"""
import re
import json
import uuid
import logging
from typing import AsyncGenerator

from app.db.session import SessionLocal
from app.services.retrieval_service import RetrievalService
from app.services.groq_service import stream_chat_response
from app.services.edit_service import save_version
from app.schemas.llm import EditResponse
from app.memory.memory_service import MemoryService

logger = logging.getLogger(__name__)


class RAGChatService:
    """
    Retrieval-Augmented Generation chat service.
    Retrieves document/conversational context then streams LLM response tokens.
    """

    def __init__(self) -> None:
        self._retrieval = RetrievalService()
        self._memory = MemoryService()

    async def stream_chat(
        self,
        prompt: str,
        doc_id: str | None = None,
        session_id: str | None = None,
        top_k: int = 5,
    ) -> AsyncGenerator[str, None]:
        """
        1. Retrieve relevant context from all available sources (Orchestrator).
        2. Stream token-by-token response from Groq.
        3. Store conversation turn in MemPalace + PostgreSQL.
        """
        # Retrieve context from vector db + memory + fallback
        context = self._retrieval.retrieve_context(
            doc_id, 
            prompt, 
            session_id=session_id,
            top_k=top_k
        )
        
        if context == "__NOT_READY__":
            yield (
                "The document is still being indexed for chat. "
                "This usually takes a minute or two. "
                "Please try your question again in a moment."
            )
            return

        if doc_id and not context:
            yield "I couldn't find relevant content in the document or our memory for your question."
            return

        # Prepare boot context (identity + essential story from MemPalace)
        boot_context = ""
        if session_id:
            boot_context = self._memory.get_boot_context(session_id)
            if boot_context:
                context = f"SYSTEM KNOWLEDGE:\n{boot_context}\n\nRELEVANT EVIDENCE:\n{context}"

        full_text = ""
        async for token in stream_chat_response(prompt=prompt, context=context):
            full_text += token
            yield token

        # ── Memory Storage ───────────────────────────────────────────────
        if session_id:
            try:
                turn_idx = self._memory.get_turn_count(session_id)
                self._memory.store_conversation(
                    session_id=session_id,
                    user_msg=prompt,
                    assistant_msg=full_text,
                    doc_id=doc_id,
                    turn_index=turn_idx,
                )
            except Exception:
                logger.exception("Failed to store conversation turn in memory")
            
        # ── Edit Detection & Auto-Save ───────────────────────────────────
        if doc_id:
            edit_match = re.search(r"<edit>(.*?)</edit>", full_text, re.DOTALL)
            if edit_match:
                try:
                    edit_json = edit_match.group(1).strip()
                    result = EditResponse(**json.loads(edit_json))
                    
                    with SessionLocal() as db:
                        doc_uuid = uuid.UUID(doc_id)
                        version_id, version_number = save_version(db, doc_uuid, prompt, result)
                        
                        # Yield a special non-token marker that the websocket handler 
                        # will intercept to send a separate 'chat_version_ready' message.
                        yield f"__EDIT_SAVED_VERSION__{version_id}"
                        logger.info("Auto-saved edit via chat: version=%d doc_id=%s", version_number, doc_id)
                except Exception as exc:
                    logger.error("Failed to auto-save chat edit: %s", exc)


