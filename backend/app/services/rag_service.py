"""
RAG Chat Service — factually grounded, multi-turn, domain-specific streaming.

Pipeline per user message:
  1. Load conversation history  (PostgreSQL, last N turn pairs, non-blocking)
  2. Hybrid retrieval           (Qdrant dense + BM25 sparse + MemPalace memory)
  3. Build grounded prompt      (PromptManager: system + history + context + question)
  4. Stream LLM response        (Groq, multi-turn messages array)
  5. Persist turn to memory     (MemPalace + PostgreSQL, non-blocking)
  6. Auto-save edit if detected (if LLM returned <edit> block)
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from typing import AsyncGenerator

from app.core.config import settings
from app.db.session import SessionLocal
from app.memory.memory_service import MemoryService
from app.schemas.llm import EditResponse
from app.services.edit_service import save_version
from app.services.groq_service import stream_chat_response
from app.services.retrieval_service import RetrievalService

logger = logging.getLogger(__name__)


class RAGChatService:
    """
    Retrieval-Augmented Generation chat service.

    Combines hybrid retrieval with true multi-turn conversation history
    to produce grounded, human-like responses that never fabricate facts.
    """

    def __init__(self) -> None:
        self._retrieval = RetrievalService()   # -> CognitiveOrchestrator
        self._memory = MemoryService()

    async def stream_chat(
        self,
        prompt: str,
        doc_id: str | None = None,
        session_id: str | None = None,
        top_k: int = 5,
    ) -> AsyncGenerator[str, None]:
        """
        Full grounded RAG pipeline with multi-turn conversation:

          1. Load N prior turns from PostgreSQL for conversation continuity.
          2. Run hybrid retrieval (dense + sparse + memory).
          3. Stream a factually grounded response from Groq.
          4. Persist the new turn to MemPalace + PostgreSQL (non-blocking).
          5. Auto-detect and save document edits if present in the response.
        """
        # ── 1. Conversation history (non-blocking thread) ─────────────────
        # Prior turns give the LLM context: "You asked about X earlier, now
        # you're asking about Y — here's how they relate."
        history: list[dict[str, str]] = []
        if session_id:
            try:
                loop = asyncio.get_event_loop()
                history = await loop.run_in_executor(
                    None,
                    lambda: self._memory.get_recent_turns(
                        session_id,
                        n_pairs=settings.conversation_history_turns,
                    ),
                )
            except Exception:
                logger.exception(
                    "Could not load conversation history for session=%s", session_id
                )
                history = []

        # ── 2. Hybrid retrieval ──────────────────────────────────────────
        context = self._retrieval.retrieve_context(
            doc_id,
            prompt,
            session_id=session_id,
            top_k=top_k,
        )

        if context == "__NOT_READY__":
            yield (
                "The document is still being indexed. "
                "This usually takes a minute or two — please try again shortly."
            )
            return

        if doc_id and not context:
            yield (
                "I couldn't find relevant content in the document for your question. "
                "Try rephrasing, or ask something more specific about the document."
            )
            return

        # ── 3. Stream grounded response ──────────────────────────────────
        # context=""  when there's no document — PromptManager handles this
        # case by telling the LLM to answer from domain knowledge only and
        # remind the user to upload a document.
        full_text = ""
        async for token in stream_chat_response(
            prompt=prompt,
            context=context or "",
            history=history,
        ):
            full_text += token
            yield token

        # ── 4. Persist memory (non-blocking) ────────────────────────────
        if session_id:
            try:
                loop = asyncio.get_event_loop()
                turn_idx = await loop.run_in_executor(
                    None,
                    self._memory.get_turn_count,
                    session_id,
                )
                await loop.run_in_executor(
                    None,
                    lambda: self._memory.store_conversation(
                        session_id=session_id,
                        user_msg=prompt,
                        assistant_msg=full_text,
                        doc_id=doc_id,
                        turn_index=turn_idx,
                    ),
                )
            except Exception:
                logger.exception(
                    "Failed to store conversation turn for session=%s", session_id
                )

        # ── 5. Edit detection & auto-save ────────────────────────────────
        if doc_id:
            edit_match = re.search(r"<edit>(.*?)</edit>", full_text, re.DOTALL)
            if edit_match:
                try:
                    edit_json = edit_match.group(1).strip()
                    result = EditResponse(**json.loads(edit_json))
                    with SessionLocal() as db:
                        doc_uuid = uuid.UUID(doc_id)
                        version_id, version_number = save_version(
                            db, doc_uuid, prompt, result
                        )
                        yield f"__EDIT_SAVED_VERSION__{version_id}"
                        logger.info(
                            "Auto-saved edit via chat: version=%d doc_id=%s",
                            version_number,
                            doc_id,
                        )
                except Exception as exc:
                    logger.error("Failed to auto-save chat edit: %s", exc)