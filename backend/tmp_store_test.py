from app.memory.memory_service import MemoryService

session_id = "f79e1b4f-7932-48d3-9167-ce40521376a4"
ms = MemoryService()
drawer_id = ms.store_conversation(
    session_id=session_id,
    user_msg="Manual store test",
    assistant_msg="Manual assistant reply",
    doc_id=None,
    turn_index=1,
)
print('drawer_id:', drawer_id)
