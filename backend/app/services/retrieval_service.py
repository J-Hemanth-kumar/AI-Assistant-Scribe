"""
RetrievalService — backward-compatible facade over CognitiveOrchestrator.

Existing callers (edit.py, rag_service.py) use this class so they are
never aware of the orchestrator implementation details.
"""
import logging

from app.orchestrator.orchestrator import CognitiveOrchestrator

logger = logging.getLogger(__name__)


class RetrievalService:

    def __init__(self) -> None:
        self._orchestrator = CognitiveOrchestrator()

    def retrieve_context(
        self,
        doc_id: str | None,
        query: str,
        *,
        session_id: str | None = None,
        is_edit: bool = False,
        top_k: int = 5,
    ) -> str:
        """Return formatted context string (edit.py compatibility)."""
        return self._orchestrator.retrieve(
            query,
            doc_id=doc_id,
            session_id=session_id,
            is_edit=is_edit,
            top_k=top_k,
        )

    def retrieve_context_with_stage(
        self,
        doc_id: str | None,
        query: str,
        *,
        session_id: str | None = None,
        top_k: int = 5,
    ) -> tuple[str, str]:
        """
        Return (context_string, stage_name).

        stage_name is one of:
          "memory"     -- MemPalace answered; Hybrid RAG was NOT called
          "hybrid_rag" -- Qdrant + BM25 answered; MemPalace missed
          "flat"       -- edit path (concurrent qdrant, no cascade)
          "none"       -- no results from any stage
        """
        return self._orchestrator.retrieve_with_stage(
            query,
            doc_id=doc_id,
            session_id=session_id,
            top_k=top_k,
        )