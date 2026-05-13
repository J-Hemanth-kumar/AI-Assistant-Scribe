import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes.upload import router as upload_router
from app.api.routes.edit import router as edit_router
from app.api.routes.export import router as export_router
from app.api.routes.sessions import router as sessions_router
from app.api.websocket.chat import router as ws_router
from app.core.config import settings
from app.core.logging import configure_logging
from app.db.init_db import init_db
from app.services.minio_service import MinioService

logger = logging.getLogger(__name__)


# FIX: use lifespan instead of deprecated @app.on_event("startup")
@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(settings.log_level)
    logger.info("Starting Scribe backend (env=%s)...", settings.app_env)
    init_db()
    MinioService().ensure_bucket()
    
    # Initialize MemPalace + MongoDB connection
    from app.memory.mempalace_client import MemPalaceClient
    MemPalaceClient()
    
    logger.info("Startup complete.")
    yield
    logger.info("Shutting down.")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Scribe — AI Document Editor",
        version="2.0.0",
        lifespan=lifespan,
    )

    # FIX: allow_origins uses settings list, NOT "*" with allow_credentials
    # "*" + allow_credentials=True is rejected by browsers per CORS spec.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Global error handler — returns JSON instead of HTML 500 pages
    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "An internal error occurred."})

    # REST routes
    app.include_router(upload_router, prefix="/api/v1")
    app.include_router(edit_router, prefix="/api/v1")
    app.include_router(export_router, prefix="/api/v1")
    app.include_router(sessions_router, prefix="/api/v1")

    # WebSocket route (no /api/v1 prefix — ws://localhost:18000/ws/chat)
    app.include_router(ws_router)

    @app.get("/", tags=["health"])
    def root():
        return {"service": "scribe", "version": "2.0.0", "docs": "/docs"}

    @app.get("/health", tags=["health"])
    def health():
        return {"status": "ok"}

    return app


app = create_app()
