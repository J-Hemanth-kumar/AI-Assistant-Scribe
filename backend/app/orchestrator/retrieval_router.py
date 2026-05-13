"""
Retrieval router — dispatches a QueryPlan to the appropriate retrievers.

Handles graceful degradation if a source is unavailable.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.orchestrator.planner import QueryPlan
from app.retrieval.base import BaseRetriever, RetrievalResult
from app.retrieval.vector_retriever import VectorRetriever
from app.retrieval.mempalace_retriever import MemPalaceRetriever
from app.retrieval.postgres_retriever import PostgresRetriever

logger = logging.getLogger(__name__)


class RetrievalRouter:
    """
    Executes a QueryPlan against registered retrievers.
    """

    def __init__(self) -> None:
        self._retrievers: dict[str, BaseRetriever] = {
            "qdrant": VectorRetriever(),
            "mempalace": MemPalaceRetriever(),
            "postgres": PostgresRetriever(),
        }

    def execute(
        self,
        plan: QueryPlan,
        query: str,
        *,
        doc_id: str | None = None,
        session_id: str | None = None,
    ) -> list[RetrievalResult]:
        """
        Execute the plan by querying multiple sources concurrently.

        Returns a flat list of all RetrievalResult objects.
        """
        if not plan.sources:
            return []

        results: list[RetrievalResult] = []
        
        # We use ThreadPoolExecutor to run independent I/O-bound retrieval concurrently.
        # Max workers = number of sources (usually 2-3)
        with ThreadPoolExecutor(max_workers=len(plan.sources)) as executor:
            future_to_source = {}
            for source_name in plan.sources:
                if source_name not in self._retrievers:
                    logger.warning("Router: source '%s' not registered", source_name)
                    continue

                retriever = self._retrievers[source_name]
                top_k = plan.top_k_per_source.get(source_name, 5)

                future = executor.submit(
                    self._run_retriever,
                    retriever,
                    query,
                    doc_id,
                    session_id,
                    top_k,
                )
                future_to_source[future] = source_name

            for future in as_completed(future_to_source):
                source_name = future_to_source[future]
                try:
                    source_results = future.result()
                    results.extend(source_results)
                except Exception:
                    logger.exception(
                        "Router: retriever '%s' raised an unhandled exception",
                        source_name,
                    )

        return results

    def _run_retriever(
        self,
        retriever: BaseRetriever,
        query: str,
        doc_id: str | None,
        session_id: str | None,
        top_k: int,
    ) -> list[RetrievalResult]:
        """Run a single retriever, catching any errors."""
        try:
            if not retriever.is_available():
                logger.warning("Router: source '%s' is unavailable", retriever.source)
                return []
            
            return retriever.retrieve(
                query,
                doc_id=doc_id,
                session_id=session_id,
                top_k=top_k,
            )
        except Exception as e:
            logger.error(
                "Router: error querying source '%s': %s",
                retriever.source,
                e,
            )
            return []
