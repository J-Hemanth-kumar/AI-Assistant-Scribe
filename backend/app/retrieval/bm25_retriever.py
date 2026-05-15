"""
BM25 sparse retriever — exact keyword matching over parsed document content.

This is the sparse leg of the hybrid dense+sparse retrieval pipeline:
  Dense  : VectorRetriever  — Qdrant cosine similarity (semantic)
  Sparse : BM25Retriever    — BM25Okapi keyword scoring (statistical)
  Memory : MemPalaceRetriever — conversational episodic memory

BM25 (Best Match 25) scores chunks using:
  - Term frequency (TF) within a chunk, with saturation at k1=1.5
  - Inverse document frequency (IDF) across ALL chunks for the doc
  - Document-length normalisation (b=0.75)

This catches what dense vectors miss: exact names, error codes, version
numbers, and rare domain terms that have no semantic neighbourhood.

Both legs feed into RRFScorer (reciprocal rank fusion) so neither
dominates — the combined ranking rewards chunks that score well in BOTH.
"""
from __future__ import annotations

import logging
import re
import uuid

from app.db.models import ParsedContent
from app.db.session import SessionLocal
from app.retrieval.base import BaseRetriever, RetrievalResult

logger = logging.getLogger(__name__)


def _tokenize(text: str) -> list[str]:
    """
    Word-boundary tokeniser. Lowercases and strips punctuation.
    Short tokens (<2 chars) are dropped — they carry no BM25 signal.
    """
    return [w for w in re.findall(r"\b\w+\b", text.lower()) if len(w) >= 2]


class BM25Retriever(BaseRetriever):
    """
    Sparse BM25 retrieval over ParsedContent stored in PostgreSQL.

    On every call the corpus is loaded fresh from PostgreSQL so it always
    reflects the latest parsed blocks. For large corpora (>50k chunks) a
    warm-cache strategy can be added later with an invalidation hook in
    embed_document.
    """

    source = "bm25"

    def retrieve(
        self,
        query: str,
        *,
        doc_id: str | None = None,
        session_id: str | None = None,
        top_k: int = 5,
    ) -> list[RetrievalResult]:
        if not doc_id:
            # BM25 is document-scoped; skip for general chat
            return []

        try:
            uuid.UUID(doc_id)
        except ValueError:
            logger.warning("BM25Retriever: invalid doc_id format '%s'", doc_id)
            return []

        corpus_items = self._load_corpus(doc_id)
        if not corpus_items:
            logger.debug("BM25Retriever: empty corpus for doc_id=%s", doc_id)
            return []

        try:
            from rank_bm25 import BM25Okapi
        except ImportError:
            logger.error(
                "rank-bm25 not installed. Add 'rank-bm25' to requirements.txt "
                "and run: pip install rank-bm25"
            )
            return []

        # ── Build BM25 index ─────────────────────────────────────────────
        tokenized_corpus = [_tokenize(item["text"]) for item in corpus_items]
        bm25 = BM25Okapi(tokenized_corpus)

        # ── Score ────────────────────────────────────────────────────────
        query_tokens = _tokenize(query)
        if not query_tokens:
            return []

        scores = bm25.get_scores(query_tokens)  # ndarray, one score per chunk

        # ── Rank & filter zero-score hits ────────────────────────────────
        ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)

        results: list[RetrievalResult] = []
        for idx, score in ranked[:top_k]:
            if score <= 0.0:
                # BM25 returns 0 when no query term appears in the chunk
                break
            item = corpus_items[idx]
            results.append(
                RetrievalResult(
                    text=item["text"],
                    score=float(score),
                    source=self.source,
                    metadata={
                        "doc_id": doc_id,
                        "chunk_index": item["block_index"],
                        "page_no": item["page_no"],
                        "match_type": "bm25_okapi",
                    },
                )
            )

        logger.debug(
            "BM25Retriever: %d results for doc_id=%s query='%s'",
            len(results), doc_id, query[:60],
        )
        return results

    def is_available(self) -> bool:
        """
        Available when rank_bm25 is importable.
        No external service dependency.
        """
        try:
            from rank_bm25 import BM25Okapi  # noqa: F401
            return True
        except ImportError:
            return False

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _load_corpus(doc_id: str) -> list[dict]:
        """
        Load all non-empty ParsedContent blocks for a doc from PostgreSQL.
        Ordered by block_index for stable ranking.
        """
        doc_uuid = uuid.UUID(doc_id)
        with SessionLocal() as db:
            rows = (
                db.query(ParsedContent)
                .filter(ParsedContent.doc_id == doc_uuid)
                .order_by(ParsedContent.block_index)
                .all()
            )
            return [
                {
                    "text": row.text,
                    "block_index": row.block_index,
                    "page_no": row.page_no,
                }
                for row in rows
                if row.text and row.text.strip()
            ]