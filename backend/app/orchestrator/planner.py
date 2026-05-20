"""
Retrieval planner — builds a typed plan describing HOW to retrieve for a query.

Two plan types:
  CascadePlan  — for chat: sequential stages with confidence gates.
                 Stage 1: MemPalace (local memory, no vector DB cost)
                 Stage 2: Hybrid RAG (Qdrant dense + BM25 sparse, concurrent)
                 Each stage short-circuits the next if it is "satisfied".

  QueryPlan    — for document edits only: flat concurrent list.
                 Edit mode needs exact chunk_index alignment from Qdrant.
                 Cascade is unnecessary because the document IS the source.

Cascade confidence gate:
  A stage is "satisfied" when at least one returned result has a similarity
  score >= the stage threshold. A low-scoring MemPalace hit (e.g. 0.30) means
  the stored memory doesn't strongly match this query — proceed to Hybrid RAG.
  Any Hybrid RAG result is accepted unconditionally (threshold = 0.0) because
  document chunks are always relevant when they exist.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from app.core.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Plan data structures
# ---------------------------------------------------------------------------

@dataclass
class CascadeStage:
    """A single stage in the cascade retrieval pipeline."""
    name: str                        # human-readable label for logging
    sources: list[str]               # retriever keys to activate at this stage
    top_k_per_source: dict[str, int] # how many results each source returns
    confidence_threshold: float      # min score for this stage to be "satisfied"
                                     # 0.0 = any non-empty result satisfies


@dataclass
class CascadePlan:
    """
    Sequential cascade plan for chat queries.

    Stages are attempted in order. The first stage that is "satisfied"
    (returns >= 1 result with score >= confidence_threshold) stops the cascade
    and its results are used as context for the LLM.

    If all stages return nothing, the LLM is called with empty context
    (PromptManager's no-context path handles this gracefully).
    """
    stages: list[CascadeStage]
    context_type: str = "document_qa"

    def __repr__(self) -> str:
        stage_names = [s.name for s in self.stages]
        return f"CascadePlan(type={self.context_type!r}, stages={stage_names})"


@dataclass
class QueryPlan:
    """Flat concurrent plan — edit requests only."""
    sources: list[str] = field(default_factory=list)
    top_k_per_source: dict[str, int] = field(default_factory=dict)
    context_type: str = "edit_request"

    def __repr__(self) -> str:
        return (
            f"QueryPlan(type={self.context_type!r}, sources={self.sources}, "
            f"top_k={self.top_k_per_source})"
        )


# ---------------------------------------------------------------------------
# Planner
# ---------------------------------------------------------------------------

class RetrievalPlanner:
    """
    Analyses query context and returns the appropriate plan.

      Chat  (doc_id present)  → CascadePlan: memory → hybrid RAG
      Chat  (no doc_id)       → CascadePlan: memory only
      Edit  (is_edit=True)    → QueryPlan:   qdrant only (chunk_index alignment)
    """

    def plan(
        self,
        query: str,
        *,
        doc_id: str | None = None,
        session_id: str | None = None,
        is_edit: bool = False,
    ) -> CascadePlan | QueryPlan:
        """Return the correct plan for this request."""

        # ── Edit path: flat qdrant-only, no cascade ───────────────────────
        if is_edit:
            plan = QueryPlan(
                sources=["qdrant"] if "qdrant" in settings.retrieval_sources else [],
                top_k_per_source={"qdrant": 10},
                context_type="edit_request",
            )
            logger.debug("Planner → %s", plan)
            return plan

        # ── Chat with document: memory → hybrid ───────────────────────────
        if doc_id:
            stages = []

            # Stage 1 — MemPalace (local memory, cheapest)
            # Only added if session_id is present; without it there's no
            # session to recall from.
            if "mempalace" in settings.retrieval_sources and session_id:
                stages.append(
                    CascadeStage(
                        name="memory",
                        sources=["mempalace"],
                        top_k_per_source={"mempalace": 5},
                        confidence_threshold=settings.mempalace_confidence_threshold,
                    )
                )

            # Stage 2 — Hybrid RAG (Qdrant dense + BM25 sparse, concurrent)
            # Both run together inside this single stage via ThreadPoolExecutor.
            # Threshold = 0.0: any non-empty result from the document is useful.
            hybrid_sources = [
                s for s in ["qdrant", "bm25"]
                if s in settings.retrieval_sources
            ]
            if hybrid_sources:
                stages.append(
                    CascadeStage(
                        name="hybrid_rag",
                        sources=hybrid_sources,
                        top_k_per_source={
                            "qdrant": 8,
                            "bm25": 8,
                        },
                        confidence_threshold=0.0,
                    )
                )

            plan = CascadePlan(stages=stages, context_type="document_qa")
            logger.debug("Planner → %s", plan)
            return plan

        # ── Chat without document: memory only ───────────────────────────
        stages = []
        if "mempalace" in settings.retrieval_sources:
            stages.append(
                CascadeStage(
                    name="memory",
                    sources=["mempalace"],
                    top_k_per_source={"mempalace": 6},
                    confidence_threshold=0.0,  # any memory hit is useful
                )
            )

        plan = CascadePlan(stages=stages, context_type="general_chat")
        logger.debug("Planner → %s", plan)
        return plan