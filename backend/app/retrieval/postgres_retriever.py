"""
PostgreSQL retriever — ILIKE fallback search over ParsedContent.

Extracted from the fallback logic in edit.py. Searches PostgreSQL directly
when vector stores are unavailable or for supplementary exact-match context.
"""
import logging
import uuid

from sqlalchemy import text

from app.retrieval.base import BaseRetriever, RetrievalResult
from app.db.models import ParsedContent
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)


class PostgresRetriever(BaseRetriever):
    """PostgreSQL ParsedContent fallback — ILIKE keyword search."""

    source = "postgres"

    def retrieve(
        self,
        query: str,
        *,
        doc_id: str | None = None,
        session_id: str | None = None,
        top_k: int = 5,
    ) -> list[RetrievalResult]:
        if not doc_id:
            return []

        try:
            doc_uuid = uuid.UUID(doc_id)
        except ValueError:
            return []

        try:
            with SessionLocal() as db:
                # First try ILIKE search for query terms
                terms = [t.strip() for t in query.split() if len(t.strip()) >= 3]
                if terms:
                    results = self._ilike_search(db, doc_uuid, terms, top_k)
                    if results:
                        return results

                # Fallback: return all parsed content (same as edit.py fallback)
                return self._full_content_fallback(db, doc_uuid, top_k)

        except Exception:
            logger.exception("PostgresRetriever failed for doc_id=%s", doc_id)
            return []

    def _ilike_search(
        self, db, doc_uuid: uuid.UUID, terms: list[str], top_k: int
    ) -> list[RetrievalResult]:
        """Search using ILIKE for query terms."""
        from sqlalchemy import or_

        conditions = [
            ParsedContent.text.ilike(f"%{term}%") for term in terms[:5]  # cap at 5 terms
        ]
        chunks = (
            db.query(ParsedContent)
            .filter(
                ParsedContent.doc_id == doc_uuid,
                or_(*conditions),
            )
            .order_by(ParsedContent.page_no, ParsedContent.block_index)
            .limit(top_k)
            .all()
        )

        return [
            RetrievalResult(
                text=pc.text.strip(),
                score=0.5,  # fixed score for keyword matches
                source=self.source,
                metadata={
                    "doc_id": str(doc_uuid),
                    "chunk_index": pc.block_index,
                    "page_no": pc.page_no,
                    "match_type": "ilike",
                },
            )
            for pc in chunks
            if pc.text and pc.text.strip()
        ]

    def _full_content_fallback(
        self, db, doc_uuid: uuid.UUID, top_k: int
    ) -> list[RetrievalResult]:
        """Return all parsed content as a last resort."""
        chunks = (
            db.query(ParsedContent)
            .filter(ParsedContent.doc_id == doc_uuid)
            .order_by(ParsedContent.page_no, ParsedContent.block_index)
            .limit(top_k)
            .all()
        )

        return [
            RetrievalResult(
                text=pc.text.strip(),
                score=0.3,  # lower score for non-matched fallback
                source=self.source,
                metadata={
                    "doc_id": str(doc_uuid),
                    "chunk_index": pc.block_index,
                    "page_no": pc.page_no,
                    "match_type": "fallback",
                },
            )
            for pc in chunks
            if pc.text and pc.text.strip()
        ]

    def is_available(self) -> bool:
        try:
            with SessionLocal() as db:
                db.execute(text("SELECT 1"))
                return True
        except Exception:
            return False
