# Scribe — AI Document Editor

A production-ready local AI assistant that parses documents, indexes them via RAG, and lets you chat with and edit them using an LLM.

---

## Architecture

```
frontend (React/Vite) :3000
        │
        ├── REST  →  FastAPI :18000  →  PostgreSQL
        │                           →  MinIO (file storage)
        └── WS    →  FastAPI :18000  →  Qdrant (vector DB)
                                    →  Groq LLM (streaming)
                   Celery worker   →  Redis (task queue)
```

---

## Quick Start (Local)

### 1. Start infrastructure services

```bash
docker run -d --name postgres -e POSTGRES_DB=documentparser \
  -e POSTGRES_USER=documentparser -e POSTGRES_PASSWORD=changeme \
  -p 5432:5432 postgres:16

docker run -d --name redis -p 6379:6379 redis:7

docker run -d --name minio -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  quay.io/minio/minio server /data --console-address ":9001"

docker run -d --name qdrant -p 6333:6333 qdrant/qdrant
```

### 2. Backend

```bash
cd backend
cp .env.example .env
# Edit .env — set GROQ_API_KEY (free at console.groq.com)

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Start API server (port 18000)
uvicorn app.main:app --host 0.0.0.0 --port 18000 --reload

# Start Celery worker (separate terminal)
celery -A app.tasks.celery_app worker -Q parse -c 2 --loglevel=info
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev   # http://localhost:3000
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/documents/upload` | Upload a document (multipart) |
| `GET`  | `/api/v1/documents/{id}` | Poll parse status |
| `GET`  | `/api/v1/documents/{id}/preview` | Raw parsed chunks |
| `GET`  | `/api/v1/documents` | List documents for a session |
| `DELETE` | `/api/v1/documents/{id}` | Delete document + storage |
| `POST` | `/api/v1/sessions` | Create session |
| `GET`  | `/api/v1/sessions` | List all sessions |
| `PATCH` | `/api/v1/sessions/{id}` | Rename session |
| `DELETE` | `/api/v1/sessions/{id}` | Delete session |
| `POST` | `/api/v1/edit` | Generate LLM edits via RAG |
| `GET`  | `/api/v1/edit/chunks/{doc_id}` | Parsed content chunks |
| `GET`  | `/api/v1/edit/diff/{version_id}` | Edit diffs for a version |
| `GET`  | `/api/v1/edit/versions/{doc_id}` | All edit versions |
| `GET`  | `/api/v1/edit/preview/{doc_id}` | **Full edited text preview** |
| `DELETE` | `/api/v1/edit/undo/{doc_id}` | Undo last edit version |
| `POST` | `/api/v1/export` | Export document (pdf/docx/md/txt) |
| `WS`   | `ws://localhost:18000/ws/chat?session_id=X` | Streaming chat |

---

## WebSocket Protocol

```jsonc
// Client → Server
{ "type": "chat_start", "payload": { "messageId": "msg_123", "sessionId": "...", "content": "Summarise this", "doc_id": "uuid", "fileIds": [] }}
{ "type": "ping", "payload": null }
{ "type": "close", "payload": null }

// Server → Client
{ "type": "connection_established", "payload": { "session_id": "..." }}
{ "type": "chat_start",  "payload": { "messageId": "msg_123", "status": "processing" }}
{ "type": "chat_token",  "payload": { "messageId": "msg_123", "token": "Hello " }}
{ "type": "chat_done",   "payload": { "messageId": "msg_123" }}
{ "type": "chat_error",  "payload": { "messageId": "msg_123", "error": "..." }}
{ "type": "pong",        "payload": {} }
```

---

## LLM-Edited Document Preview Flow

1. User sends an edit instruction in chat (e.g. *"Simplify the introduction"*)
2. Backend retrieves relevant chunks from Qdrant (RAG)
3. Groq LLM returns a JSON diff of `{ edits: [{ chunk_index, original_text, updated_text, reason }] }`
4. `save_version()` applies diffs to the original parsed text and stores the **full edited text** in `DocumentVersion.full_text`
5. Frontend calls `GET /api/v1/edit/preview/{doc_id}` to load the full text instantly
6. `DocumentPreview` panel renders the text with highlighted edited segments
7. Version selector lets users browse all previous edit versions

---

## Bugs Fixed (vs original codebase)

| # | File | Bug |
|---|------|-----|
| 1 | `rag_service.py` | Broken import path caused `ImportError` at startup |
| 2 | `rag_service.py` | Called `self.llm_service.stream_generate()` — function not class |
| 3 | `retrieval_service.py` | File was completely **missing** |
| 4 | `gemini_service.py` | Replaced with `groq_service.py` with real async streaming |
| 5 | `db/models.py` | `DocumentStatus.processing = "parsing"` — duplicate enum value |
| 6 | `main.py` | Deprecated `@app.on_event("startup")` → `lifespan` context manager |
| 7 | `main.py` | CORS `allow_origins=["*"]` + `allow_credentials=True` — browser-rejected |
| 8 | `core/config.py` | `GROQ_API_KEY` missing from Settings class |
| 9 | `api/deps.py` | No `db.rollback()` on error — dirty transaction state |
| 10 | `routes/upload.py` | Services called directly instead of via `Depends()` |
| 11 | `edit_service.py` | `raise Exception(f"... {e}")` used `e` outside `except` → `NameError` |
| 12 | `tasks/celery_app.py` | Wrong `include` module path |
| 13 | `api.ts` | `/api/v1/chunks/`, `/api/v1/diff/`, `/api/v1/versions/` — wrong URLs |
| 14 | `websocket.ts` | `sendChat` never included `doc_id` — RAG never reached |
| 15 | `AppContext.tsx` | Sessions only in memory — lost on page refresh |
| 16 | `Sidebar.tsx` | `createSession`/`renameSession`/`deleteSession` never called backend |
| 17 | `websocket/chat.py` | Double `accept()` call on connection |
| 18 | `export_service.py` | `datetime.utcnow()` — deprecated since Python 3.12 |

---

## Environment Variables

See `backend/.env.example` and `frontend/.env.example`.

**Never commit `.env` files.**  
Get your free Groq API key at [console.groq.com](https://console.groq.com).
