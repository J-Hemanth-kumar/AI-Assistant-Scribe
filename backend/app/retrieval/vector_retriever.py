"""
Qdrant vector retriever — semantic search over document chunks.

Extracted from the original RetrievalService. Wraps QdrantService + Embedder
to implement the BaseRetriever interface.
"""
import logging

from app.retrieval.base import BaseRetriever, RetrievalResult
from app.services.qdrant_service import QdrantService
from app.services.embedder import Embedder
from app.services.document_service import DocumentService
from app.db.models import DocumentStatus

logger = logging.getLogger(__name__)


class VectorRetriever(BaseRetriever):
    """Qdrant semantic search over document chunks."""

    source = "qdrant"

    def __init__(self) -> None:
        self._qdrant = QdrantService()
        self._embedder = Embedder()
        self._docs = DocumentService()

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
            # Check document readiness
            import uuid
            doc = self._docs.get_document(uuid.UUID(doc_id))
            if doc.status != DocumentStatus.parsed:
                logger.info(
                    "VectorRetriever: doc %s not ready (status=%s)",
                    doc_id, doc.status,
                )
                return []

            vectors = self._embedder.embed_texts([query])
            if not vectors:
                logger.warning("VectorRetriever: embedder returned no vectors.")
                return []

            results = self._qdrant.search_chunks(
                vector=vectors[0],
                doc_id=doc_id,
                top_k=top_k,
            )

            if not results:
                return []

            retrieval_results = []
            for i, point in enumerate(results):
                payload = point.payload or {}
                text = payload.get("text", "").strip()
                chunk_idx = payload.get("chunk_index", i)
                score = getattr(point, "score", 1.0 - (i * 0.05))

                if text:
                    retrieval_results.append(
                        RetrievalResult(
                            text=text,
                            score=float(score),
                            source=self.source,
                            metadata={
                                "doc_id": doc_id,
                                "chunk_index": chunk_idx,
                                "filename": payload.get("filename", ""),
                            },
                        )
                    )
            return retrieval_results

        except Exception:
            logger.exception("VectorRetriever failed for doc_id=%s", doc_id)
            return []

    def is_available(self) -> bool:
        try:
            self._qdrant._client.get_collections()
            return True
        except Exception:
            return False
