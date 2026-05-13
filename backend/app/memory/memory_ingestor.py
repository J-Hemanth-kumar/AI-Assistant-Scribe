"""
Memory ingestor — background ingestion of content into MemPalace.

Handles ingestion of different content types with appropriate metadata:
  - conversations → stored per-turn in the session's room
  - documents     → stored as doc summary in a doc-specific room
"""
import logging

from app.memory.mempalace_client import MemPalaceClient

logger = logging.getLogger(__name__)


class MemoryIngestor:
    """
    Ingests content into MemPalace with type-specific metadata.

    Called from:
      - RAGChatService (after each chat turn)
      - document_tasks.embed_document (after document parsing)
    """

    def __init__(self) -> None:
        self._client = MemPalaceClient()

    def ingest_document_summary(
        self,
        *,
        doc_id: str,
        filename: str,
        summary_text: str,
        session_id: str | None = None,
    ) -> str | None:
        """
        Ingest a document summary into MemPalace.

        This allows the chatbot to recall which documents have been
        uploaded and what they contain, even across sessions.
        """
        if not summary_text or len(summary_text.strip()) < 20:
            logger.debug("Skipping doc summary ingestion: too short (doc_id=%s)", doc_id)
            return None

        room = session_id or f"doc_{doc_id}"
        metadata = {
            "type": "document",
            "doc_id": doc_id,
            "filename": filename,
            "source": "document_ingestion",
        }

        try:
            drawer_id = self._client.store(
                summary_text,
                room=room,
                metadata=metadata,
            )
            logger.info(
                "Ingested doc summary into MemPalace: doc_id=%s drawer=%s room=%s",
                doc_id, drawer_id, room,
            )
            return drawer_id
        except Exception:
            logger.exception("Failed to ingest doc summary for doc_id=%s", doc_id)
            return None

    def ingest_parsed_blocks(
        self,
        *,
        doc_id: str,
        filename: str,
        blocks: list[str],
        session_id: str | None = None,
    ) -> int:
        """
        Ingest parsed document blocks into MemPalace.

        Combines blocks into a summary-length text and stores it.
        Returns number of drawers created.
        """
        if not blocks:
            return 0

        # Combine blocks into manageable chunks for MemPalace
        # (~2000 chars per drawer to stay within embedding context)
        MAX_DRAWER_CHARS = 2000
        current_text = ""
        drawer_count = 0
        room = session_id or f"doc_{doc_id}"

        for block in blocks:
            if len(current_text) + len(block) + 2 > MAX_DRAWER_CHARS:
                if current_text.strip():
                    self._client.store(
                        current_text.strip(),
                        room=room,
                        metadata={
                            "type": "document_chunk",
                            "doc_id": doc_id,
                            "filename": filename,
                            "chunk_group": drawer_count,
                        },
                    )
                    drawer_count += 1
                current_text = block
            else:
                current_text += "\n\n" + block if current_text else block

        # Store remaining text
        if current_text.strip():
            self._client.store(
                current_text.strip(),
                room=room,
                metadata={
                    "type": "document_chunk",
                    "doc_id": doc_id,
                    "filename": filename,
                    "chunk_group": drawer_count,
                },
            )
            drawer_count += 1

        logger.info(
            "Ingested %d drawers from %d blocks for doc_id=%s",
            drawer_count, len(blocks), doc_id,
        )
        return drawer_count
