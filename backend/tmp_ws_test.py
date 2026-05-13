#!/usr/bin/env python3
"""
Test WebSocket chat message storage.
Connects to WebSocket, sends a chat message, and verifies it gets stored.
"""
import asyncio
import json
import uuid
from app.memory.memory_service import MemoryService

async def test_websocket_chat():
    """Test real WebSocket chat storage."""
    import websockets
    from app.db.models import ChatMessage, Session
    from app.db.session import SessionLocal
    
    # Use existing session from earlier tests
    session_id = "f79e1b4f-7932-48d3-9167-ce40521376a4"
    
    # Connect to WebSocket
    uri = f"ws://localhost:8000/ws/chat?session_id={session_id}"
    
    try:
        async with websockets.connect(uri) as websocket:
            # Receive connection established message
            msg = await asyncio.wait_for(websocket.recv(), timeout=5)
            data = json.loads(msg)
            print(f"Connection: {data}")
            
            # Send a chat message
            message_id = str(uuid.uuid4())
            chat_msg = {
                "type": "chat_start",
                "payload": {
                    "messageId": message_id,
                    "sessionId": session_id,
                    "content": "Test WebSocket chat message",
                    "doc_id": None,
                    "fileIds": []
                }
            }
            
            print(f"\nSending: {chat_msg}")
            await websocket.send(json.dumps(chat_msg))
            
            # Collect all responses
            responses = []
            try:
                while True:
                    response = await asyncio.wait_for(websocket.recv(), timeout=2)
                    data = json.loads(response)
                    responses.append(data)
                    print(f"Response: {data.get('type')}")
                    
                    if data.get('type') == 'chat_done':
                        break
                    elif data.get('type') == 'chat_error':
                        print(f"Error: {data.get('payload')}")
                        break
            except asyncio.TimeoutError:
                pass
            
            # Check if message was stored in database
            print("\n--- Checking database ---")
            with SessionLocal() as db:
                messages = db.query(ChatMessage).filter(
                    ChatMessage.session_id == session_id
                ).all()
                print(f"Total messages in session: {len(messages)}")
                for m in messages:
                    print(f"  {m.id} {m.role}: {m.content[:50]}")
            
            print(f"\n--- Total responses received: {len(responses)} ---")
            
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_websocket_chat())
