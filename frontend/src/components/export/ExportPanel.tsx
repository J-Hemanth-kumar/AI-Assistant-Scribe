import React, { useState } from 'react';
import {
  Download,
  FileText,
  FileDown,
  Hash,
  X,
  Eye,
} from 'lucide-react';
import { exportDocument, downloadBlob, fetchBlob, fetchEditPreview } from '@/services/api';
import { useAppContext } from '@/context/AppContext';
import type { ExportFormat, ExportOptions, Session } from '@/types';
import { formatRelativeTime } from '@/utils/id';

const FORMAT_OPTIONS: { id: ExportFormat; label: string; ext: string; icon: React.ReactNode; desc: string }[] = [
  {
    id: 'docx',
    label: 'Word Document',
    ext: '.docx',
    icon: <FileText size={16} className="text-blue-500" />,
    desc: 'Formatted with headings and citations',
  },
  {
    id: 'pdf',
    label: 'PDF Document',
    ext: '.pdf',
    icon: <FileDown size={16} className="text-red-500" />,
    desc: 'Print-ready with page numbers',
  },
  {
    id: 'md',
    label: 'Markdown',
    ext: '.md',
    icon: <Hash size={16} className="text-surface-500 dark:text-slate-400" />,
    desc: 'Raw markdown for editors',
  },
];

export function ExportPanel() {
  const {
    state: { previewVersionId },
    activeSession,
  } = useAppContext();
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('pdf');
  const [modalOpen, setModalOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePreview = () => {
    if (!activeSession) return;
    setModalOpen(true);
  };

  const handleExport = async () => {
    if (!activeSession) return;
    setExporting(true);
    setError(null);
    try {
      const docId = activeSession.pinnedSources[0]?.docId;
      if (!docId) {
        throw new Error('No document associated with this session to export.');
      }

      const options: ExportOptions = {
        doc_id: docId,
        export_format: selectedFormat,
        version_id: previewVersionId || undefined,
      };
      const response = await exportDocument(options);

      if (response.status === 'failed') {
         throw new Error(response.message || 'Export failed on server');
      }

      const blob = await fetchBlob(response.download_url);
      const fmt = FORMAT_OPTIONS.find((f) => f.id === selectedFormat)!;
      downloadBlob(blob, `${activeSession.title}${fmt.ext}`);
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  if (!activeSession) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-surface-100 dark:bg-slate-800/50 flex items-center justify-center mb-3">
          <FileDown size={24} className="text-surface-300 dark:text-slate-600" />
        </div>
        <p className="text-xs text-surface-400 dark:text-slate-500">No active session to export</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full px-3 py-3 gap-4">
      {/* Session info */}
      <div className="bg-surface-50 dark:bg-slate-800/30 rounded-xl p-3 border border-surface-200 dark:border-slate-700/30">
        <p className="text-xs font-semibold text-surface-700 dark:text-slate-300 truncate">{activeSession.title}</p>
        <p className="text-[10px] text-surface-400 dark:text-slate-500 mt-0.5">
          {activeSession.messages.length} messages · Updated{' '}
          {formatRelativeTime(activeSession.updatedAt)}
        </p>
      </div>

      {/* Format selection */}
      <div>
        <p className="text-[10px] font-bold text-surface-400 dark:text-slate-500 uppercase tracking-widest mb-2 px-1">
          Export Format
        </p>
        <div className="space-y-1.5">
          {FORMAT_OPTIONS.map((fmt) => (
            <button
              key={fmt.id}
              onClick={() => setSelectedFormat(fmt.id)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left
                transition-all duration-200
                ${selectedFormat === fmt.id
                  ? 'border-accent-300 dark:border-accent-600/40 bg-accent-50 dark:bg-accent-900/15 shadow-sm'
                  : 'border-surface-200 dark:border-slate-700/30 bg-white dark:bg-slate-800/20 hover:border-surface-300 dark:hover:border-slate-600/40 hover:bg-surface-50 dark:hover:bg-slate-800/30'
                }
              `}
              aria-pressed={selectedFormat === fmt.id}
            >
              <div className="shrink-0">{fmt.icon}</div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium ${selectedFormat === fmt.id ? 'text-accent-700 dark:text-accent-400' : 'text-surface-700 dark:text-slate-300'}`}>
                  {fmt.label}
                </p>
                <p className="text-[10px] text-surface-400 dark:text-slate-500">{fmt.desc}</p>
              </div>
              <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 transition-all duration-200
                              ${selectedFormat === fmt.id
                                ? 'border-accent-500 bg-accent-500 shadow-glow-accent'
                                : 'border-surface-300 dark:border-slate-600'}`}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Options */}
      <div>
        <p className="text-[10px] font-bold text-surface-400 dark:text-slate-500 uppercase tracking-widest mb-2 px-1">
          Options
        </p>
        <div className="space-y-1">
          <div className="bg-surface-50 dark:bg-slate-800/30 rounded-xl px-3 py-2 border border-surface-200 dark:border-slate-700/30">
             <p className="text-[10px] text-surface-400 dark:text-slate-500">Export will include all accepted AI edits applied to the document.</p>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="mt-auto space-y-2">
        <button onClick={handlePreview} className="w-full btn-ghost justify-center gap-2">
          <Eye size={14} />
          Preview
        </button>
        <button onClick={handleExport} disabled={exporting} className="w-full btn-primary justify-center">
          {exporting ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Exporting…
            </>
          ) : (
            <>
              <Download size={14} />
              Export {FORMAT_OPTIONS.find((f) => f.id === selectedFormat)?.ext}
            </>
          )}
        </button>
      </div>

      {/* Preview modal */}
      {modalOpen && (
        <ExportPreviewModal
          session={activeSession}
          format={selectedFormat}
          onExport={handleExport}
          onClose={() => setModalOpen(false)}
          exporting={exporting}
        />
      )}
    </div>
  );
}

// ── Preview modal ─────────────────────────────────────────────────────────

interface ExportPreviewModalProps {
  session: Session;
  format: ExportFormat;
  onExport: () => void;
  onClose: () => void;
  exporting: boolean;
}

function ExportPreviewModal({
  session,
  format,
  onExport,
  onClose,
  exporting,
}: ExportPreviewModalProps) {
  const [previewContent, setPreviewContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const fmt = FORMAT_OPTIONS.find((f) => f.id === format)!;
  const docId = session.pinnedSources[0]?.docId;

  React.useEffect(() => {
    async function loadPreview() {
      if (!docId) {
        setPreviewError('No document found');
        setLoading(false);
        return;
      }
      try {
        const data = await fetchEditPreview(docId);
        setPreviewContent(data.full_text);
      } catch (err) {
        setPreviewError('Failed to load document preview');
      } finally {
        setLoading(false);
      }
    }
    loadPreview();
  }, [docId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-2xl max-h-[85vh] flex flex-col animate-scale-in overflow-hidden
                   border border-surface-200 dark:border-slate-700/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200 dark:border-slate-700/50 bg-white dark:bg-slate-800 sticky top-0 z-10">
          <div className="flex items-center gap-2.5">
            {fmt.icon}
            <div>
              <h3 className="text-sm font-semibold text-surface-800 dark:text-slate-200">Export Preview</h3>
              <p className="text-[10px] text-surface-400 dark:text-slate-500">
                {session.title} · {fmt.label} content
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon">
            <X size={16} />
          </button>
        </div>

        {/* Preview body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 bg-surface-50/50 dark:bg-slate-900/50">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <span className="w-5 h-5 border-2 border-accent-200 dark:border-accent-700 border-t-accent-600 dark:border-t-accent-400 rounded-full animate-spin" />
              <p className="text-xs text-surface-400 dark:text-slate-500">Loading edited document…</p>
            </div>
          ) : previewError ? (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/30 rounded-xl text-center">
              <p className="text-xs text-red-500 dark:text-red-400">{previewError}</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-800/50 shadow-sm border border-surface-200 dark:border-slate-700/30 rounded-xl p-6 min-h-full">
               <pre className="text-[11px] font-mono text-surface-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                 {previewContent || 'Document is currently empty.'}
               </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-surface-200 dark:border-slate-700/50">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={onExport} disabled={exporting} className="btn-primary">
            {exporting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Download size={14} />
                Download {fmt.ext}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
