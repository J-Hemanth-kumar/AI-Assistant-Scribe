"""
WebSocket chat endpoint — fixed streaming and connection management.

Fixes from original:
  1. Double accept() — manager.connect() was calling accept() after the
     endpoint already called it → protocol error on some clients.
  2. No doc_id forwarded from payload to RAG service.
  3. Echo fallback was emitting each word as a separate token properly but
     never reached the real RAG branch because doc_id was never sent.
  4. Bare `except: pass` in send_message silently dropped errors.
"""
import asyncio
import json
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.rag_service import RAGChatService

logger = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, list[WebSocket]] = {}

    def add(self, ws: WebSocket, session_id: str) -> None:
        self._connections.setdefault(session_id, []).append(ws)

    def remove(self, ws: WebSocket, session_id: str) -> None:
        conns = self._connections.get(session_id, [])
        if ws in conns:
            conns.remove(ws)
        if not conns:
            self._connections.pop(session_id, None)

    async def broadcast(self, payload: dict, session_id: str) -> None:
        for ws in list(self._connections.get(session_id, [])):
            try:
                await ws.send_json(payload)
            except Exception as exc:
                logger.warning("Failed to send to ws in session %s: %s", session_id, exc)


manager = ConnectionManager()


@router.websocket("/ws/chat")
async def websocket_chat_endpoint(
    websocket: WebSocket,
    session_id: Optional[str] = None,
):
    # Generate session_id if client didn't provide one
    if not session_id:
        session_id = str(uuid.uuid4())
        logger.info("Auto-generated session_id: %s", session_id)

    await websocket.accept()
    manager.add(websocket, session_id)
    logger.info("WS connected — session=%s", session_id)

    # Confirm connection to client
    await websocket.send_json({
        "type": "connection_established",
        "payload": {"session_id": session_id, "message": "Connected to Scribe chat server"},
    })

    rag = RAGChatService()

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                data = {"type": "chat", "content": raw}

            msg_type = data.get("type")

            # ── Ping / keepalive ─────────────────────────────────────────
            if msg_type == "ping":
                await websocket.send_json({"type": "pong", "payload": {}})
                continue

            # ── Close request ────────────────────────────────────────────
            if msg_type == "close":
                await websocket.close(code=1000)
                break

            # ── Chat message ─────────────────────────────────────────────
            if msg_type in ("chat_start", "chat"):
                payload = data.get("payload", {})

                # FIX: properly extract all fields from nested payload
                message_id = payload.get("messageId") or data.get("message_id", str(uuid.uuid4()))
                content = payload.get("content") or data.get("content", "")
                # FIX: doc_id now correctly extracted from payload so RAG is used
                doc_id = payload.get("doc_id") or data.get("doc_id")
                file_ids: list[str] = payload.get("fileIds") or data.get("file_ids", [])

                # Use first file_id as doc_id if doc_id not explicitly set
                if not doc_id and file_ids:
                    doc_id = file_ids[0]

                if not content:
                    await websocket.send_json({
                        "type": "chat_error",
                        "payload": {"messageId": message_id, "error": "Empty message content."},
                    })
                    continue

                logger.info("Chat msg=%s session=%s doc_id=%s content='%s'", message_id, session_id, doc_id, content[:80])

                try:
                    # Signal stream start
                    await websocket.send_json({
                        "type": "chat_start",
                        "payload": {"messageId": message_id, "status": "processing"},
                    })

                    # Real RAG streaming from document context and conversational memory
                    async for token in rag.stream_chat(content, doc_id=doc_id, session_id=session_id):
                        # Intercept special backend marker for auto-saved edits
                        if str(token).startswith("__EDIT_SAVED_VERSION__"):
                            version_id = token.replace("__EDIT_SAVED_VERSION__", "")
                            await websocket.send_json({
                                "type": "chat_version_ready",
                                "payload": {
                                    "messageId": message_id,
                                    "docId": doc_id,
                                    "versionId": int(version_id)
                                },
                            })
                        else:
                            await websocket.send_json({
                                "type": "chat_token",
                                "payload": {"messageId": message_id, "token": token},
                            })
                        await asyncio.sleep(0)  # yield event loop

                    # Signal stream end
                    await websocket.send_json({
                        "type": "chat_done",
                        "payload": {"messageId": message_id},
                    })

                except Exception:
                    logger.exception("Chat stream error for msg=%s session=%s", message_id, session_id)
                    await websocket.send_json({
                        "type": "chat_error",
                        "payload": {"messageId": message_id, "error": "An error occurred while generating the response."},
                    })
                continue

            # ── Unknown message type ──────────────────────────────────────
            await websocket.send_json({
                "type": "error",
                "payload": {"error": f"Unknown message type: '{msg_type}'"},
            })

    except WebSocketDisconnect:
        logger.info("WS client disconnected — session=%s", session_id)
    except Exception:
        logger.exception("Unhandled WS error — session=%s", session_id)
    finally:
        manager.remove(websocket, session_id)
