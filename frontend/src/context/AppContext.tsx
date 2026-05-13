import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import type { Session, Message, UploadedFile, AppSettings, PanelState, Citation, EvidenceSection } from '@/types';

import { config } from '@/config';
import { createSession as apiCreateSession, renameSession as apiRenameSession, deleteSession as apiDeleteSession, listSessions } from '@/services/api';

interface AppState {
  sessions: Session[];
  activeSessionId: string | null;
  settings: AppSettings;
  panel: PanelState;
  globalFiles: UploadedFile[];
  isConnected: boolean;
  previewDocId?: string;
  previewVersionId?: number;
  // Active doc_id for chat context — sent with every WS message
  activeChatDocId?: string;
}

const defaultSettings: AppSettings = {
  theme: 'light',
  streamingEnabled: true,
  citationsVisible: true,
  compactMode: false,
  wsUrl: config.wsUrl,
  apiBaseUrl: config.apiUrl,
};

const initialState: AppState = {
  sessions: [],
  activeSessionId: null,
  settings: defaultSettings,
  panel: { sidebarOpen: true, rightPanelOpen: true, rightPanelTab: 'files' } as PanelState,
  globalFiles: [],
  isConnected: false,
  previewDocId: undefined,
  previewVersionId: undefined,
  activeChatDocId: undefined,
};

type Action =
  | { type: 'CREATE_SESSION'; payload: { session: Session } }
  | { type: 'DELETE_SESSION'; payload: { sessionId: string } }
  | { type: 'RENAME_SESSION'; payload: { sessionId: string; title: string } }
  | { type: 'SET_ACTIVE_SESSION'; payload: { sessionId: string } }
  | { type: 'LOAD_SESSIONS'; payload: { sessions: Session[] } }
  | { type: 'ADD_MESSAGE'; payload: { sessionId: string; message: Message } }
  | { type: 'UPDATE_MESSAGE'; payload: { sessionId: string; messageId: string; patch: Partial<Message> } }
  | { type: 'APPEND_TOKEN'; payload: { sessionId: string; messageId: string; token: string } }
  | { type: 'ADD_CITATION'; payload: { sessionId: string; messageId: string; citation: Citation } }
  | { type: 'TOGGLE_EVIDENCE'; payload: { sessionId: string; messageId: string; evidenceId: string } }
  | { type: 'ADD_FILE'; payload: { file: UploadedFile } }
  | { type: 'UPDATE_FILE'; payload: { fileId: string; patch: Partial<UploadedFile> } }
  | { type: 'REMOVE_FILE'; payload: { fileId: string } }
  | { type: 'SET_PANEL'; payload: Partial<PanelState> }
  | { type: 'SET_SETTINGS'; payload: Partial<AppSettings> }
  | { type: 'SET_CONNECTED'; payload: boolean }
  | { type: 'SET_PREVIEW_DOC'; payload: { docId: string } }
  | { type: 'SET_PREVIEW_VERSION'; payload: { versionId: number | undefined } }
  | { type: 'SET_ACTIVE_CHAT_DOC'; payload: { docId: string | undefined } }
  | { type: 'UPDATE_SESSION_MESSAGES'; payload: { sessionId: string; messages: Message[] } };

function updateSession(sessions: Session[], id: string, fn: (s: Session) => Session): Session[] {
  return sessions.map((s) => (s.id === id ? fn(s) : s));
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOAD_SESSIONS':
      return { ...state, sessions: action.payload.sessions };

    case 'CREATE_SESSION':
      return {
        ...state,
        sessions: [action.payload.session, ...state.sessions],
        activeSessionId: action.payload.session.id,
      };

    case 'DELETE_SESSION': {
      const sessions = state.sessions.filter((s) => s.id !== action.payload.sessionId);
      const activeSessionId =
        state.activeSessionId === action.payload.sessionId
          ? (sessions[0]?.id ?? null)
          : state.activeSessionId;
      return { ...state, sessions, activeSessionId };
    }

    case 'RENAME_SESSION':
      return {
        ...state,
        sessions: updateSession(state.sessions, action.payload.sessionId, (s) => ({
          ...s,
          title: action.payload.title,
          updatedAt: new Date(),
        })),
      };

    case 'SET_ACTIVE_SESSION':
      return { ...state, activeSessionId: action.payload.sessionId };

    case 'ADD_MESSAGE':
      return {
        ...state,
        sessions: updateSession(state.sessions, action.payload.sessionId, (s) => ({
          ...s,
          messages: [...s.messages, action.payload.message],
          updatedAt: new Date(),
          messageCount: s.messageCount + 1,
          preview: action.payload.message.content.slice(0, 80),
        })),
      };

    case 'UPDATE_MESSAGE':
      return {
        ...state,
        sessions: updateSession(state.sessions, action.payload.sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === action.payload.messageId ? { ...m, ...action.payload.patch } : m
          ),
        })),
      };

    case 'APPEND_TOKEN':
      return {
        ...state,
        sessions: updateSession(state.sessions, action.payload.sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === action.payload.messageId
              ? { ...m, content: m.content + action.payload.token }
              : m
          ),
        })),
      };

    case 'UPDATE_SESSION_MESSAGES':
      return {
        ...state,
        sessions: updateSession(state.sessions, action.payload.sessionId, (s) => ({
          ...s,
          messages: action.payload.messages,
          messageCount: action.payload.messages.length,
          preview: action.payload.messages.length > 0 
            ? action.payload.messages[action.payload.messages.length - 1].content.slice(0, 80)
            : s.preview,
        })),
      };

    case 'ADD_CITATION':
      return {
        ...state,
        sessions: updateSession(state.sessions, action.payload.sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === action.payload.messageId
              ? { ...m, citations: [...(m.citations ?? []), action.payload.citation] }
              : m
          ),
        })),
      };

    case 'TOGGLE_EVIDENCE':
      return {
        ...state,
        sessions: updateSession(state.sessions, action.payload.sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === action.payload.messageId
              ? {
                  ...m,
                  evidence: (m.evidence ?? []).map((e: EvidenceSection) =>
                    e.id === action.payload.evidenceId ? { ...e, collapsed: !e.collapsed } : e
                  ),
                }
              : m
          ),
        })),
      };

    case 'ADD_FILE':
      return {
        ...state,
        globalFiles: [action.payload.file, ...state.globalFiles],
        sessions: state.activeSessionId
          ? updateSession(state.sessions, state.activeSessionId, (s) => ({
              ...s,
              pinnedSources: [action.payload.file, ...s.pinnedSources],
            }))
          : state.sessions,
      };

    case 'UPDATE_FILE':
      return {
        ...state,
        globalFiles: state.globalFiles.map((f) =>
          f.id === action.payload.fileId ? { ...f, ...action.payload.patch } : f
        ),
        sessions: state.sessions.map((s) => ({
          ...s,
          pinnedSources: s.pinnedSources.map((f) =>
            f.id === action.payload.fileId ? { ...f, ...action.payload.patch } : f
          ),
        })),
      };

    case 'REMOVE_FILE':
      return {
        ...state,
        globalFiles: state.globalFiles.filter((f) => f.id !== action.payload.fileId),
        sessions: state.sessions.map((s) => ({
          ...s,
          pinnedSources: s.pinnedSources.filter((f) => f.id !== action.payload.fileId),
        })),
      };

    case 'SET_PANEL':
      return { ...state, panel: { ...state.panel, ...action.payload } };

    case 'SET_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.payload } };

    case 'SET_CONNECTED':
      return { ...state, isConnected: action.payload };

    case 'SET_PREVIEW_DOC':
      return { ...state, previewDocId: action.payload.docId };

    case 'SET_PREVIEW_VERSION':
      return { ...state, previewVersionId: action.payload.versionId };

    case 'SET_ACTIVE_CHAT_DOC':
      return { ...state, activeChatDocId: action.payload.docId };

    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  activeSession: Session | null;
  createSession: () => Promise<Session>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const activeSession = state.sessions.find((s) => s.id === state.activeSessionId) ?? null;

  // FIX: Load sessions from backend on mount — was only creating local sessions
  useEffect(() => {
    listSessions()
      .then((sessions) => {
        const mapped: Session[] = sessions.map((s) => ({
          id: s.id,
          title: s.title,
          createdAt: new Date(), // Backend date could be used if available
          updatedAt: new Date(),
          messages: [],
          pinnedSources: (s.documents ?? []).map((d: any) => ({
            id: d.doc_id, // using doc_id as local id for simplicity when loading from backend
            docId: d.doc_id,
            name: d.filename,
            type: d.filename.split('.').pop() as any,
            size: 0, // Placeholder
            uploadedAt: new Date(),
            status: (d.status === 'parsed' || d.status === 'indexed') ? 'ready' : 'processing',
            backendStatus: d.status as any,
          })) as UploadedFile[],
          messageCount: 0,
        }));
        dispatch({ type: 'LOAD_SESSIONS', payload: { sessions: mapped } });
        if (mapped.length > 0) {
          dispatch({ type: 'SET_ACTIVE_SESSION', payload: { sessionId: mapped[0].id } });
        }
      })
      .catch((err) => console.error('Failed to load sessions:', err));
  }, []);

  // Fetch full session details (messages) when active session changes
  useEffect(() => {
    if (!state.activeSessionId) return;
    const session = state.sessions.find(s => s.id === state.activeSessionId);
    if (session && session.messages.length === 0) {
      import('@/services/api').then(({ fetchSession }) => {
        fetchSession(state.activeSessionId!).then((data) => {
          if (data.messages && data.messages.length > 0) {
            const mappedMessages: Message[] = data.messages.map((m: any) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: new Date(m.timestamp),
            }));
            
            // Only update if it's still the active session and messages are empty
            dispatch({
              type: 'UPDATE_SESSION_MESSAGES',
              payload: { sessionId: state.activeSessionId!, messages: mappedMessages }
            } as any); // use 'any' temporarily since we haven't added the action type
          }
        }).catch(console.error);
      });
    }
  }, [state.activeSessionId, state.sessions.length]);



  // FIX: createSession now calls backend API — sessions survive page refresh
  const createSession = useCallback(async (): Promise<Session> => {
    const { id, title } = await apiCreateSession('New conversation');
    const session: Session = {
      id,
      title,
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [],
      pinnedSources: [],
      messageCount: 0,
    };
    dispatch({ type: 'CREATE_SESSION', payload: { session } });
    return session;
  }, []);

  // FIX: renameSession calls backend PATCH then updates local state
  const renameSession = useCallback(async (sessionId: string, title: string): Promise<void> => {
    await apiRenameSession(sessionId, title);
    dispatch({ type: 'RENAME_SESSION', payload: { sessionId, title } });
  }, []);

  // FIX: deleteSession calls backend DELETE then updates local state
  const deleteSessionFn = useCallback(async (sessionId: string): Promise<void> => {
    await apiDeleteSession(sessionId);
    dispatch({ type: 'DELETE_SESSION', payload: { sessionId } });
  }, []);

  return (
    <AppContext.Provider value={{ state, activeSession, createSession, renameSession, deleteSession: deleteSessionFn, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}

export type { AppState, Action };
