"""
Retrieval router — executes retrieval plans against registered backends.

Two execution modes that match the two plan types from the planner:

  execute_cascade(CascadePlan)  — SEQUENTIAL with confidence gate
  ┌─────────────────────────────────────────────────────────────────┐
  │  Stage 1: MemPalace                                             │
  │    Run MemPalaceRetriever                                       │
  │    If any result.score >= threshold  ──→  STOP, return results  │
  │    Else                              ──→  Stage 2               │
  │                                                                 │
  │  Stage 2: Hybrid RAG                                            │
  │    Run Qdrant + BM25 CONCURRENTLY (ThreadPoolExecutor)          │
  │    RRF-merge their results                                      │
  │    If any results                    ──→  STOP, return results  │
  │    Else                              ──→  return [] (no context) │
  └─────────────────────────────────────────────────────────────────┘

  execute_flat(QueryPlan)  — CONCURRENT (edit requests only)
    All sources in plan.sources fire at the same time.
    Results returned as-is (no cascade, no threshold check).

The cascade short-circuit is the key token-saving mechanism:
  MemPalace hit  → Qdrant and BM25 are NEVER called → zero vector DB cost.
  MemPalace miss → Hybrid RAG fires → MemPalace is not queried again.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.orchestrator.planner import CascadePlan, CascadeStage, QueryPlan
from app.retrieval.base import BaseRetriever, RetrievalResult
from app.retrieval.bm25_retriever import BM25Retriever
from app.retrieval.mempalace_retriever import MemPalaceRetriever
from app.retrieval.postgres_retriever import PostgresRetriever
from app.retrieval.rrf_scorer import RRFScorer
from app.retrieval.vector_retriever import VectorRetriever

logger = logging.getLogger(__name__)

# How long to wait for a single retriever call (seconds).
_RETRIEVER_TIMEOUT = 8.0


class RetrievalRouter:
    """
    Executes a CascadePlan or QueryPlan against registered retrieval backends.

    Registered sources:
      "mempalace" → MemPalaceRetriever  (local episodic memory — Stage 1)
      "qdrant"    → VectorRetriever     (dense semantic search — Stage 2)
      "bm25"      → BM25Retriever       (sparse keyword search — Stage 2)
      "postgres"  → PostgresRetriever   (fallback only, not in any default plan)
    """

    def __init__(self) -> None:
        self._retrievers: dict[str, BaseRetriever] = {
            "mempalace": MemPalaceRetriever(),
            "qdrant":    VectorRetriever(),
            "bm25":      BM25Retriever(),
            "postgres":  PostgresRetriever(),
        }
        self._rrf = RRFScorer()

    # ------------------------------------------------------------------
    # Public: cascade execution (chat path)
    # ------------------------------------------------------------------

    def execute_cascade(
        self,
        plan: CascadePlan,
        query: str,
        *,
        doc_id: str | None = None,
        session_id: str | None = None,
    ) -> tuple[list[RetrievalResult], str]:
        """
        Execute stages sequentially; short-circuit at the first satisfied stage.

        Returns:
            (results, stage_name)  where stage_name is the stage that provided
            the results ("memory", "hybrid_rag", or "none").
        """
        for stage in plan.stages:
            logger.debug(
                "Cascade: trying stage='%s' sources=%s", stage.name, stage.sources
            )

            # Multiple sources in one stage (e.g. qdrant + bm25) run concurrently
            if len(stage.sources) > 1:
                raw = self._run_concurrent(stage, query, doc_id=doc_id, session_id=session_id)
                # RRF-merge within the stage for multi-source stages
                results = self._rrf.score(raw, top_k=max(stage.top_k_per_source.values()))
            else:
                results = self._run_single_source(
                    stage.sources[0], query,
                    doc_id=doc_id, session_id=session_id,
                    top_k=stage.top_k_per_source.get(stage.sources[0], 5),
                )

            if self._stage_satisfied(results, stage.confidence_threshold):
                logger.info(
                    "Cascade: stage='%s' satisfied with %d results (top score=%.3f)",
                    stage.name,
                    len(results),
                    max((r.score for r in results), default=0.0),
                )
                return results, stage.name

            logger.info(
                "Cascade: stage='%s' not satisfied (results=%d, threshold=%.2f) → next stage",
                stage.name, len(results), stage.confidence_threshold,
            )

        logger.info("Cascade: all stages exhausted — no context found")
        return [], "none"

    # ------------------------------------------------------------------
    # Public: flat concurrent execution (edit path)
    # ------------------------------------------------------------------

    def execute_flat(
        self,
        plan: QueryPlan,
        query: str,
        *,
        doc_id: str | None = None,
        session_id: str | None = None,
    ) -> list[RetrievalResult]:
        """
        Execute all sources in the plan concurrently (edit requests only).
        """
        if not plan.sources:
            return []

        results: list[RetrievalResult] = []
        with ThreadPoolExecutor(max_workers=max(len(plan.sources), 1)) as executor:
            future_map = {
                executor.submit(
                    self._run_single_source,
                    src, query,
                    doc_id=doc_id,
                    session_id=session_id,
                    top_k=plan.top_k_per_source.get(src, 5),
                ): src
                for src in plan.sources
                if src in self._retrievers
            }
            for future in as_completed(future_map):
                src = future_map[future]
                try:
                    results.extend(future.result())
                except Exception:
                    logger.exception("Flat executor: retriever '%s' failed", src)

        return results

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _run_concurrent(
        self,
        stage: CascadeStage,
        query: str,
        *,
        doc_id: str | None,
        session_id: str | None,
    ) -> list[RetrievalResult]:
        """Run multiple sources within a single stage concurrently."""
        results: list[RetrievalResult] = []
        with ThreadPoolExecutor(max_workers=len(stage.sources)) as executor:
            future_map = {
                executor.submit(
                    self._run_single_source,
                    src, query,
                    doc_id=doc_id,
                    session_id=session_id,
                    top_k=stage.top_k_per_source.get(src, 5),
                ): src
                for src in stage.sources
                if src in self._retrievers
            }
            for future in as_completed(future_map):
                src = future_map[future]
                try:
                    results.extend(future.result())
                except Exception:
                    logger.exception(
                        "Concurrent stage '%s': retriever '%s' failed",
                        stage.name, src,
                    )
        return results

    def _run_single_source(
        self,
        source_name: str,
        query: str,
        *,
        doc_id: str | None,
        session_id: str | None,
        top_k: int,
    ) -> list[RetrievalResult]:
        """Run one retriever with availability guard and error isolation."""
        retriever = self._retrievers.get(source_name)
        if retriever is None:
            logger.warning("Router: unknown source '%s'", source_name)
            return []
        if not retriever.is_available():
            logger.warning("Router: source '%s' unavailable — skipping", source_name)
            return []
        try:
            hits = retriever.retrieve(
                query, doc_id=doc_id, session_id=session_id, top_k=top_k
            )
            logger.debug(
                "Router: source='%s' → %d results", source_name, len(hits)
            )
            return hits
        except Exception:
            logger.exception("Router: source '%s' raised an error", source_name)
            return []

    @staticmethod
    def _stage_satisfied(
        results: list[RetrievalResult],
        threshold: float,
    ) -> bool:
        """
        Return True if at least one result meets the confidence threshold.

        threshold = 0.0  → any non-empty result list satisfies (hybrid RAG stage).
        threshold > 0.0  → at least one result must score >= threshold (memory stage).
        """
        if not results:
            return False
        if threshold <= 0.0:
            return True
        return any(r.score >= threshold for r in results)