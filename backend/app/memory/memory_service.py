"""
Memory service — high-level memory CRUD for the Scribe chatbot.

Orchestrates MemPalace storage/retrieval and PostgreSQL metadata tracking.
Each conversation turn (user + assistant) is stored as one MemPalace drawer
with a corresponding ChatMessage row in PostgreSQL for metadata.
"""
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from app.db.models import ChatMessage
from app.db.session import SessionLocal
from app.memory.mempalace_client import MemPalaceClient

logger = logging.getLogger(__name__)


@dataclass
class MemoryResult:
    """A single memory retrieval result."""
    text: str
    similarity: float
    source: str  # "mempalace"
    room: str
    wing: str
    metadata: dict


class MemoryService:
    """
    Orchestrates memory read/write operations.

    - recall(): Search MemPalace for relevant conversational memories
    - store_conversation(): Store a user+assistant turn as one drawer
    - get_boot_context(): Return MemPalace wake-up context
    """

    def __init__(self) -> None:
        self._client = MemPalaceClient()

    def recall(
        self,
        query: str,
        *,
        session_id: str | None = None,
        n_results: int = 5,
    ) -> list[MemoryResult]:
        """
        Search MemPalace for memories matching the query.

        If session_id is provided, searches within that session's room.
        Otherwise searches across all rooms in the scribe wing.
        """
        results = self._client.search(
            query,
            room=session_id,
            n_results=n_results,
        )
        return [
            MemoryResult(
                text=r.get("text", ""),
                similarity=r.get("similarity", 0.0),
                source="mempalace",
                room=r.get("room", ""),
                wing=r.get("wing", ""),
                metadata=r,
            )
            for r in results
        ]

    def store_conversation(
        self,
        *,
        session_id: str,
        user_msg: str,
        assistant_msg: str,
        doc_id: str | None = None,
        turn_index: int = 0,
    ) -> str | None:
        """
        Store a conversation turn (user + assistant) as one MemPalace drawer.

        Also persists metadata rows in PostgreSQL (ChatMessage).
        Returns the MemPalace drawer ID, or None on failure.
        """
        # Format the turn for MemPalace storage
        turn_text = f"User: {user_msg}\n\nAssistant: {assistant_msg}"
        timestamp = datetime.now(timezone.utc).isoformat()

        metadata = {
            "session_id": session_id,
            "turn_index": turn_index,
            "timestamp": timestamp,
            "source": "chat",
        }
        if doc_id:
            metadata["doc_id"] = doc_id

        # Store in MemPalace
        drawer_id = self._client.store(
            turn_text,
            room=session_id,
            metadata=metadata,
        )

        # Store metadata in PostgreSQL
        try:
            with SessionLocal() as db:
                session_uuid = uuid.UUID(session_id)
                doc_uuid = uuid.UUID(doc_id) if doc_id else None

                user_row = ChatMessage(
                    session_id=session_uuid,
                    doc_id=doc_uuid,
                    role="user",
                    content=user_msg,
                    mempalace_drawer_id=drawer_id,
                    turn_index=turn_index,
                )
                assistant_row = ChatMessage(
                    session_id=session_uuid,
                    doc_id=doc_uuid,
                    role="assistant",
                    content=assistant_msg,
                    mempalace_drawer_id=drawer_id,
                    turn_index=turn_index,
                )
                db.add(user_row)
                db.add(assistant_row)
                db.commit()
        except Exception:
            logger.exception(
                "Failed to persist ChatMessage rows for session=%s turn=%d",
                session_id, turn_index,
            )

        return drawer_id

    def get_boot_context(self, session_id: str | None = None) -> str:
        """
        Return MemPalace wake-up context (~600-900 tokens).

        Useful for priming the LLM with identity + essential story at
        the start of a conversation.
        """
        return self._client.wake_up()

    def get_turn_count(self, session_id: str) -> int:
        """Get the number of conversation turns for a session."""
        try:
            with SessionLocal() as db:
                from sqlalchemy import select, func
                count = db.execute(
                    select(func.count(ChatMessage.id)).where(
                        ChatMessage.session_id == uuid.UUID(session_id),
                        ChatMessage.role == "user",
                    )
                ).scalar() or 0
                return count
        except Exception:
            return 0

    def get_stats(self) -> dict:
        """Return memory system stats."""
        return self._client.get_stats()

    def get_recent_turns(
        self,
        session_id: str,
        n_pairs: int = 6,
    ) -> list[dict[str, str]]:
        """
        Return the last `n_pairs` user+assistant turn PAIRS for a session.

        Returns a flat list of {role, content} dicts ordered oldest->newest,
        suitable for direct injection into the Groq messages array as
        native multi-turn conversation history.

        Why PostgreSQL here and not MemPalace?
        PostgreSQL ChatMessage rows hold verbatim turns with role metadata.
        MemPalace stores episodic summaries used by the retrieval pipeline
        for semantic similarity -- not for exact turn reconstruction.
        Using the right store for the right job keeps both clean and fast.
        """
        try:
            from sqlalchemy import select
            with SessionLocal() as db:
                rows = (
                    db.execute(
                        select(ChatMessage.role, ChatMessage.content)
                        .where(ChatMessage.session_id == uuid.UUID(session_id))
                        .order_by(ChatMessage.turn_index, ChatMessage.id)
                    )
                    .fetchall()
                )
            # Take last n_pairs * 2 rows (each pair = 1 user + 1 assistant)
            tail = rows[-(n_pairs * 2):]
            return [{"role": r.role, "content": r.content} for r in tail]
        except Exception:
            logger.exception(
                "get_recent_turns failed for session=%s", session_id
            )
            return []