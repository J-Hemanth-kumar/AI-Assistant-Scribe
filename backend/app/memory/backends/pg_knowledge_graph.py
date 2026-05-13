"""
PostgreSQL-backed Knowledge Graph for MemPalace.

Replaces MemPalace's default SQLite-backed KnowledgeGraph with PostgreSQL,
using the existing Scribe PostgreSQL instance via SQLAlchemy.

Provides the same API surface as mempalace.knowledge_graph.KnowledgeGraph:
  - add_entity(name, entity_type, properties)
  - add_triple(subject, predicate, obj, valid_from, valid_to, confidence, ...)
  - invalidate(subject, predicate, obj, ended)
  - query_entity(name, as_of, direction)
  - query_relationship(predicate, as_of)
  - timeline(entity_name)
  - stats()
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, func, and_, or_

from app.db.models import KnowledgeGraphEntity, KnowledgeGraphTriple
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)


class PgKnowledgeGraph:
    """PostgreSQL-backed knowledge graph with temporal validity windows."""

    # ── Write Methods ───────────────────────────────────────────────────────

    def add_entity(
        self,
        name: str,
        entity_type: str = "unknown",
        properties: dict | None = None,
    ) -> str:
        """Add or update an entity. Returns the entity name."""
        with SessionLocal() as db:
            existing = db.execute(
                select(KnowledgeGraphEntity).where(
                    KnowledgeGraphEntity.name == name
                )
            ).scalar_one_or_none()

            if existing:
                existing.entity_type = entity_type
                if properties:
                    existing.properties = {**(existing.properties or {}), **properties}
            else:
                db.add(
                    KnowledgeGraphEntity(
                        name=name,
                        entity_type=entity_type,
                        properties=properties,
                    )
                )
            db.commit()
        return name

    def add_triple(
        self,
        subject: str,
        predicate: str,
        obj: str,
        valid_from: str | None = None,
        valid_to: str | None = None,
        confidence: float = 1.0,
        source_closet: str | None = None,
        source_file: str | None = None,
    ) -> str:
        """Add a triple. Auto-creates entities if they don't exist. Returns triple ID."""
        # Ensure both entities exist
        self.add_entity(subject)
        self.add_entity(obj)

        with SessionLocal() as db:
            triple = KnowledgeGraphTriple(
                subject=subject,
                predicate=predicate,
                object=obj,
                valid_from=valid_from,
                valid_to=valid_to,
                confidence=confidence,
                source_closet=source_closet,
                source_file=source_file,
            )
            db.add(triple)
            db.commit()
            db.refresh(triple)
            return str(triple.id)

    def invalidate(
        self,
        subject: str,
        predicate: str,
        obj: str,
        ended: str | None = None,
    ) -> None:
        """Mark a triple as ended/invalidated."""
        ended = ended or datetime.now(timezone.utc).isoformat()[:10]
        with SessionLocal() as db:
            triples = db.execute(
                select(KnowledgeGraphTriple).where(
                    and_(
                        KnowledgeGraphTriple.subject == subject,
                        KnowledgeGraphTriple.predicate == predicate,
                        KnowledgeGraphTriple.object == obj,
                        KnowledgeGraphTriple.ended.is_(None),
                    )
                )
            ).scalars().all()
            for t in triples:
                t.ended = ended
            db.commit()

    # ── Query Methods ───────────────────────────────────────────────────────

    def query_entity(
        self,
        name: str,
        as_of: str | None = None,
        direction: str = "outgoing",
    ) -> list[dict]:
        """Query all triples involving an entity."""
        with SessionLocal() as db:
            if direction == "outgoing":
                condition = KnowledgeGraphTriple.subject == name
            elif direction == "incoming":
                condition = KnowledgeGraphTriple.object == name
            else:  # "both"
                condition = or_(
                    KnowledgeGraphTriple.subject == name,
                    KnowledgeGraphTriple.object == name,
                )

            query = select(KnowledgeGraphTriple).where(condition)

            if as_of:
                query = query.where(
                    or_(
                        KnowledgeGraphTriple.valid_from.is_(None),
                        KnowledgeGraphTriple.valid_from <= as_of,
                    )
                ).where(
                    or_(
                        KnowledgeGraphTriple.ended.is_(None),
                        KnowledgeGraphTriple.ended > as_of,
                    )
                )

            results = db.execute(query).scalars().all()
            return [
                {
                    "id": t.id,
                    "subject": t.subject,
                    "predicate": t.predicate,
                    "object": t.object,
                    "valid_from": t.valid_from,
                    "valid_to": t.valid_to,
                    "ended": t.ended,
                    "confidence": t.confidence,
                    "source_closet": t.source_closet,
                    "source_file": t.source_file,
                }
                for t in results
            ]

    def query_relationship(
        self, predicate: str, as_of: str | None = None
    ) -> list[dict]:
        """Query all triples with a given predicate."""
        with SessionLocal() as db:
            query = select(KnowledgeGraphTriple).where(
                KnowledgeGraphTriple.predicate == predicate
            )
            if as_of:
                query = query.where(
                    or_(
                        KnowledgeGraphTriple.valid_from.is_(None),
                        KnowledgeGraphTriple.valid_from <= as_of,
                    )
                ).where(
                    or_(
                        KnowledgeGraphTriple.ended.is_(None),
                        KnowledgeGraphTriple.ended > as_of,
                    )
                )
            results = db.execute(query).scalars().all()
            return [
                {
                    "subject": t.subject,
                    "predicate": t.predicate,
                    "object": t.object,
                    "valid_from": t.valid_from,
                    "ended": t.ended,
                }
                for t in results
            ]

    def timeline(self, entity_name: str | None = None) -> list[dict]:
        """Get temporal timeline of triples, optionally filtered by entity."""
        with SessionLocal() as db:
            query = select(KnowledgeGraphTriple)
            if entity_name:
                query = query.where(
                    or_(
                        KnowledgeGraphTriple.subject == entity_name,
                        KnowledgeGraphTriple.object == entity_name,
                    )
                )
            query = query.order_by(KnowledgeGraphTriple.valid_from.asc())
            results = db.execute(query).scalars().all()
            return [
                {
                    "subject": t.subject,
                    "predicate": t.predicate,
                    "object": t.object,
                    "valid_from": t.valid_from,
                    "valid_to": t.valid_to,
                    "ended": t.ended,
                    "created_at": t.created_at.isoformat() if t.created_at else None,
                }
                for t in results
            ]

    def stats(self) -> dict:
        """Return knowledge graph statistics."""
        with SessionLocal() as db:
            entity_count = db.execute(
                select(func.count(KnowledgeGraphEntity.id))
            ).scalar() or 0
            triple_count = db.execute(
                select(func.count(KnowledgeGraphTriple.id))
            ).scalar() or 0
            active_triples = db.execute(
                select(func.count(KnowledgeGraphTriple.id)).where(
                    KnowledgeGraphTriple.ended.is_(None)
                )
            ).scalar() or 0
            return {
                "entities": entity_count,
                "triples": triple_count,
                "active_triples": active_triples,
                "invalidated_triples": triple_count - active_triples,
            }
