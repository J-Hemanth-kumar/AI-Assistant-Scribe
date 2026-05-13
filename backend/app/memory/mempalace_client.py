"""
MemPalace client — singleton wrapper for the MemPalace memory system.

Registers our custom MongoBackend so MemPalace stores drawers in MongoDB
instead of ChromaDB. Provides a high-level interface for search, store,
and wake-up operations.
"""
import logging
import threading
import uuid
from typing import Optional

from mempalace.backends.registry import register as mp_register
from mempalace.backends.base import PalaceRef
from mempalace.searcher import search_memories
from mempalace.layers import MemoryStack
from mempalace.config import MempalaceConfig

from app.core.config import settings
from app.memory.backends.mongo_backend import MongoBackend

logger = logging.getLogger(__name__)

_lock = threading.Lock()


class MemPalaceClient:
    """
    Singleton wrapper around MemPalace with MongoDB backend.

    Usage:
        client = MemPalaceClient()
        results = client.search("why did we switch to GraphQL", room="session-123")
        client.store("some text", room="session-456", metadata={...})
    """

    _instance: "MemPalaceClient | None" = None
    _initialized: bool = False

    def __new__(cls) -> "MemPalaceClient":
        if cls._instance is None:
            with _lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return
        with _lock:
            if self._initialized:
                return
            self._wing = settings.mempalace_wing
            self._palace_path = settings.mempalace_path

            # Register our MongoDB backend so MemPalace uses it
            self._backend = MongoBackend()
            mp_register("mongo", MongoBackend)

            # Set environment variable so MemPalace resolves to our backend
            import os
            os.environ.setdefault("MEMPALACE_BACKEND", "mongo")

            self._stack: MemoryStack | None = None
            self._palace_ref = PalaceRef(
                id=self._wing,
                local_path=self._palace_path,
            )
            self._initialized = True
            logger.info(
                "MemPalaceClient initialized: wing=%s, backend=mongo, palace_path=%s",
                self._wing,
                self._palace_path,
            )

    def _get_collection(self, collection_name: str = "mempalace_drawers"):
        """Get or create a MemPalace collection from the MongoDB backend."""
        return self._backend.get_collection(
            palace=self._palace_ref,
            collection_name=collection_name,
            create=True,
        )

    def _get_stack(self) -> MemoryStack:
        """Lazy-init MemoryStack."""
        if self._stack is None:
            self._stack = MemoryStack(palace_path=self._palace_path)
        return self._stack

    # ── Public API ──────────────────────────────────────────────────────────

    def search(
        self,
        query: str,
        *,
        room: str | None = None,
        n_results: int = 5,
    ) -> list[dict]:
        """
        Search MemPalace for memories matching the query.

        Returns a list of dicts with keys: text, wing, room, source_file, similarity.
        """
        try:
            result = search_memories(
                query=query,
                palace_path=self._palace_path,
                wing=self._wing,
                room=room,
                n_results=n_results,
            )
            return result.get("results", [])
        except Exception:
            logger.exception("MemPalace search failed for query='%s'", query[:80])
            return []

    def store(
        self,
        text: str,
        *,
        room: str,
        metadata: dict | None = None,
        drawer_id: str | None = None,
    ) -> str:
        """
        Store a text fragment into MemPalace as a drawer.

        Returns the drawer ID.
        """
        drawer_id = drawer_id or str(uuid.uuid4())
        meta = {
            "wing": self._wing,
            "room": room,
            **(metadata or {}),
        }

        try:
            col = self._get_collection()
            # Embed the text using MemPalace's embedder
            from app.services.embedder import Embedder
            embedder = Embedder()
            vectors = embedder.embed_texts([text])

            col.add(
                documents=[text],
                ids=[drawer_id],
                metadatas=[meta],
                embeddings=vectors if vectors else None,
            )
            logger.debug(
                "Stored drawer %s in room=%s wing=%s (%d chars)",
                drawer_id, room, self._wing, len(text),
            )
        except Exception:
            logger.exception("MemPalace store failed for drawer_id=%s", drawer_id)
        return drawer_id

    def wake_up(self) -> str:
        """
        Return MemPalace wake-up context (~600-900 tokens).
        Contains identity + essential story from the palace.
        """
        try:
            stack = self._get_stack()
            return stack.wake_up(wing=self._wing)
        except Exception:
            logger.exception("MemPalace wake_up failed")
            return ""

    def recall(
        self,
        *,
        room: str | None = None,
        n_results: int = 10,
    ) -> str:
        """
        Recall recent memories from a room (L2 retrieval).
        Returns formatted context string.
        """
        try:
            stack = self._get_stack()
            return stack.recall(wing=self._wing, room=room, n_results=n_results)
        except Exception:
            logger.exception("MemPalace recall failed for room=%s", room)
            return ""

    def get_stats(self) -> dict:
        """Return MemPalace status and stats."""
        try:
            col = self._get_collection()
            return {
                "backend": "mongo",
                "wing": self._wing,
                "drawer_count": col.count(),
                "health": col.health().ok,
            }
        except Exception:
            logger.exception("MemPalace stats failed")
            return {"backend": "mongo", "error": "unavailable"}
