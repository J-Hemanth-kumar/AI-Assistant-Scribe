"""
MongoDB-backed MemPalace storage backend.

Implements BaseBackend + BaseCollection from mempalace.backends.base using
pymongo with MongoDB 7.0 vector search capabilities.

Replaces the default ChromaDB backend so that MemPalace's memory drawers
are stored in MongoDB instead of ChromaDB — one shared MongoDB instance
for the entire Scribe stack.
"""
import logging
import uuid
from typing import Optional

from pymongo import MongoClient
from pymongo.collection import Collection as MongoNativeCollection
from pymongo.errors import OperationFailure

from mempalace.backends.base import (
    BaseBackend,
    BaseCollection,
    BackendClosedError,
    DimensionMismatchError,
    GetResult,
    HealthStatus,
    PalaceNotFoundError,
    PalaceRef,
    QueryResult,
)

from app.core.config import settings

logger = logging.getLogger(__name__)

# BGE-M3 dimensionality (same model used by MemPalace's default embedder)
_VECTOR_DIM = 1024


class MongoCollection(BaseCollection):
    """
    Per-collection read/write surface backed by a MongoDB collection.

    Each MemPalace collection maps to a MongoDB collection within the
    ``mempalace`` database. Documents are stored with:
      - _id: str (the MemPalace drawer ID)
      - document: str (verbatim text content)
      - metadata: dict (wing, room, source_file, timestamp, etc.)
      - embedding: list[float] (vector for similarity search)
    """

    def __init__(self, col: MongoNativeCollection) -> None:
        self._col = col
        self._closed = False
        self._ensure_vector_index()

    def _check_closed(self) -> None:
        if self._closed:
            raise BackendClosedError("MongoCollection is closed")

    def _ensure_vector_index(self) -> None:
        """Create the vector search index if it doesn't exist."""
        try:
            existing_indexes = list(self._col.list_search_indexes())
            has_vector_idx = any(
                idx.get("name") == "vector_index" for idx in existing_indexes
            )
            if not has_vector_idx:
                self._col.create_search_index(
                    {
                        "definition": {
                            "mappings": {
                                "dynamic": True,
                                "fields": {
                                    "embedding": {
                                        "type": "knnVector",
                                        "dimensions": _VECTOR_DIM,
                                        "similarity": "cosine",
                                    }
                                },
                            }
                        },
                        "name": "vector_index",
                    }
                )
                logger.info(
                    "Created MongoDB vector search index on '%s'.", self._col.name
                )
        except OperationFailure:
            # MongoDB Community Edition doesn't support Atlas Search indexes.
            # Fall back to brute-force cosine in query() if $vectorSearch fails.
            logger.warning(
                "Could not create Atlas vector search index on '%s'. "
                "Falling back to brute-force cosine similarity.",
                self._col.name,
            )
        except Exception:
            logger.exception("Failed to ensure vector index on '%s'.", self._col.name)

    # ── Writes ──────────────────────────────────────────────────────────────

    def add(
        self,
        *,
        documents: list[str],
        ids: list[str],
        metadatas: Optional[list[dict]] = None,
        embeddings: Optional[list[list[float]]] = None,
    ) -> None:
        self._check_closed()
        metas = metadatas or [{}] * len(ids)
        embs = embeddings or [None] * len(ids)
        docs_to_insert = []
        for doc_id, text, meta, emb in zip(ids, documents, metas, embs):
            record = {
                "_id": doc_id,
                "document": text,
                "metadata": meta,
            }
            if emb is not None:
                record["embedding"] = emb
            docs_to_insert.append(record)
        if docs_to_insert:
            self._col.insert_many(docs_to_insert, ordered=False)

    def upsert(
        self,
        *,
        documents: list[str],
        ids: list[str],
        metadatas: Optional[list[dict]] = None,
        embeddings: Optional[list[list[float]]] = None,
    ) -> None:
        self._check_closed()
        metas = metadatas or [{}] * len(ids)
        embs = embeddings or [None] * len(ids)
        from pymongo import UpdateOne

        ops = []
        for doc_id, text, meta, emb in zip(ids, documents, metas, embs):
            update_fields: dict = {
                "document": text,
                "metadata": meta,
            }
            if emb is not None:
                update_fields["embedding"] = emb
            ops.append(
                UpdateOne(
                    {"_id": doc_id},
                    {"$set": update_fields},
                    upsert=True,
                )
            )
        if ops:
            self._col.bulk_write(ops, ordered=False)

    # ── Reads ───────────────────────────────────────────────────────────────

    def query(
        self,
        *,
        query_texts: Optional[list[str]] = None,
        query_embeddings: Optional[list[list[float]]] = None,
        n_results: int = 10,
        where: Optional[dict] = None,
        where_document: Optional[dict] = None,
        include: Optional[list[str]] = None,
    ) -> QueryResult:
        self._check_closed()
        if not query_embeddings:
            return QueryResult.empty()

        all_ids, all_docs, all_metas, all_dists = [], [], [], []
        for qvec in query_embeddings:
            ids, docs, metas, dists = self._single_vector_query(
                qvec, n_results, where
            )
            all_ids.append(ids)
            all_docs.append(docs)
            all_metas.append(metas)
            all_dists.append(dists)

        return QueryResult(
            ids=all_ids,
            documents=all_docs,
            metadatas=all_metas,
            distances=all_dists,
        )

    def _single_vector_query(
        self, vector: list[float], limit: int, where: Optional[dict] = None
    ) -> tuple[list[str], list[str], list[dict], list[float]]:
        """Execute a single vector similarity search."""
        # Try Atlas $vectorSearch first
        try:
            return self._atlas_vector_search(vector, limit, where)
        except OperationFailure:
            pass
        # Fallback: brute-force cosine over all documents with embeddings
        return self._brute_force_cosine(vector, limit, where)

    def _atlas_vector_search(
        self, vector: list[float], limit: int, where: Optional[dict] = None
    ) -> tuple[list[str], list[str], list[dict], list[float]]:
        """MongoDB Atlas $vectorSearch aggregation."""
        pipeline: list[dict] = [
            {
                "$vectorSearch": {
                    "index": "vector_index",
                    "path": "embedding",
                    "queryVector": vector,
                    "numCandidates": limit * 10,
                    "limit": limit,
                }
            },
            {"$addFields": {"score": {"$meta": "vectorSearchScore"}}},
        ]
        if where:
            mongo_filter = self._where_to_mongo_filter(where)
            if mongo_filter:
                pipeline.append({"$match": mongo_filter})

        results = list(self._col.aggregate(pipeline))
        ids = [str(r["_id"]) for r in results]
        docs = [r.get("document", "") for r in results]
        metas = [r.get("metadata", {}) for r in results]
        # Convert score to distance (1 - cosine_similarity)
        dists = [1.0 - r.get("score", 0.0) for r in results]
        return ids, docs, metas, dists

    def _brute_force_cosine(
        self, vector: list[float], limit: int, where: Optional[dict] = None
    ) -> tuple[list[str], list[str], list[dict], list[float]]:
        """Fallback: compute cosine similarity in Python."""
        import math

        query_filter: dict = {"embedding": {"$exists": True}}
        if where:
            mongo_filter = self._where_to_mongo_filter(where)
            if mongo_filter:
                query_filter.update(mongo_filter)

        cursor = self._col.find(query_filter)
        scored = []
        vec_norm = math.sqrt(sum(x * x for x in vector))
        if vec_norm == 0:
            return [], [], [], []

        for doc in cursor:
            emb = doc.get("embedding", [])
            if not emb:
                continue
            dot = sum(a * b for a, b in zip(vector, emb))
            emb_norm = math.sqrt(sum(x * x for x in emb))
            if emb_norm == 0:
                continue
            sim = dot / (vec_norm * emb_norm)
            scored.append((sim, doc))

        scored.sort(key=lambda x: x[0], reverse=True)
        top = scored[:limit]

        ids = [str(d["_id"]) for _, d in top]
        docs = [d.get("document", "") for _, d in top]
        metas = [d.get("metadata", {}) for _, d in top]
        dists = [1.0 - s for s, _ in top]
        return ids, docs, metas, dists

    @staticmethod
    def _where_to_mongo_filter(where: dict) -> dict:
        """Convert MemPalace-style where clause to MongoDB filter."""
        mongo_filter = {}
        for key, value in where.items():
            if key.startswith("$"):
                # Logical operators ($and, $or)
                continue
            mongo_filter[f"metadata.{key}"] = value
        return mongo_filter

    def get(
        self,
        *,
        ids: Optional[list[str]] = None,
        where: Optional[dict] = None,
        where_document: Optional[dict] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        include: Optional[list[str]] = None,
    ) -> GetResult:
        self._check_closed()
        query_filter: dict = {}
        if ids:
            query_filter["_id"] = {"$in": ids}
        if where:
            mongo_filter = self._where_to_mongo_filter(where)
            query_filter.update(mongo_filter)

        cursor = self._col.find(query_filter)
        if offset:
            cursor = cursor.skip(offset)
        if limit:
            cursor = cursor.limit(limit)

        result_ids, result_docs, result_metas = [], [], []
        for doc in cursor:
            result_ids.append(str(doc["_id"]))
            result_docs.append(doc.get("document", ""))
            result_metas.append(doc.get("metadata", {}))

        return GetResult(ids=result_ids, documents=result_docs, metadatas=result_metas)

    def delete(
        self,
        *,
        ids: Optional[list[str]] = None,
        where: Optional[dict] = None,
    ) -> None:
        self._check_closed()
        query_filter: dict = {}
        if ids:
            query_filter["_id"] = {"$in": ids}
        if where:
            mongo_filter = self._where_to_mongo_filter(where)
            query_filter.update(mongo_filter)
        if query_filter:
            self._col.delete_many(query_filter)

    def count(self) -> int:
        self._check_closed()
        return self._col.count_documents({})

    def close(self) -> None:
        self._closed = True

    def health(self) -> HealthStatus:
        try:
            self._col.database.command("ping")
            return HealthStatus.healthy()
        except Exception as e:
            return HealthStatus.unhealthy(str(e))


class MongoBackend(BaseBackend):
    """
    MemPalace backend using MongoDB for vector storage.

    Each palace maps to a MongoDB database, each collection maps to a
    MongoDB collection within that database. This backend is registered
    with the MemPalace registry under the name ``mongo``.
    """

    name = "mongo"
    spec_version = "1.0"
    capabilities = frozenset()

    def __init__(self) -> None:
        self._client: MongoClient | None = None
        self._collections: dict[str, MongoCollection] = {}

    def _get_client(self) -> MongoClient:
        if self._client is None:
            self._client = MongoClient(settings.mongo_url)
            logger.info("MongoBackend: connected to %s", settings.mongo_url)
        return self._client

    def get_collection(
        self,
        *,
        palace: PalaceRef,
        collection_name: str,
        create: bool = False,
        options: Optional[dict] = None,
    ) -> BaseCollection:
        cache_key = f"{palace.id}:{collection_name}"
        if cache_key in self._collections:
            return self._collections[cache_key]

        client = self._get_client()
        db = client[settings.mongo_db]
        col = db[collection_name]

        if not create:
            # Check if collection exists
            existing = db.list_collection_names()
            if collection_name not in existing:
                raise PalaceNotFoundError(
                    f"Collection '{collection_name}' not found in palace '{palace.id}'"
                )

        wrapped = MongoCollection(col)
        self._collections[cache_key] = wrapped
        return wrapped

    def close_palace(self, palace: PalaceRef) -> None:
        keys_to_remove = [k for k in self._collections if k.startswith(f"{palace.id}:")]
        for k in keys_to_remove:
            try:
                self._collections[k].close()
            except Exception:
                pass
            del self._collections[k]

    def close(self) -> None:
        for col in self._collections.values():
            try:
                col.close()
            except Exception:
                pass
        self._collections.clear()
        if self._client:
            self._client.close()
            self._client = None

    def health(self, palace: Optional[PalaceRef] = None) -> HealthStatus:
        try:
            client = self._get_client()
            client.admin.command("ping")
            return HealthStatus.healthy("MongoDB is reachable")
        except Exception as e:
            return HealthStatus.unhealthy(str(e))

    @classmethod
    def detect(cls, path: str) -> bool:
        # MongoDB backend is not detectable from a filesystem path
        return False
