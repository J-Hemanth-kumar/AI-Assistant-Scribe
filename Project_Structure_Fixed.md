# Exported Document

Doc ID: 55a441a7-71ef-463d-807d-813e0936f1ae

# AI-ASSISTANT-SCRIBE — Production Multi-Repo Structure

> **Legend we won maara [M2] Module 2 — Document Parser (planned) [M3] Module 3 — RAG Pipeline (existing → migrated) [M4] Module 4 — LLM Editing Engine (existing → merged) [M5] Module 5 — PDF Export & Download (planned) [INFRA] Infrastructure / DevOps ## Root — Multi-Repo Layout ## scribe-backend/ ## scribe-frontend/ ## Module Migration Mapper.py                     ParsedContent rows → bbox layout dict
│   │       │                                        keyed by (page_no, chunk_index)
│   │       ├── pdf_exporter.py                      PyMuPDF: redact old text block at bbox,
│   │       │                                        insert updated_text preserving font/size
│   │       ├── html_exporter.py                     WeasyPrint: merged content → HTML → PDF
│   │       │                                        used for DOCX / TXT / MD originals
│   │       └── fallback_exporter.py                 ReportLab pure-Python fallback renderer
│   │
│   └── workers/                             ─── Celery task definitions ───
│       ├── __init__.py
│       ├── celery_app.py                    [INFRA]  Celery factory, Redis broker/backend,
│       │                                             beat schedule, worker concurrency config
│       ├── parse_worker.py                  [M2]     @celery_app.task
│       │                                             parse_document(doc_id, s3_key)
│       │                                             → downloads from MinIO → routes to parser
│       │                                             → saves ParsedContent → chains embed task
│       ├── embed_worker.py                  [M3]     @celery_app.task
│       │                                             embed_document(doc_id)
│       │                                             → fetches ParsedContent → chunk → embed
│       │                                             → upsert Qdrant → status=indexed
│       └── export_worker.py                 [M5]     @celery_app.task
│                                                     export_document(doc_id, version_id)
│                                                     → layout merge → PDF render → S3 upload
│                                                     → presigned URL → status=completed
│
├── tests/
│   ├── __init__.py
│   ├── conftest.py                          [INFRA]  pytest fixtures: test DB (SQLite),
│   │                                                 mock MinIO (moto), mock Qdrant, fake Gemini
│   ├── unit/
│   │   ├── __init__.py
│   │   ├── test_chunker.py                  [M3]     DocumentChunker chunk sizes, overlap
│   │   ├── test_embedder.py                 [M3]     EmbeddingService output shape (1024-dim)
│   │   ├── test_parsers.py                  [M2]     PDF/DOCX/image/text parser output schema
│   │   ├── test_edit_service.py             [M4]     Version save, undo, diff logic
│   │   └── test_export_service.py           [M5]     Layout merge correctness
│   └── integration/
│       ├── __init__.py
│       ├── test_upload_flow.py              [M1]     Upload → DB record → Celery enqueue
│       ├── test_rag_pipeline.py             [M3]     Embed → Qdrant upsert → retrieve top-k
│       └── test_edit_export.py              [M4+M5]  Edit diff → version save → export PDF
│
├── docker/
│   ├── Dockerfile.api                       [INFRA]  FastAPI image (slim, no ML models)
│   │                                                 Exposed port 8000
│   ├── Dockerfile.worker                    [INFRA]  Celery worker image (heavy: OCR, BGE-M3)
│   │                                                 Pre-downloads BAAI/bge-m3 at build time
│   └── nginx/
│       └── nginx.conf                       [INFRA]  Reverse proxy: /api → FastAPI :8000
│                                                     Static assets + gzip compression
│
├── scripts/
│   ├── seed_db.py                           [INFRA]  Populate test documents for dev
│   └── check_models.py                      [M3]     Verify BGE-M3 + reranker downloaded OK
│
├── .env.example                             [INFRA]  All required env vars with placeholders
├── .gitignore
├── alembic.ini                              [INFRA]  Points to app/db/migrations/
├── docker-compose.yml                       [INFRA]  Dev: api, worker, postgres, redis,
│                                                     minio, qdrant — single command startup
├── docker-compose.prod.yml                  [INFRA]  Prod: resource limits, named volumes,
│                                                     worker replicas, health checks
├── pyproject.toml                           [INFRA]  Project metadata, ruff, mypy, pytest config
├── requirements.txt                                  Pinned production deps
├── requirements-dev.txt                              Extra: pytest, ruff, mypy, httpx[test]
└── README.md
```

---

## scribe-frontend/

```
scribe-frontend/
│
├── src/
│   ├── components/
│   │   ├── sidebar/
│   │   │   └── Sidebar.tsx              Session history, new chat, settings nav
│   │   ├── chat/
│   │   │   ├── ChatWindow.tsx           Central chat panel + streaming output
│   │   │   ├── ChatInput.tsx            Textarea, drag-drop zone, send button
│   │   │   └── MessageBubble.tsx        User/bot bubbles, citations, evidence panels
│   │   ├── panel/
│   │   │   ├── RightPanel.tsx           Tabbed right-panel shell
│   │   │   ├── FilePanel.tsx            Upload zone + indexed file list with progress
│   │   │   └── SettingsPanel.tsx        Theme, streaming, URL config toggles
│   │   └── export/
│   │       └── ExportPanel.tsx          Format picker, options, preview modal, download
│   │
│   ├── context/
│   │   └── AppContext.tsx               useReducer global state (sessions, files, panel)
│   │
│   ├── hooks/
│   │   ├── useWebSocket.ts              WS connect, send, streaming token handlers
│   │   └── useFileUpload.ts             XHR multipart upload with progress tracking
│   │
│   ├── services/
│   │   ├── websocket.ts                 WS singleton, typed event bus, reconnect + ping
│   │   └── api.ts                       REST: upload, export, sessions (axios/fetch)
│   │
│   ├── types/
│   │   └── index.ts                     All TypeScript interfaces (Message, Session,
│   │                                    UploadedFile, Citation, ExportOptions, etc.)
│   └── utils/
│       └── id.ts                        generateId, file helpers, formatters,
│                                        citation parser ([N] → TextSegment[])
│
├── public/
│   └── favicon.svg
│
├── .env.example                         VITE_WS_URL, VITE_API_BASE_URL
├── .gitignore
├── index.html                           Entry HTML, Google Fonts (Plus Jakarta Sans)
├── tailwind.config.js                   Custom tokens: accent, surface scale, animations
├── postcss.config.js
├── vite.config.ts                       Aliases (@/), dev proxy /api → :8000, /ws → :8000
├── tsconfig.json
├── tsconfig.node.json
├── package.json
└── README.md
```

---

## Module Migration Map

| Old location | New location | Notes |
|---|---|---|
| `module3/chunker.py` | `app/modules/module3_rag/chunker.py` | No code change needed |
| `module3/embedder.py` | `app/modules/module3_rag/embedder.py` | No code change needed |
| `module3/qdrant_service.py` | `app/modules/module3_rag/qdrant_service.py` | No code change needed |
| `module3/rag_service.py` | `app/modules/module3_rag/rag_service.py` | Remove sys.path hack; use `from app.modules.module3_rag` |
| `module4/main.py` | `app/main.py` | Merge routers; add lifespan + middleware |
| `module4/db/session.py` | `app/db/session.py` | Unified async session |
| `module4/models/document.py` | `app/models/document.py` + `app/models/document_version.py` | Split into separate model files |
| `module4/schemas/edit.py` | `app/schemas/edit.py` | Extend with UndoRequest, DiffResponse |
| `module4/services/edit_services.py` | `app/services/edit_service.py` | Add undo logic |
| `module4/services/gemini_service.py` | `app/services/gemini_service.py` | Update model name via config |
| `module4/services/rag_service.py` | `app/services/rag_service.py` | Thin facade; delegates to module3_rag |
| `module4/api/v1/routes/edit.py` | `app/api/v1/routes/edit.py` | Remove sys.path hack; clean imports |

---

## docker-compose.yml Service Map (Dev)

```yaml
services:
  api:           FastAPI app          → :8000
  worker:        Celery worker        (parse + embed + export tasks)
  beat:          Celery beat          (scheduled cleanup jobs)
  postgres:      PostgreSQL 16        → :5432   (documents, versions, jobs)
  redis:         Redis 7              → :6379   (Celery broker + result backend)
  minio:         MinIO                → :9000   (file object storage, S3-compatible)
  qdrant:        Qdrant               → :6333   (vector store, HTTP + gRPC)
  flower:        Celery Flower UI     → :5555   (task monitoring, dev only)
```

---

## Environment Variables (.env.example)

```bash
# ── Database ─────────────────────────────────────────────────────
DATABASE_URL=postgresql+asyncpg://scribe:scribe@postgres:5432/scribe_db

# ── Redis / Celery ───────────────────────────────────────────────
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/1

# ── MinIO / S3 ───────────────────────────────────────────────────
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=scribe-documents
MINIO_USE_SSL=false

# ── Qdrant ───────────────────────────────────────────────────────
QDRANT_HOST=qdrant
QDRANT_PORT=6333

# ── LLM ─────────────────────────────────────────────────────────
GEMINI_API_KEY=your-gemini-api-key-here

# ── App ──────────────────────────────────────────────────────────
APP_ENV=development
SECRET_KEY=change-me-in-production
MAX_UPLOAD_SIZE_MB=20
ALLOWED_ORIGINS=http://localhost:3000
```

---

## Key Architectural Decisions

### 1. Single FastAPI App (not microservices)
All 5 modules share one FastAPI app under `app/`. The Celery workers run as separate processes but share the same codebase — deployed from two Dockerfiles (`Dockerfile.api` vs `Dockerfile.worker`).

### 2. Modules Folder = Pure Algorithmic Code
`app/modules/` contains zero FastAPI/HTTP code. Each sub-package is independently importable and testable. The `app/services/` layer acts as the bridge between HTTP routes and module internals.

### 3. No sys.path Hacks
The old `module4/api/v1/routes/edit.py` used `sys.path.insert` to import `module3`. In the new structure, all imports are clean package paths: `from app.modules.module3_rag.rag_service import RAGService`.

### 4. Two Docker Images
`Dockerfile.api` — slim image, no ML model weights. Fast to build and deploy.
`Dockerfile.worker` — heavy image, pre-downloads `BAAI/bge-m3` and `bge-reranker-v2-m3` at build time so workers start instantly.

### 5. Versioned API
All routes live under `/api/v1/`. When breaking changes are needed, add `/api/v2/` routes without removing v1.
