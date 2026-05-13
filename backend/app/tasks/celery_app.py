from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "scribe",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    # FIX: correct module path — was "app.tasks.document_tasks" without the package prefix
    include=["app.tasks.document_tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    broker_connection_retry_on_startup=True,
    task_routes={
        "app.tasks.document_tasks.parse_document": {"queue": "parse"},
        "app.tasks.document_tasks.embed_document": {"queue": "parse"},
    },
)
