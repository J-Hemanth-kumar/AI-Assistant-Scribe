"""
Reciprocal Rank Fusion (RRF) scorer.

Merges ranked lists from multiple retrieval sources without needing a
trained model. RRF assigns each result a score based on its rank position
within each source list, then sums scores across sources.

Formula: RRF_score(d) = Σ 1 / (k + rank_i(d))

Where k is a constant (default 60) and rank_i is the rank of document d
in the i-th retrieval source's result list. Higher RRF score = more relevant.

Reference: Cormack, Clarke & Buettcher (2009)
"""
import logging
from collections import defaultdict

from app.retrieval.base import RetrievalResult
from app.core.config import settings

logger = logging.getLogger(__name__)


class RRFScorer:
    """
    Reciprocal Rank Fusion scorer.

    Merges results from multiple retrieval sources using rank-based scoring.
    No model needed — pure algorithmic fusion.
    """

    def __init__(self, k: int | None = None) -> None:
        self._k = k or settings.rrf_k

    def score(
        self,
        results: list[RetrievalResult],
        *,
        top_k: int = 5,
    ) -> list[RetrievalResult]:
        """
        Apply RRF scoring to merge results from multiple sources.

        Results are grouped by source, ranked within each source,
        then fused using the RRF formula. Returns top_k results
        sorted by RRF score (highest first).
        """
        if not results:
            return []

        # Group results by source and rank them
        by_source: dict[str, list[RetrievalResult]] = defaultdict(list)
        for r in results:
            by_source[r.source].append(r)

        # Sort each source's results by their original score (descending)
        for source in by_source:
            by_source[source].sort(key=lambda r: r.score, reverse=True)

        # Build RRF scores keyed by text (for dedup)
        # Using text as the dedup key with a tolerance for near-duplicates
        rrf_scores: dict[str, float] = defaultdict(float)
        text_to_result: dict[str, RetrievalResult] = {}
        text_to_sources: dict[str, set] = defaultdict(set)

        for source, source_results in by_source.items():
            for rank, result in enumerate(source_results):
                text_key = self._normalize_text_key(result.text)
                rrf_score = 1.0 / (self._k + rank + 1)
                rrf_scores[text_key] += rrf_score
                text_to_sources[text_key].add(source)

                # Keep the result with the highest original score
                if text_key not in text_to_result or result.score > text_to_result[text_key].score:
                    text_to_result[text_key] = result

        # Build final results with RRF scores
        scored_results: list[RetrievalResult] = []
        for text_key, rrf_score in rrf_scores.items():
            original = text_to_result[text_key]
            scored_results.append(
                RetrievalResult(
                    text=original.text,
                    score=rrf_score,
                    source=original.source,
                    metadata={
                        **original.metadata,
                        "rrf_score": rrf_score,
                        "contributing_sources": list(text_to_sources[text_key]),
                        "original_score": original.score,
                    },
                )
            )

        # Sort by RRF score (highest first) and return top_k
        scored_results.sort(key=lambda r: r.score, reverse=True)
        return scored_results[:top_k]

    @staticmethod
    def _normalize_text_key(text: str) -> str:
        """
        Normalize text for deduplication.

        Strips whitespace, lowercases, and takes first 200 chars
        to handle near-duplicate texts from different sources.
        """
        return text.strip().lower()[:200]
