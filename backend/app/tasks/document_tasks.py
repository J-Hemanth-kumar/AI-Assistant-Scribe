import logging
from uuid import UUID

from celery import Task

from app.db.models import DocumentStatus
from app.services.document_service import DocumentService
from app.services.minio_service import MinioService
from app.services.parse_service import ParsingService
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


class DocumentParsingTask(Task):
    def on_failure(self, exc, task_id, args, kwargs, einfo):
        if not args:
            return
        try:
            doc_id = UUID(str(args[0]))
            DocumentService().set_status(doc_id, DocumentStatus.failed, progress=100)
        except Exception:
            logger.exception("Failed setting status=failed for doc_id=%s", args[0])


@celery_app.task(
    bind=True,
    base=DocumentParsingTask,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
    name="app.tasks.document_tasks.parse_document",
)
def parse_document(self, doc_id: str) -> dict:
    doc_uuid = UUID(doc_id)
    doc_svc = DocumentService()
    minio = MinioService()
    parser = ParsingService()

    doc_svc.set_status(doc_uuid, DocumentStatus.parsing, progress=5)
    doc = doc_svc.get_document(doc_uuid)

    doc_svc.set_status(doc_uuid, DocumentStatus.parsing, progress=10)
    data = minio.get_object_bytes(doc.s3_key)

    doc_svc.set_status(doc_uuid, DocumentStatus.parsing, progress=40)
    blocks = parser.parse_bytes(data=data, filename=doc.filename, content_type=doc.content_type)

    doc_svc.set_status(doc_uuid, DocumentStatus.parsing, progress=70)
    cleaned = parser.clean_and_prepare_blocks(blocks)
    if not cleaned:
        raise ValueError(f"No content extracted from {doc.filename}")

    parser.save_parsed_blocks(doc_id=doc_uuid, blocks=cleaned)
    # Don't set status to parsed yet — embedding still needs to happen
    doc_svc.set_status(doc_uuid, DocumentStatus.parsing, progress=70)
    logger.info("parse_document completed for doc_id=%s (%d blocks)", doc_id, len(cleaned))

    embed_document.delay(doc_id)
    return {"doc_id": doc_id, "status": "parsed", "blocks": len(cleaned)}


@celery_app.task(name="app.tasks.document_tasks.embed_document")
def embed_document(doc_id: str) -> None:
    """
    Index each ParsedContent block into Qdrant using its actual block_index.

    FIX: Previously, all blocks were joined into one string and re-chunked with
    Chunker, producing new chunk indices that didn't match ParsedContent.block_index.
    The LLM edit diffs reference block_index from PostgreSQL, so Qdrant MUST store
    each block with that same block_index as chunk_index — otherwise edits are
    applied to the wrong (or missing) chunks and the edit appears to do nothing.
    """
    doc_uuid = UUID(doc_id)
    doc_svc = DocumentService()
    
    # Set status to indexing at start of background task
    doc_svc.set_status(doc_uuid, DocumentStatus.indexing, progress=75)
    
    doc = doc_svc.get_document(doc_uuid)
    parsed = doc.parsed_contents

    if not parsed:
        logger.warning("No parsed contents for doc_id=%s — skipping embed.", doc_id)
        return

    # Filter to blocks that have actual text
    valid_blocks = [pc for pc in parsed if pc.text and pc.text.strip()]
    if not valid_blocks:
        logger.warning("Empty text for doc_id=%s — skipping embed.", doc_id)
        return

    from app.services.embedder import Embedder
    from app.services.qdrant_service import QdrantService

    texts = [pc.text for pc in valid_blocks]
    # Use block_index as the chunk_index stored in Qdrant so it matches
    # the chunk_index the LLM returns in edit diffs.
    block_indices = [pc.block_index for pc in valid_blocks]

    vectors = Embedder().embed_texts(texts)

    qdrant = QdrantService()
    qdrant.upsert_chunks_with_indices(
        doc_id=doc_id,
        chunks=texts,
        vectors=vectors,
        block_indices=block_indices,
        metadata={"filename": doc.filename, "content_type": doc.content_type},
    )
    
    # ── MemPalace Ingestion ──────────────────────────────────────────────────
    try:
        from app.memory.memory_ingestor import MemoryIngestor
        ingestor = MemoryIngestor()
        
        # Ingest full chunks into MemPalace
        ingestor.ingest_parsed_blocks(
            doc_id=doc_id,
            filename=doc.filename,
            blocks=texts,
        )
        
        # Create a simple summary of the document for the knowledge graph
        # and store it in a single drawer.
        summary_text = (
            f"Document Title: {doc.filename}\n"
            f"Content Type: {doc.content_type}\n"
            f"Size: {len(valid_blocks)} blocks\n"
            f"First block: {texts[0][:200]}..."
        ) if texts else f"Empty document: {doc.filename}"
        
        ingestor.ingest_document_summary(
            doc_id=doc_id,
            filename=doc.filename,
            summary_text=summary_text,
        )
    except Exception:
        logger.exception("Failed to ingest document %s into MemPalace", doc_id)

    doc_svc.set_status(doc_uuid, DocumentStatus.parsed, progress=100)
    logger.info(
        "embed_document done for doc_id=%s: %d blocks indexed (block_indices=%s).",
        doc_id,
        len(valid_blocks),
        block_indices,
    )

