import { useEffect } from 'react';
import { PanelLeft, PanelRight } from 'lucide-react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ChatWindow } from '@/components/chat/ChatWindow';
import { RightPanel } from '@/components/panel/RightPanel';
import { useAppContext } from '@/context/AppContext';
import type { Citation } from '@/types';

export function App() {
  const { state, dispatch, createSession } = useAppContext();
  const { sidebarOpen, rightPanelOpen } = state.panel;

  // Create an initial session on first load
  useEffect(() => {
    if (state.sessions.length === 0) {
      console.log('Creating initial session');
      createSession();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sessions.length, createSession]);

  const toggleSidebar = () =>
    dispatch({ type: 'SET_PANEL', payload: { sidebarOpen: !sidebarOpen } });

  const toggleRightPanel = () =>
    dispatch({ type: 'SET_PANEL', payload: { rightPanelOpen: !rightPanelOpen } });

  const handleCitationClick = (citation: Citation) => {
    // Open files panel and highlight the source
    dispatch({ type: 'SET_PANEL', payload: { rightPanelOpen: true, rightPanelTab: 'files' } });
    console.info('[Citation clicked]', citation);
  };

  return (
    <div className="flex h-full bg-surface-100 overflow-hidden">
      {/* ── Sidebar (left) ─────────────────────────────────────── */}
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-surface-900/20 backdrop-blur-sm z-20 md:hidden"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}

      <div
        className={`
          fixed md:relative inset-y-0 left-0 z-30 md:z-auto
          transition-transform duration-300 ease-in-out h-full
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0 md:w-0 md:overflow-hidden'}
        `}
        style={{ width: sidebarOpen ? undefined : undefined }}
      >
        <Sidebar onClose={toggleSidebar} />
      </div>

      {/* ── Center + Right wrapper ─────────────────────────────── */}
      <div className="flex flex-1 min-w-0 h-full overflow-hidden">
        {/* Floating toggle buttons */}
        <div className="absolute top-3 left-3 z-10 flex gap-1.5 md:hidden">
          <button
            onClick={toggleSidebar}
            className="btn-icon bg-white shadow-sm border border-surface-200"
            aria-label="Toggle sidebar"
          >
            <PanelLeft size={16} />
          </button>
        </div>

        {/* Desktop sidebar toggle */}
        <div className="hidden md:flex flex-col justify-start pt-3 pl-1.5 shrink-0">
          <button
            onClick={toggleSidebar}
            className={`btn-icon transition-colors ${sidebarOpen ? 'text-accent-600 bg-accent-50' : ''}`}
            aria-label="Toggle sidebar"
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            <PanelLeft size={16} />
          </button>
        </div>

        {/* ── Main chat ────────────────────────────────────── */}
        <div className="flex-1 min-w-0 h-full flex flex-col relative">
          {/* Right panel toggle (top-right of chat) */}
          <div className="absolute top-3 right-3 z-10">
            <button
              onClick={toggleRightPanel}
              className={`btn-icon bg-white shadow-sm border border-surface-200
                          ${rightPanelOpen ? 'text-accent-600 bg-accent-50 border-accent-200' : ''}`}
              aria-label="Toggle right panel"
              title={rightPanelOpen ? 'Hide panel' : 'Show panel'}
            >
              <PanelRight size={16} />
            </button>
          </div>

          <ChatWindow onCitationClick={handleCitationClick} />
        </div>

        {/* ── Right panel ──────────────────────────────────── */}
        <div
          className={`
            transition-all duration-300 ease-in-out overflow-hidden h-full shrink-0
            ${rightPanelOpen ? 'w-64 opacity-100' : 'w-0 opacity-0 pointer-events-none'}
          `}
        >
          <RightPanel />
        </div>
      </div>
    </div>
  );
}
