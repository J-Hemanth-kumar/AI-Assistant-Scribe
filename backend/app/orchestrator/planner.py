"""
Retrieval planner — decides which sources to query for a given request.

Analyzes the query context (doc_id, session_id, is_edit) to build a
QueryPlan that specifies which retrieval sources to invoke.
"""
import logging
from dataclasses import dataclass, field

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class QueryPlan:
    """The plan for a retrieval operation."""
    sources: list[str] = field(default_factory=list)
    top_k_per_source: dict[str, int] = field(default_factory=dict)
    context_type: str = "document_qa"  # "document_qa" | "general_chat" | "edit_request"

    def __repr__(self) -> str:
        return (
            f"QueryPlan(type={self.context_type!r}, sources={self.sources}, "
            f"top_k={self.top_k_per_source})"
        )


class RetrievalPlanner:
    """
    Analyzes the query + context to build a QueryPlan.

    Rules:
      - If doc_id is present → always include qdrant
      - If session has prior chat history → include mempalace
      - Edit requests → qdrant only (needs chunk_index alignment)
      - No doc_id → mempalace + postgres as fallback
    """

    def plan(
        self,
        query: str,
        *,
        doc_id: str | None = None,
        session_id: str | None = None,
        is_edit: bool = False,
    ) -> QueryPlan:
        """Build a retrieval plan based on the request context."""
        available_sources = settings.retrieval_sources

        if is_edit:
            # Edit requests need exact chunk_index alignment — qdrant only
            sources = ["qdrant"] if "qdrant" in available_sources else []
            return QueryPlan(
                sources=sources,
                top_k_per_source={"qdrant": 10},
                context_type="edit_request",
            )

        sources: list[str] = []
        top_k_per_source: dict[str, int] = {}

        if doc_id:
            # Document-scoped query: primary = qdrant, augment with memory
            if "qdrant" in available_sources:
                sources.append("qdrant")
                top_k_per_source["qdrant"] = 8

            if "mempalace" in available_sources and session_id:
                sources.append("mempalace")
                top_k_per_source["mempalace"] = 3

            # Postgres as fallback (lower priority)
            if "postgres" in available_sources:
                sources.append("postgres")
                top_k_per_source["postgres"] = 3

            context_type = "document_qa"
        else:
            # No document — general chat, rely on memory
            if "mempalace" in available_sources:
                sources.append("mempalace")
                top_k_per_source["mempalace"] = 5

            if "postgres" in available_sources:
                sources.append("postgres")
                top_k_per_source["postgres"] = 3

            context_type = "general_chat"

        plan = QueryPlan(
            sources=sources,
            top_k_per_source=top_k_per_source,
            context_type=context_type,
        )
        logger.debug("Built retrieval plan: %s", plan)
        return plan
