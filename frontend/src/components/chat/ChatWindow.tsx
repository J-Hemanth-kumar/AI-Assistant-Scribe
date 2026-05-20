import { ChatList } from './ChatList';
import { ChatInput } from './ChatInput';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAppContext } from '@/context/AppContext';
import { Download, Files, Menu } from 'lucide-react';
import type { Citation } from '@/types';

interface ChatWindowProps {
  onCitationClick?: (citation: Citation) => void;
}

export function ChatWindow({ onCitationClick }: ChatWindowProps) {
  const { activeSession, dispatch, createSession } = useAppContext();
  const { sendMessage, toggleEvidence, isConnected } = useWebSocket();

  const messages = activeSession?.messages ?? [];

  const openSidebar = () => {
    dispatch({ type: 'SET_PANEL', payload: { sidebarOpen: true } });
  };

  return (
    <main className="flex flex-col h-full bg-slate-50/50 dark:bg-slate-950/20 bg-gradient-to-b from-slate-50/80 via-white to-slate-50/80 dark:from-slate-950/20 dark:via-slate-900/10 dark:to-slate-950/40 min-w-0 transition-colors duration-300">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 py-3.5 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-surface-200/80 dark:border-slate-800/30 shrink-0 z-10 transition-colors duration-300">
        {/* Accent gradient bar */}
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-500/0 via-accent-500 to-indigo-500/0 dark:via-accent-400" />

        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={openSidebar}
            className="btn-icon md:hidden shrink-0"
            aria-label="Open sidebar"
          >
            <Menu size={16} />
          </button>
          
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-surface-800 dark:text-slate-200 truncate tracking-tight">
                {activeSession?.title ?? 'Scribe'}
              </h1>
              
              {/* Connection status indicator */}
              <div 
                className={`w-1.5 h-1.5 rounded-full ${
                  isConnected 
                    ? 'bg-emerald-500 shadow-glow-accent animate-pulse' 
                    : 'bg-red-400'
                }`}
                title={isConnected ? 'Connected' : 'Disconnected'}
              />
            </div>

            {activeSession && (
              <p className="text-[10px] font-medium text-surface-400 dark:text-slate-500 mt-0.5">
                {messages.length} message{messages.length !== 1 ? 's' : ''}
                {activeSession.pinnedSources.length > 0 &&
                  ` · ${activeSession.pinnedSources.length} source${
                    activeSession.pinnedSources.length !== 1 ? 's' : ''
                  }`}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() =>
              dispatch({ type: 'SET_PANEL', payload: { rightPanelOpen: true, rightPanelTab: 'export' } })
            }
            className="btn-ghost text-xs px-2.5 py-1.5 gap-1.5 hover:bg-accent-50 dark:hover:bg-slate-800 hover:text-accent-600 dark:hover:text-accent-400"
          >
            <Download size={13} />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button
            onClick={() =>
              dispatch({ type: 'SET_PANEL', payload: { rightPanelOpen: true, rightPanelTab: 'files' } })
            }
            className="btn-ghost text-xs px-2.5 py-1.5 gap-1.5 hover:bg-accent-50 dark:hover:bg-slate-800 hover:text-accent-600 dark:hover:text-accent-400"
          >
            <Files size={13} />
            <span className="hidden sm:inline">Files</span>
          </button>
        </div>
      </header>

      {/* ChatList (virtualized, scroll-stable) */}
      <ChatList
        messages={messages}
        hasSession={!!activeSession}
        onCreateSession={createSession}
        onToggleEvidence={toggleEvidence}
        onCitationClick={onCitationClick}
      />

      {/* Input bar */}
      <div className="shrink-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-t border-surface-200/80 dark:border-slate-800/30 transition-colors duration-300">
        <ChatInput
          onSend={sendMessage}
          disabled={!activeSession}
          isConnected={isConnected}
        />
      </div>
    </main>
  );
}
