import React, { useState } from 'react';
import {
  Download,
  FileText,
  FileDown,
  Hash,
  X,
  Eye,
  CheckSquare,
  Square,
} from 'lucide-react';
import { exportDocument, downloadBlob, fetchBlob } from '@/services/api';
import { useAppContext } from '@/context/AppContext';
import type { ExportFormat, ExportOptions } from '@/types';
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
    icon: <Hash size={16} className="text-surface-500" />,
    desc: 'Raw markdown for editors',
  },
];

export function ExportPanel() {
  const {
    state: { previewVersionId },
    activeSession,
  } = useAppContext();
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('pdf');
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeCitations, setIncludeCitations] = useState(true);
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
      // Find the first document attached to the session
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
        <FileDown size={28} className="text-surface-300 mb-2" />
        <p className="text-xs text-surface-400">No active session to export</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full px-3 py-3 gap-4">
      {/* Session info */}
      <div className="bg-surface-50 rounded-xl p-3 border border-surface-200">
        <p className="text-xs font-semibold text-surface-700 truncate">{activeSession.title}</p>
        <p className="text-[10px] text-surface-400 mt-0.5">
          {activeSession.messages.length} messages · Updated{' '}
          {formatRelativeTime(activeSession.updatedAt)}
        </p>
      </div>

      {/* Format selection */}
      <div>
        <p className="text-[11px] font-semibold text-surface-500 uppercase tracking-wide mb-2 px-1">
          Export Format
        </p>
        <div className="space-y-1.5">
          {FORMAT_OPTIONS.map((fmt) => (
            <button
              key={fmt.id}
              onClick={() => setSelectedFormat(fmt.id)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left
                transition-all duration-150
                ${selectedFormat === fmt.id
                  ? 'border-accent-300 bg-accent-50 shadow-sm'
                  : 'border-surface-200 bg-white hover:border-surface-300 hover:bg-surface-50'
                }
              `}
              aria-pressed={selectedFormat === fmt.id}
            >
              <div className="shrink-0">{fmt.icon}</div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium ${selectedFormat === fmt.id ? 'text-accent-700' : 'text-surface-700'}`}>
                  {fmt.label}
                </p>
                <p className="text-[10px] text-surface-400">{fmt.desc}</p>
              </div>
              <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 transition-colors
                              ${selectedFormat === fmt.id ? 'border-accent-500 bg-accent-500' : 'border-surface-300'}`}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Options */}
      <div>
        <p className="text-[11px] font-semibold text-surface-500 uppercase tracking-wide mb-2 px-1">
          Options
        </p>
        <div className="space-y-1">
          <div className="bg-surface-50 rounded-xl px-3 py-2 border border-surface-200">
             <p className="text-[10px] text-surface-400">Export will include all accepted AI edits applied to the document.</p>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
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

// ── Toggle option ─────────────────────────────────────────────────────────

interface ToggleOptionProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function ToggleOption({ label, description, checked, onChange }: ToggleOptionProps) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-surface-100
                 transition-colors text-left group"
      role="checkbox"
      aria-checked={checked}
    >
      {checked ? (
        <CheckSquare size={15} className="text-accent-600 shrink-0" />
      ) : (
        <Square size={15} className="text-surface-300 shrink-0" />
      )}
      <div>
        <p className="text-xs font-medium text-surface-700">{label}</p>
        <p className="text-[10px] text-surface-400">{description}</p>
      </div>
    </button>
  );
}

// ── Preview modal ─────────────────────────────────────────────────────────

import { fetchEditPreview } from '@/services/api';

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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-900/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-modal w-full max-w-2xl max-h-[85vh] flex flex-col animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200 bg-white sticky top-0 z-10">
          <div className="flex items-center gap-2.5">
            {fmt.icon}
            <div>
              <h3 className="text-sm font-semibold text-surface-800">Export Preview</h3>
              <p className="text-[10px] text-surface-400">
                {session.title} · {fmt.label} content
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon">
            <X size={16} />
          </button>
        </div>

        {/* Preview body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 bg-surface-50/50">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <span className="w-5 h-5 border-2 border-accent-200 border-t-accent-600 rounded-full animate-spin" />
              <p className="text-xs text-surface-400">Loading edited document…</p>
            </div>
          ) : previewError ? (
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-center">
              <p className="text-xs text-red-500">{previewError}</p>
            </div>
          ) : (
            <div className="bg-white shadow-sm border border-surface-200 rounded-xl p-6 min-h-full">
               <pre className="text-[11px] font-mono text-surface-700 leading-relaxed whitespace-pre-wrap font-sans">
                 {previewContent || 'Document is currently empty.'}
               </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-surface-200">
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
