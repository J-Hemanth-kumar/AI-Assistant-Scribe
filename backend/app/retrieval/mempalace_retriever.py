"""
MemPalace retriever — conversational memory search.

Searches MemPalace for relevant conversational memories from past chat
sessions. Wraps MemoryService.recall().
"""
import logging

from app.retrieval.base import BaseRetriever, RetrievalResult
from app.memory.memory_service import MemoryService

logger = logging.getLogger(__name__)


class MemPalaceRetriever(BaseRetriever):
    """MemPalace conversational memory search."""

    source = "mempalace"

    def __init__(self) -> None:
        self._memory = MemoryService()

    def retrieve(
        self,
        query: str,
        *,
        doc_id: str | None = None,
        session_id: str | None = None,
        top_k: int = 5,
    ) -> list[RetrievalResult]:
        try:
            results = self._memory.recall(
                query,
                session_id=session_id,
                n_results=top_k,
            )
            return [
                RetrievalResult(
                    text=r.text,
                    score=r.similarity,
                    source=self.source,
                    metadata={
                        "room": r.room,
                        "wing": r.wing,
                        **r.metadata,
                    },
                )
                for r in results
                if r.text.strip()
            ]
        except Exception:
            logger.exception("MemPalaceRetriever failed")
            return []

    def is_available(self) -> bool:
        try:
            stats = self._memory.get_stats()
            return stats.get("health", False)
        except Exception:
            return False
