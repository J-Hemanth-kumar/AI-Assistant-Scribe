# AI-Assistant-Scribe — Directory Tree

```
AI-Assistant-Scribe-main/
│
├── .gitignore
├── Makefile
├── Project_Structure_Fixed.md
├── README.md
├── docker-compose.yml
│
├── backend/
│   ├── .dockerignore
│   ├── .env
│   ├── Dockerfile
│   │
│   ├── scripts/
│   │   └── entrypoint.sh
│   │
│   └── app/
│       ├── __init__.py
│       ├── main.py
│       ├── brain_check_db.py
│       │
│       ├── api/
│       │   ├── __init__.py
│       │   ├── deps.py
│       │   │
│       │   ├── routes/
│       │   │   ├── __init__.py
│       │   │   ├── edit.py
│       │   │   ├── export.py
│       │   │   ├── sessions.py
│       │   │   └── upload.py
│       │   │
│       │   └── websocket/
│       │       ├── __init__.py
│       │       └── chat.py
│       │
│       ├── core/
│       │   ├── __init__.py
│       │   ├── config.py
│       │   └── logging.py
│       │
│       ├── db/
│       │   ├── __init__.py
│       │   ├── base.py
│       │   ├── init_db.py
│       │   ├── models.py
│       │   └── session.py
│       │
│       ├── parsers/
│       │   ├── __init__.py
│       │   ├── base.py
│       │   ├── docx_parser.py
│       │   ├── image_parser.py
│       │   ├── markdown_parser.py
│       │   ├── pdf_parser.py
│       │   └── txt_parser.py
│       │
│       ├── schemas/
│       │   ├── __init__.py
│       │   ├── document.py
│       │   ├── export.py
│       │   ├── llm.py
│       │   ├── session.py
│       │   └── upload.py
│       │
│       ├── services/
│       │   ├── __init__.py
│       │   ├── chunker.py
│       │   ├── document_service.py
│       │   ├── edit_service.py
│       │   ├── embedder.py
│       │   ├── export_service.py
│       │   ├── groq_service.py
│       │   ├── minio_service.py
│       │   ├── parse_service.py
│       │   ├── qdrant_service.py
│       │   ├── rag_service.py
│       │   └── retrieval_service.py
│       │
│       ├── tasks/
│       │   ├── __init__.py
│       │   ├── celery_app.py
│       │   └── document_tasks.py
│       │
│       └── utils/
│           ├── __init__.py
│           └── file_type.py
│
└── frontend/
    ├── .env
    ├── index.html
    ├── package.json
    ├── package-lock.json
    ├── postcss.config.js
    ├── tailwind.config.js
    ├── tsconfig.json
    ├── tsconfig.node.json
    ├── vite.config.ts
    │
    ├── node_modules/            # (dependencies — not shown)
    │
    └── src/
        ├── App.tsx
        ├── main.tsx
        ├── index.css
        ├── vite-env.d.ts
        │
        ├── components/
        │   ├── chat/
        │   │   ├── ChatInput.tsx
        │   │   ├── ChatList.tsx
        │   │   ├── ChatMessage.tsx
        │   │   ├── ChatWindow.tsx
        │   │   └── MessageBubble.tsx
        │   │
        │   ├── document/
        │   │   ├── HighlightText.tsx
        │   │   └── VirtualizedDocument.tsx
        │   │
        │   ├── export/
        │   │   └── ExportPanel.tsx
        │   │
        │   ├── panel/
        │   │   ├── DocumentPreview.tsx
        │   │   ├── FilePanel.tsx
        │   │   ├── RightPanel.tsx
        │   │   └── SettingsPanel.tsx
        │   │
        │   └── sidebar/
        │       └── Sidebar.tsx
        │
        ├── config/
        │   └── index.ts
        │
        ├── context/
        │   └── AppContext.tsx
        │
        ├── hooks/
        │   ├── useDocumentPreview.ts
        │   ├── useDocumentQuery.ts
        │   ├── useFileUpload.ts
        │   ├── useUploadMutation.ts
        │   └── useWebSocket.ts
        │
        ├── lib/
        │   ├── queryClient.ts
        │   │
        │   ├── diff/
        │   │   ├── applyHighlights.ts
        │   │   └── mapEdits.ts
        │   │
        │   ├── pretext/
        │   │   ├── chatLayout.ts
        │   │   └── layout.ts
        │   │
        │   └── text/
        │       └── buildTextMap.ts
        │
        ├── services/
        │   ├── api.ts
        │   └── websocket.ts
        │
        ├── types/
        │   └── index.ts
        │
        └── utils/
            ├── fileValidation.ts
            └── id.ts
```

> [!NOTE]
> `node_modules/` contents are omitted. The tree contains **~85 source files** across the backend (Python/FastAPI) and frontend (React/Vite/TypeScript).
