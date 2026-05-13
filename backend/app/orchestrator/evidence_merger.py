"""
Evidence merger — fuses results from multiple retrieval sources.

Delegates to RRFScorer to do the actual fusion, but acts as the boundary
where source-specific normalization or filtering could happen before scoring.
"""
import logging

from app.retrieval.base import RetrievalResult
from app.retrieval.rrf_scorer import RRFScorer

logger = logging.getLogger(__name__)


class EvidenceMerger:
    """
    Merges results from multiple retrievers using Reciprocal Rank Fusion (RRF).
    """

    def __init__(self) -> None:
        self._scorer = RRFScorer()

    def merge(
        self,
        results: list[RetrievalResult],
        *,
        top_k: int = 5,
    ) -> list[RetrievalResult]:
        """
        Merge and rank a flat list of RetrievalResult objects from multiple sources.
        """
        if not results:
            return []

        logger.debug("EvidenceMerger: fusing %d raw results", len(results))
        merged = self._scorer.score(results, top_k=top_k)
        
        # Log fusion summary for debugging
        if merged:
            sources_summary = [r.source for r in merged]
            logger.info("EvidenceMerger: returned %d fused results. Top sources: %s", len(merged), sources_summary)
            
        return merged
