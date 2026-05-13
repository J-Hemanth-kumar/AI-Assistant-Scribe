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
  { id: 'files',   label: 'Files',    icon: <Files size={13} /> },
  { id: 'preview', label: 'Preview',  icon: <FileSearch size={13} /> },
  { id: 'export',  label: 'Export',   icon: <Download size={13} /> },
  { id: 'settings',label: 'Settings', icon: <Settings size={13} /> },
];

export function RightPanel() {
  const { state, dispatch } = useAppContext();
  const { rightPanelTab } = state.panel;

  const setTab = (tab: TabId) =>
    dispatch({ type: 'SET_PANEL', payload: { rightPanelTab: tab } });

  const close = () =>
    dispatch({ type: 'SET_PANEL', payload: { rightPanelOpen: false } });

  return (
    <aside className="flex flex-col h-full bg-white border-l border-surface-200 w-64 shrink-0">
      {/* Header with tabs */}
      <div className="flex items-center justify-between px-3 pt-3 pb-0 shrink-0">
        {/*
          4-tab layout: icons always visible, labels hidden on small widths.
          Each tab is equal-width (flex-1) inside the pill container.
        */}
        <div className="flex items-center gap-0.5 bg-surface-100 rounded-xl p-1 flex-1 min-w-0">
          {TABS.map((tab) => {
            const isActive = rightPanelTab === tab.id;
            // Show a dot on the Preview tab when a doc is selected but user is on another tab
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
                  relative flex items-center justify-center gap-1 px-0 py-1.5 rounded-lg
                  text-xs font-medium transition-all duration-150 flex-1 min-w-0
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500
                  ${isActive
                    ? 'bg-white text-surface-800 shadow-sm'
                    : 'text-surface-500 hover:text-surface-700'
                  }
                `}
                aria-selected={isActive}
              >
                {tab.icon}
                {/* Dot indicator */}
                {showDot && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent-500" />
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

      {/* Tab label strip — readable full label under the tab bar */}
      <div className="px-3 pt-1.5 pb-0 shrink-0">
        <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wide">
          {TABS.find((t) => t.id === rightPanelTab)?.label}
        </p>
      </div>

      {/* Divider */}
      <div className="h-px bg-surface-100 mx-3 mt-1.5" />

      {/* Panel content — each tab fills the remaining height */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {rightPanelTab === 'files'    && <FilePanel />}
        {rightPanelTab === 'preview'  && <DocumentPreview />}
        {rightPanelTab === 'export'   && <ExportPanel />}
        {rightPanelTab === 'settings' && <SettingsPanel />}
      </div>
    </aside>
  );
}
