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
  const { theme } = state.settings;

  // ── Dark mode class toggle ────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'light') {
      root.classList.remove('dark');
    } else {
      // system
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent | MediaQueryList) => {
        if (e.matches) root.classList.add('dark');
        else root.classList.remove('dark');
      };
      handler(mq);
      mq.addEventListener('change', handler as (e: MediaQueryListEvent) => void);
      return () => mq.removeEventListener('change', handler as (e: MediaQueryListEvent) => void);
    }
  }, [theme]);



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
    <div className="flex h-full overflow-hidden bg-surface-50 dark:bg-slate-950 transition-colors duration-300">
      {/* ── Sidebar (left) ─────────────────────────────────────── */}
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 dark:bg-black/50 backdrop-blur-sm z-20 md:hidden"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}

      <div
        className={`
          fixed md:relative inset-y-0 left-0 z-30 md:z-auto
          transition-all duration-300 ease-in-out h-full
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0 md:w-0 md:overflow-hidden'}
        `}
      >
        <Sidebar onClose={toggleSidebar} />
      </div>

      {/* ── Center + Right wrapper ─────────────────────────────── */}
      <div className="flex flex-1 min-w-0 h-full overflow-hidden">
        {/* Floating toggle buttons */}
        <div className="absolute top-3 left-3 z-10 flex gap-1.5 md:hidden">
          <button
            onClick={toggleSidebar}
            className="btn-icon bg-white dark:bg-slate-800 shadow-md border border-surface-200 dark:border-slate-700"
            aria-label="Toggle sidebar"
          >
            <PanelLeft size={16} />
          </button>
        </div>

        {/* Desktop sidebar toggle */}
        <div className="hidden md:flex flex-col justify-start pt-3 pl-1.5 shrink-0">
          <button
            onClick={toggleSidebar}
            className={`btn-icon transition-all duration-200 ${sidebarOpen ? 'text-accent-500 bg-accent-50 dark:bg-accent-900/20' : ''}`}
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
              className={`btn-icon bg-white dark:bg-slate-800/80 shadow-md border border-surface-200 dark:border-slate-700/50
                          transition-all duration-200
                          ${rightPanelOpen ? 'text-accent-500 bg-accent-50 dark:bg-accent-900/30 border-accent-200 dark:border-accent-700/30 shadow-glow' : ''}`}
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
            ${rightPanelOpen ? 'w-80 opacity-100' : 'w-0 opacity-0 pointer-events-none'}
          `}
        >
          <RightPanel />
        </div>
      </div>
    </div>
  );
}
