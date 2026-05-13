"""
Cognitive Orchestrator — end-to-end retrieval pipeline.

Replaces the monolithic RetrievalService as the single entry point for
all context retrieval in the Scribe backend.
"""
import logging

from app.orchestrator.planner import RetrievalPlanner
from app.orchestrator.retrieval_router import RetrievalRouter
from app.orchestrator.evidence_merger import EvidenceMerger
from app.retrieval.base import RetrievalResult

logger = logging.getLogger(__name__)


class CognitiveOrchestrator:
    """
    End-to-end multi-source retrieval orchestrator.
    
    Pipeline:
      query → Planner → Router → EvidenceMerger → context string
    """

    def __init__(self) -> None:
        self._planner = RetrievalPlanner()
        self._router = RetrievalRouter()
        self._merger = EvidenceMerger()

    def retrieve(
        self,
        query: str,
        *,
        doc_id: str | None = None,
        session_id: str | None = None,
        is_edit: bool = False,
        top_k: int = 5,
    ) -> str:
        """
        Retrieve context from multiple sources and format it as a single string.

        This output format mimics the old RetrievalService to ensure backward
        compatibility with the LLM prompt templates in edit.py and rag_service.py.
        """
        results = self.retrieve_results(
            query,
            doc_id=doc_id,
            session_id=session_id,
            is_edit=is_edit,
            top_k=top_k,
        )

        if not results:
            return ""

        return self._format_context(results, is_edit=is_edit)

    def retrieve_results(
        self,
        query: str,
        *,
        doc_id: str | None = None,
        session_id: str | None = None,
        is_edit: bool = False,
        top_k: int = 5,
    ) -> list[RetrievalResult]:
        """
        Retrieve raw RetrievalResult objects from the pipeline.
        """
        # 1. Plan
        plan = self._planner.plan(
            query,
            doc_id=doc_id,
            session_id=session_id,
            is_edit=is_edit,
        )

        # 2. Route & Execute
        raw_results = self._router.execute(
            plan,
            query,
            doc_id=doc_id,
            session_id=session_id,
        )

        # 3. Merge & Rank
        final_results = self._merger.merge(raw_results, top_k=top_k)

        return final_results

    def _format_context(self, results: list[RetrievalResult], *, is_edit: bool) -> str:
        """Format the results into the standard context string."""
        parts = []
        for i, res in enumerate(results):
            chunk_idx = res.metadata.get("chunk_index")
            source = res.source

            if is_edit and chunk_idx is not None:
                # Essential for edit diffs: must output exact chunk_index
                header = f"[chunk_index={chunk_idx}]"
            else:
                header = f"[source={source} rank={i+1}]"

            parts.append(f"{header}\n{res.text.strip()}")

        return "\n\n---\n\n".join(parts)
