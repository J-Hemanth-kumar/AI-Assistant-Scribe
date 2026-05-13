"""
Base retriever interface and result type.

All retrievers implement BaseRetriever so the orchestrator can treat
them uniformly. Each returns a list of RetrievalResult.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class RetrievalResult:
    """A single retrieval result from any source."""
    text: str
    score: float
    source: str          # "qdrant" | "mempalace" | "postgres"
    metadata: dict = field(default_factory=dict)

    def __repr__(self) -> str:
        return (
            f"RetrievalResult(source={self.source!r}, score={self.score:.3f}, "
            f"text={self.text[:60]!r}...)"
        )


class BaseRetriever(ABC):
    """Abstract base class for all retrieval sources."""

    source: str = "unknown"

    @abstractmethod
    def retrieve(
        self,
        query: str,
        *,
        doc_id: str | None = None,
        session_id: str | None = None,
        top_k: int = 5,
    ) -> list[RetrievalResult]:
        """
        Retrieve relevant results for the given query.

        Args:
            query: The search query text
            doc_id: Optional document ID to scope the search
            session_id: Optional session ID to scope the search
            top_k: Maximum number of results to return

        Returns:
            List of RetrievalResult ordered by relevance (highest first)
        """
        ...

    @abstractmethod
    def is_available(self) -> bool:
        """Check if this retriever is operational."""
        ...
