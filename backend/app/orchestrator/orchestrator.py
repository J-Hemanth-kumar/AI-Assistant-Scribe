"""
Cognitive Orchestrator — single entry point for all retrieval in Scribe.

Routes each request through the correct execution path:

  Chat requests    → CascadePlan → RetrievalRouter.execute_cascade()
                     Stage 1: MemPalace (local memory, zero vector DB cost)
                     Stage 2: Hybrid RAG (Qdrant + BM25), only if Stage 1 misses

  Edit requests    → QueryPlan  → RetrievalRouter.execute_flat()
                     Qdrant only — needs exact chunk_index for diff alignment

The cascade is the core architectural change: we never touch Qdrant or BM25
unless MemPalace cannot satisfy the query with sufficient confidence. This
preserves LLM tokens and vector DB calls for queries that truly need them.
"""
from __future__ import annotations

import logging

from app.orchestrator.planner import CascadePlan, QueryPlan, RetrievalPlanner
from app.orchestrator.retrieval_router import RetrievalRouter
from app.orchestrator.evidence_merger import EvidenceMerger
from app.retrieval.base import RetrievalResult

logger = logging.getLogger(__name__)


class CognitiveOrchestrator:
    """
    End-to-end retrieval pipeline coordinator.

    Public interface (unchanged — backward compatible with RetrievalService):
      retrieve(query, ...)       → str   (formatted context string)
      retrieve_results(query, …) → list[RetrievalResult]
    """

    def __init__(self) -> None:
        self._planner = RetrievalPlanner()
        self._router  = RetrievalRouter()
        self._merger  = EvidenceMerger()

    # ------------------------------------------------------------------
    # Primary public method
    # ------------------------------------------------------------------

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
        Retrieve context and format it as a string ready for the LLM prompt.
        Backward-compatible with the existing RetrievalService interface.
        """
        results, _ = self._retrieve_with_meta(
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
        """Return raw RetrievalResult objects for callers that need metadata."""
        results, _ = self._retrieve_with_meta(
            query,
            doc_id=doc_id,
            session_id=session_id,
            is_edit=is_edit,
            top_k=top_k,
        )
        return results

    def retrieve_with_stage(
        self,
        query: str,
        *,
        doc_id: str | None = None,
        session_id: str | None = None,
        top_k: int = 5,
    ) -> tuple[str, str]:
        """
        Return (context_string, stage_name) so callers can log which
        stage answered the query ("memory", "hybrid_rag", or "none").

        Used by RetrievalService.retrieve_context_with_stage().
        """
        results, stage = self._retrieve_with_meta(
            query,
            doc_id=doc_id,
            session_id=session_id,
            is_edit=False,
            top_k=top_k,
        )
        context = self._format_context(results, is_edit=False) if results else ""
        return context, stage

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _retrieve_with_meta(
        self,
        query: str,
        *,
        doc_id: str | None,
        session_id: str | None,
        is_edit: bool,
        top_k: int,
    ) -> tuple[list[RetrievalResult], str]:
        """
        Core routing logic.

        Returns (results, stage_name):
          stage_name = "memory"     — MemPalace answered
          stage_name = "hybrid_rag" — Qdrant + BM25 answered
          stage_name = "flat"       — edit path (concurrent qdrant)
          stage_name = "none"       — nothing found
        """
        plan = self._planner.plan(
            query,
            doc_id=doc_id,
            session_id=session_id,
            is_edit=is_edit,
        )

        # ── Edit path: flat concurrent ────────────────────────────────
        if isinstance(plan, QueryPlan):
            raw = self._router.execute_flat(
                plan, query, doc_id=doc_id, session_id=session_id
            )
            merged = self._merger.merge(raw, top_k=top_k)
            return merged, "flat"

        # ── Chat path: cascade ────────────────────────────────────────
        raw, stage = self._router.execute_cascade(
            plan, query, doc_id=doc_id, session_id=session_id
        )

        if stage == "none" or not raw:
            return [], "none"

        # Merge / RRF is already done per-stage inside the router for
        # multi-source stages (hybrid_rag). For single-source stages
        # (memory) the merger just applies top_k trimming.
        merged = self._merger.merge(raw, top_k=top_k)
        return merged, stage

    def _format_context(
        self,
        results: list[RetrievalResult],
        *,
        is_edit: bool,
    ) -> str:
        """Format results into a context string for the LLM prompt."""
        parts: list[str] = []
        for i, res in enumerate(results):
            chunk_idx = res.metadata.get("chunk_index")
            if is_edit and chunk_idx is not None:
                header = f"[chunk_index={chunk_idx}]"
            else:
                header = f"[source={res.source} rank={i + 1}]"
            parts.append(f"{header}\n{res.text.strip()}")
        return "\n\n---\n\n".join(parts)