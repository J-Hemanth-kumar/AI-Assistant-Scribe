import React from 'react';
import { X, Files, Download, Settings, FileSearch } from 'lucide-react';
import { FilePanel } from './FilePanel';
import { DocumentPreview } from './DocumentPreview';
import { ExportPanel } from '@/components/export/ExportPanel';
import { SettingsPanel } from './SettingsPanel';
import { useAppContext } from '@/context/AppContext';
import type { PanelState } from '@/types';

type TabId = PanelState['rightPanelTab'];

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'files',   label: 'Files',    icon: <Files size={14} /> },
  { id: 'preview', label: 'Preview',  icon: <FileSearch size={14} /> },
  { id: 'export',  label: 'Export',   icon: <Download size={14} /> },
  { id: 'settings',label: 'Settings', icon: <Settings size={14} /> },
];

export function RightPanel() {
  const { state, dispatch } = useAppContext();
  const { rightPanelTab } = state.panel;

  const setTab = (tab: TabId) =>
    dispatch({ type: 'SET_PANEL', payload: { rightPanelTab: tab } });

  const close = () =>
    dispatch({ type: 'SET_PANEL', payload: { rightPanelOpen: false } });

  return (
    <aside className="flex flex-col h-full w-80 shrink-0
                       bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl
                       border-l border-surface-200/80 dark:border-slate-700/30
                       transition-colors duration-300">
      {/* Header with tabs */}
      <div className="flex items-center justify-between px-3 pt-3 pb-0 shrink-0">
        <div className="flex items-center gap-0.5 bg-surface-100/80 dark:bg-slate-800/60 rounded-xl p-1 flex-1 min-w-0">
          {TABS.map((tab) => {
            const isActive = rightPanelTab === tab.id;
            const showDot =
              tab.id === 'preview' &&
              !isActive &&
              !!state.previewDocId;

            return (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                title={tab.label}
                className={`
                  relative flex items-center justify-center gap-1.5 px-0 py-2 rounded-lg
                  text-xs font-medium transition-all duration-200 flex-1 min-w-0
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40
                  ${isActive
                    ? 'bg-white dark:bg-slate-700/80 text-accent-600 dark:text-accent-400 shadow-sm'
                    : 'text-surface-400 dark:text-slate-500 hover:text-surface-600 dark:hover:text-slate-300'
                  }
                `}
                aria-selected={isActive}
              >
                {tab.icon}
                {showDot && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse" />
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={close}
          className="btn-icon ml-1.5 shrink-0"
          aria-label="Close panel"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tab label strip */}
      <div className="px-3 pt-2 pb-0 shrink-0">
        <p className="text-[10px] font-bold text-surface-400 dark:text-slate-500 uppercase tracking-widest">
          {TABS.find((t) => t.id === rightPanelTab)?.label}
        </p>
      </div>

      {/* Divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-surface-200 dark:via-slate-700/50 to-transparent mx-3 mt-2" />

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {rightPanelTab === 'files'    && <FilePanel />}
        {rightPanelTab === 'preview'  && <DocumentPreview />}
        {rightPanelTab === 'export'   && <ExportPanel />}
        {rightPanelTab === 'settings' && <SettingsPanel />}
      </div>
    </aside>
  );
}
