import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  UploadCloud,
  FileText,
  Image as ImageIcon,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Eye,
} from 'lucide-react';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useDocumentQuery } from '@/hooks/useDocumentQuery';
import { deleteDocument } from '@/services/api';
import { formatFileSize, isImageType } from '@/utils/id';

import { DROPZONE_ACCEPT, MAX_FILE_SIZE_BYTES } from '@/utils/fileValidation';
import { useAppContext } from '@/context/AppContext';
import type { UploadedFile, FileValidationError } from '@/types';

export function FilePanel() {
  const { uploadFiles, files, removeFile } = useFileUpload();
  const [validationErrors, setValidationErrors] = useState<FileValidationError[]>([]);
  const { dispatch } = useAppContext();

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: DROPZONE_ACCEPT,
    maxSize: MAX_FILE_SIZE_BYTES,
    multiple: true,
    onDrop: async (accepted) => {
      setValidationErrors([]);
      if (accepted.length === 0) return;
      const { errors } = await uploadFiles(accepted);
      if (errors.length > 0) setValidationErrors(errors);
    },
    onDropRejected: (rejections) => {
      const errs: FileValidationError[] = rejections.map((r) => ({
        file: r.file.name,
        reason: r.errors[0]?.code === 'file-too-large' ? 'size' : 'type',
        message:
          r.errors[0]?.code === 'file-too-large'
            ? `Exceeds 20 MB limit (${(r.file.size / 1024 / 1024).toFixed(1)} MB)`
            : `Unsupported type — accepted: PDF, DOCX, MD, TXT, PNG, JPG`,
      }));
      setValidationErrors(errs);
    },
  });

  const handleDelete = async (file: UploadedFile) => {
    if (file.docId) {
      try { await deleteDocument(file.docId); } catch { /* optimistic */ }
    }
    removeFile(file.id);
  };

  const openPreview = (file: UploadedFile) => {
    dispatch({
      type: 'SET_PANEL',
      payload: { rightPanelTab: 'preview', rightPanelOpen: true },
    });
    if (file.docId) {
      dispatch({ type: 'SET_PREVIEW_DOC', payload: { docId: file.docId } });
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Drop zone */}
      <div
        {...getRootProps()}
        aria-label="Upload files"
        className={`
          relative mx-3 mt-3 flex flex-col items-center justify-center gap-2.5
          border-2 border-dashed rounded-2xl px-4 py-6 cursor-pointer
          transition-all duration-300 text-center group
          focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40
          ${isDragActive
            ? 'border-accent-400 bg-accent-50/80 dark:bg-accent-900/20 dark:border-accent-500/50 scale-[1.02]'
            : 'border-surface-200 dark:border-slate-700/50 bg-surface-50/50 dark:bg-slate-800/20 hover:border-accent-300 dark:hover:border-accent-600/40 hover:bg-accent-50/30 dark:hover:bg-accent-900/10'
          }
        `}
      >
        <input {...getInputProps()} />
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300
                         ${isDragActive
                           ? 'bg-accent-100 dark:bg-accent-900/40 scale-110'
                           : 'bg-surface-100 dark:bg-slate-700/50 group-hover:bg-accent-100 dark:group-hover:bg-accent-900/30'}`}>
          <UploadCloud size={20} className={`transition-colors ${isDragActive ? 'text-accent-500' : 'text-surface-400 dark:text-slate-500 group-hover:text-accent-500'}`} />
        </div>
        <div>
          <p className="text-xs font-semibold text-surface-700 dark:text-slate-300">
            {isDragActive ? 'Drop to upload' : 'Upload documents'}
          </p>
          <p className="text-[10px] text-surface-400 dark:text-slate-500 mt-0.5">
            PDF, DOCX, MD, TXT, PNG, JPG · max 20 MB
          </p>
        </div>
      </div>

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div className="mx-3 mt-2 space-y-1 animate-fade-in">
          {validationErrors.map((err, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5 px-2.5 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30
                         rounded-xl text-[10px] text-red-600 dark:text-red-400"
            >
              <AlertCircle size={11} className="mt-0.5 shrink-0 text-red-400" />
              <div>
                <span className="font-semibold">{err.file}:</span>{' '}
                {err.message}
              </div>
            </div>
          ))}
          <button
            onClick={() => setValidationErrors([])}
            className="text-[10px] text-surface-400 hover:text-surface-600 dark:text-slate-500 dark:hover:text-slate-300 px-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 mt-1 space-y-1.5">
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="w-12 h-12 rounded-2xl bg-surface-100 dark:bg-slate-800/50 flex items-center justify-center mb-3">
              <FileText size={22} className="text-surface-300 dark:text-slate-600" />
            </div>
            <p className="text-xs text-surface-400 dark:text-slate-500">No files uploaded yet</p>
          </div>
        ) : (
          files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              onDelete={() => void handleDelete(file)}
              onPreview={() => openPreview(file)}
            />
          ))
        )}
      </div>

      {/* Summary */}
      {files.length > 0 && (
        <div className="px-4 py-2.5 border-t border-surface-200 dark:border-slate-700/30 bg-surface-50/50 dark:bg-slate-800/20">
          <p className="text-[10px] text-surface-400 dark:text-slate-500">
            {files.length} file{files.length !== 1 ? 's' : ''} ·{' '}
            {formatFileSize(files.reduce((acc, f) => acc + f.size, 0))} total
          </p>
        </div>
      )}
    </div>
  );
}

// ── File row ─────────────────────────────────────────────────────────────

interface FileRowProps {
  file: UploadedFile;
  onDelete: () => void;
  onPreview: () => void;
}

function FileRow({ file, onDelete, onPreview }: FileRowProps) {
  const isImage = isImageType(file.type);
  const canPreview = file.status === 'ready' && !!file.docId;

  return (
    <>
      {file.docId && file.status === 'processing' && (
        <DocumentStatusPoller docId={file.docId} localFileId={file.id} />
      )}

      <div className="group flex items-start gap-2.5 px-3 py-2.5 rounded-xl
                      bg-white dark:bg-slate-800/30 border border-surface-100 dark:border-slate-700/20
                      hover:border-surface-200 dark:hover:border-slate-600/30
                      hover:shadow-sm dark:hover:shadow-dark-bubble
                      transition-all duration-200 animate-fade-in">
        {/* Icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0
                         ${isImage
                           ? 'bg-violet-50 dark:bg-violet-900/20'
                           : 'bg-blue-50 dark:bg-blue-900/20'}`}>
          {isImage ? (
            <ImageIcon size={15} className="text-violet-400" />
          ) : (
            <FileText size={15} className="text-blue-400" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-surface-700 dark:text-slate-300 truncate">{file.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <StatusBadge file={file} />
            <span className="text-[10px] text-surface-400 dark:text-slate-500">
              {formatFileSize(file.size)}
            </span>
          </div>

          {file.status === 'uploading' && (
            <div className="mt-1.5 h-1 bg-surface-100 dark:bg-slate-700/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent-500 to-accent-400 rounded-full
                           transition-all duration-300"
                style={{ width: `${file.progress ?? 0}%` }}
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          {canPreview && (
            <button
              onClick={onPreview}
              className="opacity-0 group-hover:opacity-100 p-1 rounded-lg
                         text-surface-400 dark:text-slate-500 hover:text-accent-600 dark:hover:text-accent-400
                         hover:bg-accent-50 dark:hover:bg-accent-900/20
                         transition-all duration-200"
              aria-label={`Preview ${file.name}`}
            >
              <Eye size={13} />
            </button>
          )}
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-lg
                       text-surface-400 dark:text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20
                       transition-all duration-200"
            aria-label={`Delete ${file.name}`}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </>
  );
}

function DocumentStatusPoller({ docId, localFileId }: { docId: string; localFileId: string }) {
  useDocumentQuery({ docId, localFileId, enabled: true });
  return null;
}

function StatusBadge({ file }: { file: UploadedFile }) {
  switch (file.status) {
    case 'uploading':
      return (
        <span className="flex items-center gap-1 text-[10px] text-blue-500">
          <Loader2 size={9} className="animate-spin" />
          Uploading {file.progress ?? 0}%
        </span>
      );
    case 'processing': {
      const label =
        file.backendStatus === 'parsing' ? 'Parsing…'
        : file.backendStatus === 'indexing' ? 'Indexing…'
        : 'Processing…';
      return (
        <span className="flex items-center gap-1 text-[10px] text-amber-500">
          <Loader2 size={9} className="animate-spin" />
          {label}
        </span>
      );
    }
    case 'ready':
      return (
        <span className="flex items-center gap-1 text-[10px] text-emerald-500">
          <CheckCircle2 size={9} />
          Ready
        </span>
      );
    case 'error':
      return (
        <span className="flex items-center gap-1 text-[10px] text-red-500" title={file.error}>
          <AlertCircle size={9} />
          Error
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1 text-[10px] text-surface-400 dark:text-slate-500">
          <Clock size={9} />
          Pending
        </span>
      );
  }
}
