import React, { useState, useCallback } from 'react';
import { Plus, MessageSquare, Trash2, Edit3, Check, X, ChevronLeft, Settings, Zap } from 'lucide-react';
import { useAppContext } from '@/context/AppContext';
import { formatRelativeTime, truncate } from '@/utils/id';
import type { Session } from '@/types';

interface SidebarProps { onClose?: () => void; }

export function Sidebar({ onClose }: SidebarProps) {
  const { state, activeSession, createSession, renameSession, deleteSession, dispatch } = useAppContext();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [loading, setLoading] = useState(false);

  // FIX: createSession now awaits the API call
  const handleNewSession = useCallback(async () => {
    setLoading(true);
    try { await createSession(); }
    catch (err) { console.error('Failed to create session:', err); }
    finally { setLoading(false); }
  }, [createSession]);

  const handleSelect = (session: Session) => {
    dispatch({ type: 'SET_ACTIVE_SESSION', payload: { sessionId: session.id } });
  };

  // FIX: delete now calls backend via context
  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try { await deleteSession(sessionId); }
    catch (err) { console.error('Failed to delete session:', err); }
  };

  const handleStartEdit = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditTitle(session.title);
  };

  // FIX: rename now calls backend via context
  const handleSaveEdit = async (sessionId: string) => {
    const trimmed = editTitle.trim();
    if (trimmed) {
      try { await renameSession(sessionId, trimmed); }
      catch (err) { console.error('Failed to rename session:', err); }
    }
    setEditingId(null);
  };

  const handleCancelEdit = () => { setEditingId(null); setEditTitle(''); };

  return (
    <aside className="flex flex-col h-full bg-surface-50 border-r border-surface-200 w-64 shrink-0">
      <div className="flex items-center justify-between px-4 py-4 border-b border-surface-200">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent-600 to-accent-400 flex items-center justify-center shadow-sm">
            <Zap size={14} className="text-white" />
          </div>
          <span className="font-semibold text-surface-800 text-sm tracking-tight">Scribe</span>
        </div>
        <button onClick={onClose} className="btn-icon md:hidden" aria-label="Close sidebar">
          <ChevronLeft size={16} />
        </button>
      </div>

      <div className="px-3 py-3">
        <button
          onClick={handleNewSession}
          disabled={loading}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium
                     text-surface-600 border border-dashed border-surface-300
                     hover:bg-white hover:border-accent-300 hover:text-accent-700
                     transition-all duration-150 group disabled:opacity-50"
        >
          <Plus size={15} className="group-hover:text-accent-600 transition-colors" />
          {loading ? 'Creating…' : 'New conversation'}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5" aria-label="Conversations">
        {state.sessions.length === 0 && (
          <div className="px-3 py-8 text-center">
            <MessageSquare size={28} className="mx-auto text-surface-300 mb-2" />
            <p className="text-xs text-surface-400 leading-relaxed">
              Start a conversation to<br />see your history here
            </p>
          </div>
        )}

        {state.sessions.map((session) => {
          const isActive = session.id === activeSession?.id;
          const isEditing = editingId === session.id;

          return (
            <div
              key={session.id}
              onClick={() => handleSelect(session)}
              role="button"
              tabIndex={0}
              aria-current={isActive ? 'page' : undefined}
              onKeyDown={(e) => e.key === 'Enter' && handleSelect(session)}
              className={`group relative flex items-start gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer
                          transition-all duration-150 outline-none
                          focus-visible:ring-2 focus-visible:ring-accent-500
                          ${isActive
                            ? 'bg-white shadow-bubble border border-surface-200 text-surface-800'
                            : 'text-surface-600 hover:bg-white hover:shadow-sm hover:border hover:border-surface-100'
                          }`}
            >
              <MessageSquare size={14} className={`mt-0.5 shrink-0 ${isActive ? 'text-accent-500' : 'text-surface-400'}`} />

              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <input
                    autoFocus
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit(session.id);
                      if (e.key === 'Escape') handleCancelEdit();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full text-xs bg-transparent border-b border-accent-400 outline-none text-surface-800"
                  />
                ) : (
                  <p className="text-xs font-medium truncate leading-tight">{truncate(session.title, 30)}</p>
                )}
                <p className="text-[10px] text-surface-400 mt-0.5">
                  {formatRelativeTime(session.updatedAt)} · {session.messageCount} msgs
                </p>
              </div>

              {isEditing ? (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={(e) => { e.stopPropagation(); handleSaveEdit(session.id); }} className="p-0.5 text-accent-600 hover:text-accent-700" aria-label="Save"><Check size={13} /></button>
                  <button onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }} className="p-0.5 text-surface-400 hover:text-surface-600" aria-label="Cancel"><X size={13} /></button>
                </div>
              ) : (
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={(e) => handleStartEdit(e, session)} className="p-1 rounded text-surface-400 hover:text-surface-600 hover:bg-surface-100" aria-label="Rename"><Edit3 size={12} /></button>
                  <button onClick={(e) => handleDelete(e, session.id)} className="p-1 rounded text-surface-400 hover:text-red-500 hover:bg-red-50" aria-label="Delete"><Trash2 size={12} /></button>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-surface-200 px-3 py-3">
        <button
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-surface-500
                     hover:bg-surface-100 hover:text-surface-700 transition-all duration-150"
          onClick={() => dispatch({ type: 'SET_PANEL', payload: { rightPanelOpen: true, rightPanelTab: 'settings' } })}
        >
          <Settings size={14} />
          Settings
        </button>
      </div>
    </aside>
  );
}
