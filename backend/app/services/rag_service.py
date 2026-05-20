"""
RAG Chat Service — factually grounded, multi-turn, cascade retrieval streaming.

Pipeline per user message:
  1. Conversation history  (PostgreSQL, last N pairs, non-blocking)
  2. Cascade retrieval     (MemPalace first -> Hybrid RAG only on miss)
  3. Prompt assembly       (PromptManager: system + history + context + question)
  4. Groq streaming        (multi-turn messages array)
  5. Memory persist        (MemPalace + PostgreSQL, non-blocking, post-stream)
  6. Edit auto-save        (if LLM returned <edit> block)

Cascade design (step 2):
  Stage 1 -- MemPalace:  free, local, no vector DB call.
             If score >= mempalace_confidence_threshold -> STOP, use memory.
  Stage 2 -- Hybrid RAG: Qdrant (dense) + BM25 (sparse) concurrent.
             Only fires when Stage 1 is not satisfied.
  Stage 3 -- No context: Both stages empty -> LLM answers from domain rules.
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

    def __init__(self) -> None:
        self._retrieval = RetrievalService()
        self._memory    = MemoryService()

    async def stream_chat(
        self,
        prompt: str,
        doc_id: str | None = None,
        session_id: str | None = None,
        top_k: int = 5,
    ) -> AsyncGenerator[str, None]:
        """
        Stream a grounded, multi-turn chat response using cascade retrieval.

          1. Load conversation history (PostgreSQL, non-blocking)
          2. Cascade retrieval:
               a. MemPalace -- zero vector DB cost if it answers
               b. Hybrid RAG (Qdrant + BM25) -- only on MemPalace miss
          3. Build and stream Groq response
          4. Async persist to memory
          5. Optional edit auto-save
        """
        # -- 1. Conversation history -----------------------------------------
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
                logger.exception("History load failed for session=%s", session_id)

        # -- 2. Cascade retrieval --------------------------------------------
        context, answered_by = self._retrieval.retrieve_context_with_stage(
            doc_id, prompt, session_id=session_id, top_k=top_k
        )

        logger.info(
            "Cascade: stage='%s' context_chars=%d session=%s doc=%s",
            answered_by, len(context), session_id, doc_id,
        )

        if context == "__NOT_READY__":
            yield (
                "The document is still being indexed. "
                "Please try again in a minute or two."
            )
            return

        if doc_id and not context:
            yield (
                "I couldn't find relevant content in the document for your question. "
                "Try rephrasing, or ask something more specific."
            )
            return

        # -- 3. Stream LLM response ------------------------------------------
        full_text = ""
        async for token in stream_chat_response(
            prompt=prompt,
            context=context or "",
            history=history,
        ):
            full_text += token
            yield token

        # -- 4. Persist memory (non-blocking) --------------------------------
        if session_id:
            try:
                loop = asyncio.get_event_loop()
                turn_idx = await loop.run_in_executor(
                    None, self._memory.get_turn_count, session_id
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
                logger.exception("Memory persist failed for session=%s", session_id)

        # -- 5. Edit auto-save -----------------------------------------------
        if doc_id:
            edit_match = re.search(r"<edit>(.*?)</edit>", full_text, re.DOTALL)
            if edit_match:
                try:
                    result = EditResponse(**json.loads(edit_match.group(1).strip()))
                    with SessionLocal() as db:
                        doc_uuid = uuid.UUID(doc_id)
                        version_id, version_number = save_version(
                            db, doc_uuid, prompt, result
                        )
                        yield f"__EDIT_SAVED_VERSION__{version_id}"
                        logger.info(
                            "Edit auto-saved: version=%d doc_id=%s",
                            version_number, doc_id,
                        )
                except Exception as exc:
                    logger.error("Edit auto-save failed: %s", exc)