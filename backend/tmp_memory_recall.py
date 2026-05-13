import uuid
from app.memory.memory_service import MemoryService
from app.db.session import SessionLocal
from app.db.models import ChatMessage

session_id = "f79e1b4f-7932-48d3-9167-ce40521376a4"
ms = MemoryService()
drawer_id = ms.store_conversation(
    session_id=session_id,
    user_msg="I just stored a message about testing memory recall",
    assistant_msg="Yes, I remember your prior test for chat persistence.",
    doc_id=None,
    turn_index=2,
)
print('drawer_id:', drawer_id)
print('Recall results:')
results = ms.recall('testing memory recall', session_id=session_id, n_results=5)
for r in results:
    print(r.text[:120].replace('\n',' '), r.similarity, r.room)
with SessionLocal() as db:
    rows = db.query(ChatMessage).filter(ChatMessage.session_id == uuid.UUID(session_id)).all()
    print('ChatMessage rows:', len(rows))
    for r in rows[-4:]:
        print(r.id, r.role, r.content[:80], r.mempalace_drawer_id)
