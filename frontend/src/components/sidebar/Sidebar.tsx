import React, { useState, useCallback, useMemo } from 'react';
import { Plus, MessageSquare, Trash2, Edit3, Check, X, ChevronLeft, Settings, Zap, Calendar } from 'lucide-react';
import { useAppContext } from '@/context/AppContext';
import { formatRelativeTime, truncate } from '@/utils/id';
import type { Session } from '@/types';

interface SidebarProps { onClose?: () => void; }

function groupSessions(sessions: Session[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const sevenDaysAgoStart = todayStart - 7 * 24 * 60 * 60 * 1000;

  const groups: { [key: string]: { label: string; items: Session[] } } = {
    today: { label: 'Today', items: [] },
    yesterday: { label: 'Yesterday', items: [] },
    thisWeek: { label: 'This Week', items: [] },
    older: { label: 'Older', items: [] },
  };

  sessions.forEach((session) => {
    const updatedTime = new Date(session.updatedAt).getTime();
    if (updatedTime >= todayStart) {
      groups.today.items.push(session);
    } else if (updatedTime >= yesterdayStart) {
      groups.yesterday.items.push(session);
    } else if (updatedTime >= sevenDaysAgoStart) {
      groups.thisWeek.items.push(session);
    } else {
      groups.older.items.push(session);
    }
  });

  return groups;
}

export function Sidebar({ onClose }: SidebarProps) {
  const { state, activeSession, createSession, renameSession, deleteSession, dispatch } = useAppContext();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [loading, setLoading] = useState(false);

  const handleNewSession = useCallback(async () => {
    setLoading(true);
    try { await createSession(); }
    catch (err) { console.error('Failed to create session:', err); }
    finally { setLoading(false); }
  }, [createSession]);

  const handleSelect = (session: Session) => {
    dispatch({ type: 'SET_ACTIVE_SESSION', payload: { sessionId: session.id } });
  };

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

  const handleSaveEdit = async (sessionId: string) => {
    const trimmed = editTitle.trim();
    if (trimmed) {
      try { await renameSession(sessionId, trimmed); }
      catch (err) { console.error('Failed to rename session:', err); }
    }
    setEditingId(null);
  };

  const handleCancelEdit = () => { setEditingId(null); setEditTitle(''); };

  const sessionGroups = useMemo(() => groupSessions(state.sessions), [state.sessions]);

  return (
    <aside className="flex flex-col h-full glass-sidebar border-r border-surface-200/80 dark:border-slate-800/30 w-64 shrink-0 transition-colors duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-surface-200/50 dark:border-slate-800/30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent-600 via-accent-500 to-indigo-500 flex items-center justify-center shadow-md shadow-accent-500/20 dark:shadow-accent-500/10 hover:scale-105 transition-transform duration-300">
            <Zap size={15} className="text-white fill-white/10" />
          </div>
          <span className="font-bold text-surface-800 dark:text-slate-100 text-sm tracking-tight bg-gradient-to-r from-accent-600 to-indigo-500 bg-clip-text text-transparent">Scribe</span>
        </div>
        <button onClick={onClose} className="btn-icon md:hidden" aria-label="Close sidebar">
          <ChevronLeft size={16} />
        </button>
      </div>

      {/* Action Area */}
      <div className="px-3 py-3">
        <button
          onClick={handleNewSession}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-2xl text-sm font-semibold
                     text-white bg-gradient-to-r from-accent-600 via-accent-500 to-indigo-500
                     hover:from-accent-500 hover:to-indigo-400 hover:shadow-glow-accent
                     transition-all duration-300 scale-100 active:scale-[0.98] group disabled:opacity-50"
        >
          <Plus size={16} className="group-hover:rotate-90 transition-transform duration-300" />
          {loading ? 'Creating…' : 'New conversation'}
        </button>
      </div>

      {/* Nav List */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-4" aria-label="Conversations">
        {state.sessions.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <div className="w-12 h-12 rounded-2xl bg-surface-100/50 dark:bg-slate-800/40 flex items-center justify-center mx-auto mb-3">
              <MessageSquare size={22} className="text-surface-300 dark:text-slate-600" />
            </div>
            <p className="text-xs text-surface-400 dark:text-slate-500 leading-relaxed font-medium">
              Start a conversation to<br />see your history here
            </p>
          </div>
        ) : (
          Object.keys(sessionGroups).map((key) => {
            const group = sessionGroups[key];
            if (group.items.length === 0) return null;

            return (
              <div key={key} className="space-y-1">
                <p className="text-[10px] font-bold text-surface-400 dark:text-slate-500 uppercase tracking-widest px-3 mb-1.5 flex items-center gap-1">
                  <Calendar size={10} className="opacity-70" />
                  {group.label}
                </p>
                
                <div className="space-y-0.5">
                  {group.items.map((session) => {
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
                                    transition-all duration-200 outline-none border
                                    focus-visible:ring-2 focus-visible:ring-accent-500/40
                                    ${isActive
                                      ? 'bg-white dark:bg-slate-800/40 shadow-sm border-surface-200/80 dark:border-slate-700/30 text-surface-800 dark:text-slate-200'
                                      : 'border-transparent text-surface-600 dark:text-slate-400 hover:bg-white/40 dark:hover:bg-slate-800/20 hover:border-surface-100/50 dark:hover:border-slate-800/10'
                                    }`}
                      >
                        {/* Active indicator bar */}
                        {isActive && (
                          <div className="absolute left-0 top-2.5 bottom-2.5 w-1 rounded-r-md bg-accent-500 dark:bg-accent-400" />
                        )}

                        <MessageSquare size={14} className={`mt-0.5 shrink-0 ${isActive ? 'text-accent-500 dark:text-accent-400' : 'text-surface-400 dark:text-slate-500'}`} />

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
                              className="w-full text-xs bg-transparent border-b border-accent-400 outline-none text-surface-800 dark:text-slate-200"
                            />
                          ) : (
                            <p className="text-xs font-medium truncate leading-tight">{truncate(session.title, 30)}</p>
                          )}
                          <p className="text-[10px] text-surface-400 dark:text-slate-500 mt-0.5">
                            {formatRelativeTime(session.updatedAt)} · {session.messageCount} msgs
                          </p>
                        </div>

                        {isEditing ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={(e) => { e.stopPropagation(); handleSaveEdit(session.id); }} className="p-0.5 text-accent-600 hover:text-accent-700" aria-label="Save"><Check size={13} /></button>
                            <button onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }} className="p-0.5 text-surface-400 hover:text-surface-600" aria-label="Cancel"><X size={13} /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 shrink-0">
                            <button onClick={(e) => handleStartEdit(e, session)} className="p-1 rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:bg-slate-700/50" aria-label="Rename"><Edit3 size={12} /></button>
                            <button onClick={(e) => handleDelete(e, session.id)} className="p-1 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20" aria-label="Delete"><Trash2 size={12} /></button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-surface-200/50 dark:border-slate-800/30 px-3 py-3">
        <button
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-surface-500 hover:text-surface-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-surface-100/50 dark:hover:bg-slate-800/30 transition-all duration-200"
          onClick={() => dispatch({ type: 'SET_PANEL', payload: { rightPanelOpen: true, rightPanelTab: 'settings' } })}
        >
          <Settings size={14} />
          Settings
        </button>
      </div>
    </aside>
  );
}
