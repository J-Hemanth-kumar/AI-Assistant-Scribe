import { useEffect, useRef, useCallback } from 'react';
import { wsService } from '@/services/websocket';
import { useAppContext } from '@/context/AppContext';
import { generateId } from '@/utils/id';
import type { Citation, Message } from '@/types';
import type { ChatTokenPayload, ChatCitationPayload, ChatDonePayload, ChatErrorPayload } from '@/services/websocket';

export function useWebSocket() {
  const { state, dispatch } = useAppContext();
  const activeSessionIdRef = useRef<string | null>(state.activeSessionId);
  activeSessionIdRef.current = state.activeSessionId;

  // FIX: reflect activeChatDocId so sendMessage always has the latest doc_id
  const activeChatDocIdRef = useRef<string | undefined>(state.activeChatDocId);
  activeChatDocIdRef.current = state.activeChatDocId;

  // ── Connect/Disconnect when session changes ───────────────────────────
  useEffect(() => {
    if (!state.activeSessionId) return;

    let isMounted = true;
    wsService
      .connect(state.settings.wsUrl, state.activeSessionId)
      .then(() => {
        if (isMounted) dispatch({ type: 'SET_CONNECTED', payload: true });
      })
      .catch((err) => {
        console.error('[WS] Connection failed:', err);
        if (isMounted) dispatch({ type: 'SET_CONNECTED', payload: false });
      });

    return () => {
      isMounted = false;
      wsService.disconnect();
      dispatch({ type: 'SET_CONNECTED', payload: false });
    };
  }, [state.activeSessionId, state.settings.wsUrl, dispatch]);

  // ── Event listeners ───────────────────────────────────────────────────
  useEffect(() => {
    const offToken = wsService.on<ChatTokenPayload>('chat_token', (payload) => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;
      dispatch({ type: 'APPEND_TOKEN', payload: { sessionId, messageId: payload.messageId, token: payload.token } });
    });

    const offCitation = wsService.on<ChatCitationPayload>('chat_citation', (payload) => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;
      dispatch({ type: 'ADD_CITATION', payload: { sessionId, messageId: payload.messageId, citation: payload.citation } });
    });

    const offDone = wsService.on<ChatDonePayload>('chat_done', (payload) => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;
      dispatch({ type: 'UPDATE_MESSAGE', payload: { sessionId, messageId: payload.messageId, patch: { isStreaming: false } } });
    });

    const offError = wsService.on<ChatErrorPayload>('chat_error', (payload) => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;
      dispatch({
        type: 'UPDATE_MESSAGE',
        payload: { sessionId, messageId: payload.messageId, patch: { isStreaming: false, error: payload.error } },
      });
    });

    const offVersion = wsService.on<{ docId: string; versionId: number }>('chat_version_ready', (payload) => {
      dispatch({ type: 'SET_PREVIEW_DOC', payload: { docId: payload.docId } });
      dispatch({ type: 'SET_PREVIEW_VERSION', payload: { versionId: payload.versionId } });
    });

    return () => { offToken(); offCitation(); offDone(); offError(); offVersion(); };
  }, [dispatch]);

  // ── sendMessage ───────────────────────────────────────────────────────
  const sendMessage = useCallback(
    (content: string, fileIds: string[] = []) => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId || !state.isConnected) {
        console.error('[WS] Cannot send — no session or not connected.');
        return;
      }

      const messageId = generateId('msg');

      // Optimistically add user message
      const userMessage: Message = {
        id: generateId('msg'),
        role: 'user',
        content,
        timestamp: new Date(),
        attachments: [],
      };
      dispatch({ type: 'ADD_MESSAGE', payload: { sessionId, message: userMessage } });

      // Streaming placeholder for assistant
      const assistantMessage: Message = {
        id: messageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
        citations: [],
        evidence: [],
      };
      dispatch({ type: 'ADD_MESSAGE', payload: { sessionId, message: assistantMessage } });

      // FIX: include doc_id so backend uses RAG instead of echo fallback
      const docId = activeChatDocIdRef.current ?? (fileIds[0] ?? undefined);
      wsService.sendChat({ sessionId, messageId, content, doc_id: docId, fileIds });
    },
    [dispatch, state.isConnected]
  );

  const toggleEvidence = useCallback(
    (messageId: string, evidenceId: string) => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;
      dispatch({ type: 'TOGGLE_EVIDENCE', payload: { sessionId, messageId, evidenceId } });
    },
    [dispatch]
  );

  return { isConnected: state.isConnected, sendMessage, toggleEvidence };
}

export type { Citation };
