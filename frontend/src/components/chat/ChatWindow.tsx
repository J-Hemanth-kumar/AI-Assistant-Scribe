/**
 * src/components/chat/ChatWindow.tsx  (UPDATED)
 *
 * Replaces the old manual-scroll MessageBubble map with ChatList.
 * All scroll management, height tracking, and virtualization are now
 * handled inside ChatList / ChatMessage — this file is a thin shell.
 */


import { ChatList } from './ChatList';
import { ChatInput } from './ChatInput';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAppContext } from '@/context/AppContext';
import type { Citation } from '@/types';

interface ChatWindowProps {
  onCitationClick?: (citation: Citation) => void;
}

export function ChatWindow({ onCitationClick }: ChatWindowProps) {
  const { activeSession, dispatch, createSession } = useAppContext();
  const { sendMessage, toggleEvidence, isConnected } = useWebSocket();

  const messages = activeSession?.messages ?? [];

  return (
    <main className="flex flex-col h-full bg-surface-50 min-w-0">
      {/* ── Topbar ───────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-3.5 bg-white
                         border-b border-surface-200 shrink-0">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-surface-800 truncate">
            {activeSession?.title ?? 'Scribe'}
          </h1>
          {activeSession && (
            <p className="text-[10px] text-surface-400 mt-0.5">
              {messages.length} message{messages.length !== 1 ? 's' : ''}
              {activeSession.pinnedSources.length > 0 &&
                ` · ${activeSession.pinnedSources.length} source${
                  activeSession.pinnedSources.length !== 1 ? 's' : ''
                }`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              dispatch({ type: 'SET_PANEL', payload: { rightPanelOpen: true, rightPanelTab: 'export' } })
            }
            className="btn-ghost text-xs"
          >
            Export
          </button>
          <button
            onClick={() =>
              dispatch({ type: 'SET_PANEL', payload: { rightPanelOpen: true, rightPanelTab: 'files' } })
            }
            className="btn-ghost text-xs"
          >
            Files
          </button>
        </div>
      </header>

      {/* ── ChatList (virtualized, scroll-stable) ───────────────────── */}
      <ChatList
        messages={messages}
        hasSession={!!activeSession}
        onCreateSession={createSession}
        onToggleEvidence={toggleEvidence}
        onCitationClick={onCitationClick}
      />

      {/* ── Input bar ───────────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-t border-surface-200">
        <ChatInput
          onSend={sendMessage}
          disabled={!activeSession}
          isConnected={isConnected}
        />
      </div>
    </main>
  );
}
