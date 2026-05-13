import logging

from app.db.base import Base
from app.db.session import engine
import app.db.models  # noqa: F401

logger = logging.getLogger(__name__)


def init_db() -> None:
    logger.info("Running create_all on all tables...")
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables ready.")
