import asyncio
import uuid
from app.services.rag_service import RAGChatService
from app.db.session import SessionLocal
from app.db.models import ChatMessage

session_id = "f79e1b4f-7932-48d3-9167-ce40521376a4"

async def run():
    rag = RAGChatService()
    tokens = []
    async for token in rag.stream_chat("Hello again", session_id=session_id):
        tokens.append(token)
        if len(tokens) > 20:
            break
    print("RESP", "".join(tokens))
    with SessionLocal() as db:
        rows = db.query(ChatMessage).filter(ChatMessage.session_id == uuid.UUID(session_id)).all()
        print("ROWS", len(rows))
        for r in rows[-4:]:
            print(r.id, r.role, r.content[:50], r.mempalace_drawer_id)

asyncio.run(run())
