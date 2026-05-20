import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, ChevronDown, Loader2, AlertCircle } from 'lucide-react';
import { fetchEditPreview, fetchDocumentVersions } from '@/services/api';
import { useAppContext } from '@/context/AppContext';

export function DocumentPreview() {
  const { state, dispatch } = useAppContext();
  const docId = state.previewDocId;
  const [selectedVersionId, setSelectedVersionId] = useState<number | undefined>(undefined);

  const { data: versions } = useQuery({
    queryKey: ['versions', docId],
    queryFn: () => fetchDocumentVersions(docId!),
    enabled: !!docId,
    staleTime: 30_000,
  });

  const {
    data: preview,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['edit-preview', docId, selectedVersionId],
    queryFn: () => fetchEditPreview(docId!, selectedVersionId),
    enabled: !!docId,
    staleTime: 10_000,
  });

  if (!docId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-surface-100 dark:bg-slate-800/50 flex items-center justify-center">
          <FileText size={24} className="text-surface-300 dark:text-slate-600" />
        </div>
        <p className="text-sm font-semibold text-surface-600 dark:text-slate-400">No document selected</p>
        <p className="text-xs text-surface-400 dark:text-slate-500 leading-relaxed">
          Upload a document and open it from the Files tab to preview edits here.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-surface-400 dark:text-slate-500">
        <Loader2 size={18} className="animate-spin text-accent-500" />
        <span className="text-sm">Loading preview…</span>
      </div>
    );
  }

  if (isError || !preview) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
        <AlertCircle size={20} className="text-red-400" />
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load preview</p>
        <p className="text-xs text-surface-400 dark:text-slate-500">{(error as Error)?.message}</p>
      </div>
    );
  }

  const editCount = preview.edits?.length ?? 0;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 border-b border-surface-200 dark:border-slate-700/30 flex-shrink-0">
        <p className="text-xs font-semibold text-surface-700 dark:text-slate-300 truncate">{preview.filename}</p>

        {versions && versions.length > 0 && (
          <div className="mt-2 relative">
            <select
              value={selectedVersionId ?? ''}
              onChange={(e) => setSelectedVersionId(e.target.value ? Number(e.target.value) : undefined)}
              className="w-full text-xs border border-surface-200 dark:border-slate-700/50 rounded-lg px-2 py-1.5 pr-7
                         bg-white dark:bg-slate-800/50 text-surface-700 dark:text-slate-300 appearance-none focus:outline-none
                         focus:ring-1 focus:ring-accent-400/50 cursor-pointer"
            >
              <option value="">Latest version</option>
              {versions.map((v) => (
                <option key={v.version_id} value={v.version_id}>
                  v{v.version_number} — {v.prompt?.slice(0, 30)}…
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-400 dark:text-slate-500 pointer-events-none" />
          </div>
        )}

        <div className="flex items-center gap-2 mt-2">
          {preview.is_original ? (
            <span className="text-[10px] px-2 py-0.5 bg-surface-100 dark:bg-slate-700/50 text-surface-500 dark:text-slate-400 rounded-full">
              Original
            </span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400 rounded-full border border-accent-200 dark:border-accent-700/30">
              v{preview.version_number} · {editCount} edit{editCount !== 1 ? 's' : ''}
            </span>
          )}
          {preview.prompt && (
            <span className="text-[10px] text-surface-400 dark:text-slate-500 truncate" title={preview.prompt}>
              "{preview.prompt.slice(0, 40)}…"
            </span>
          )}
        </div>

        <button
          className="mt-2 w-full text-[10px] py-1.5 px-2 bg-accent-50 dark:bg-accent-900/20 hover:bg-accent-100 dark:hover:bg-accent-900/30
                     text-accent-700 dark:text-accent-400 rounded-lg border border-accent-200 dark:border-accent-700/30 transition-colors"
          onClick={() => dispatch({ type: 'SET_ACTIVE_CHAT_DOC', payload: { docId } })}
        >
          Use this doc for chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {preview.full_text ? (
          <EditedDocumentRenderer
            text={preview.full_text}
            edits={preview.edits ?? []}
            isOriginal={preview.is_original}
          />
        ) : (
          <p className="text-xs text-surface-400 dark:text-slate-500 text-center mt-8">No content available.</p>
        )}
      </div>
    </div>
  );
}

interface EditedDocumentRendererProps {
  text: string;
  edits: Array<{ original_text: string; updated_text: string; reason?: string }>;
  isOriginal: boolean;
}

function EditedDocumentRenderer({ text, edits, isOriginal }: EditedDocumentRendererProps) {
  if (isOriginal || edits.length === 0) {
    return (
      <div className="text-xs text-surface-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap font-mono">
        {text}
      </div>
    );
  }

  const segments: Array<{ text: string; isEdit: boolean; reason?: string }> = [];
  let remaining = text;
  for (const edit of edits) {
    if (!edit.updated_text) continue;
    const idx = remaining.indexOf(edit.updated_text);
    if (idx === -1) continue;
    if (idx > 0) segments.push({ text: remaining.slice(0, idx), isEdit: false });
    segments.push({ text: edit.updated_text, isEdit: true, reason: edit.reason });
    remaining = remaining.slice(idx + edit.updated_text.length);
  }
  if (remaining) segments.push({ text: remaining, isEdit: false });

  return (
    <div className="text-xs leading-relaxed whitespace-pre-wrap font-mono">
      {segments.map((seg, i) =>
        seg.isEdit ? (
          <mark
            key={i}
            title={seg.reason}
            className="bg-accent-100 dark:bg-accent-900/30 text-accent-900 dark:text-accent-300 rounded px-0.5 cursor-help border-b border-accent-400 dark:border-accent-600"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i} className="text-surface-700 dark:text-slate-300">{seg.text}</span>
        )
      )}
    </div>
  );
}
