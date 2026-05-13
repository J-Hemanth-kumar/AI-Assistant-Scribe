import logging
import uuid

from qdrant_client import QdrantClient
from qdrant_client.http import models as qm

from app.core.config import settings

logger = logging.getLogger(__name__)

_VECTOR_SIZE = 1024   # BGE-M3 output dimension
_COLLECTION = "documents"


class QdrantService:
    def __init__(self) -> None:
        self._client = QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)
        self._ensure_collection()

    def _ensure_collection(self) -> None:
        try:
            names = {c.name for c in self._client.get_collections().collections}
            if _COLLECTION not in names:
                self._client.create_collection(
                    collection_name=_COLLECTION,
                    vectors_config=qm.VectorParams(size=_VECTOR_SIZE, distance=qm.Distance.COSINE),
                )
                logger.info("Created Qdrant collection '%s'.", _COLLECTION)
        except Exception:
            logger.exception("Failed to ensure Qdrant collection.")

    def upsert_chunks(self, doc_id: str, chunks: list[str], vectors: list[list[float]], metadata: dict | None = None) -> None:
        extra = metadata or {}
        points = [
            qm.PointStruct(
                id=str(uuid.uuid4()),
                vector=vector,
                payload={"doc_id": doc_id, "chunk_index": i, "text": chunk, **extra},
            )
            for i, (chunk, vector) in enumerate(zip(chunks, vectors))
        ]
        if points:
            self._client.upsert(collection_name=_COLLECTION, points=points)
            logger.info("Upserted %d vectors for doc_id=%s.", len(points), doc_id)

    def upsert_chunks_with_indices(
        self,
        doc_id: str,
        chunks: list[str],
        vectors: list[list[float]],
        block_indices: list[int],
        metadata: dict | None = None,
    ) -> None:
        """
        Upsert chunks with explicit block_indices so chunk_index in Qdrant
        matches ParsedContent.block_index in PostgreSQL.
        This ensures LLM edit diffs (which reference block_index) correctly
        map back to the right chunk during edit application.
        """
        extra = metadata or {}
        points = [
            qm.PointStruct(
                id=str(uuid.uuid4()),
                vector=vector,
                payload={"doc_id": doc_id, "chunk_index": block_idx, "text": chunk, **extra},
            )
            for chunk, vector, block_idx in zip(chunks, vectors, block_indices)
        ]
        if points:
            self._client.upsert(collection_name=_COLLECTION, points=points)
            logger.info(
                "Upserted %d vectors (by block_index) for doc_id=%s.", len(points), doc_id
            )

    def search_chunks(self, vector: list[float], doc_id: str, top_k: int = 5) -> list:
        try:
            return self._client.query_points(
                collection_name=_COLLECTION,
                query=vector,
                query_filter=qm.Filter(
                    must=[qm.FieldCondition(key="doc_id", match=qm.MatchValue(value=doc_id))]
                ),
                limit=top_k,
                with_payload=True,
            ).points
        except Exception:
            logger.exception("Qdrant search failed for doc_id=%s.", doc_id)
            return []
