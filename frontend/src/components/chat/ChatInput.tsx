import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Send,
  Paperclip,
  X,
  FileText,
  Image as ImageIcon,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { useFileUpload } from '@/hooks/useFileUpload';
import { formatFileSize, isImageType } from '@/utils/id';
import { DROPZONE_ACCEPT, MAX_FILE_SIZE_BYTES } from '@/utils/fileValidation';
import type { UploadedFile, FileValidationError } from '@/types';

interface ChatInputProps {
  onSend: (content: string, fileIds: string[]) => void;
  disabled?: boolean;
  isConnected: boolean;
}

export function ChatInput({ onSend, disabled, isConnected }: ChatInputProps) {
  const [text, setText] = useState('');
  const [stagedFiles, setStagedFiles] = useState<UploadedFile[]>([]);
  const [dropErrors, setDropErrors] = useState<FileValidationError[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { uploadFiles } = useFileUpload();

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }, [text]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed && stagedFiles.length === 0) return;
    if (disabled) return;
    // Only pass files that have been fully indexed on the backend
    const fileIds = stagedFiles
      .filter((f) => f.status === 'ready' && f.docId)
      .map((f) => f.docId!);
    onSend(trimmed, fileIds);
    setText('');
    setStagedFiles([]);
    setDropErrors([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /**
   * Passed to react-dropzone onDrop.
   * `accepted` files have already passed react-dropzone's MIME + size filters.
   * uploadFiles() runs the additional magic-byte FileReader check, then
   * fires the TanStack Query useMutation → Axios POST /api/v1/upload.
   */
  const onDrop = useCallback(
    async (accepted: File[]) => {
      setDropErrors([]);
      if (accepted.length === 0) return;
      // uploadFiles returns { uploaded, errors } — destructure correctly
      const { uploaded, errors } = await uploadFiles(accepted);
      if (uploaded.length > 0) {
        setStagedFiles((prev) => [...prev, ...uploaded]);
      }
      if (errors.length > 0) {
        setDropErrors(errors);
      }
    },
    [uploadFiles]
  );

  // ── React Dropzone ────────────────────────────────────────────────────────
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: DROPZONE_ACCEPT,
    maxSize: MAX_FILE_SIZE_BYTES,
    multiple: true,
    noClick: true,   // we control the click via the paperclip button
    noKeyboard: true,
    onDropRejected: (rejections) => {
      const errs: FileValidationError[] = rejections.map((r) => ({
        file: r.file.name,
        reason: r.errors[0]?.code === 'file-too-large' ? 'size' : 'type',
        message:
          r.errors[0]?.code === 'file-too-large'
            ? `Exceeds 20 MB limit (${(r.file.size / 1024 / 1024).toFixed(1)} MB)`
            : `Unsupported type — accepted: PDF, DOCX, MD, TXT, PNG, JPG`,
      }));
      setDropErrors(errs);
    },
  });

  const removeStagedFile = (fileId: string) =>
    setStagedFiles((prev) => prev.filter((f) => f.id !== fileId));

  const canSend =
    (text.trim().length > 0 || stagedFiles.length > 0) && !disabled && isConnected;

  return (
    <div className="px-4 pb-4 pt-2">
      {/* Staged files row */}
      {stagedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 px-1">
          {stagedFiles.map((file) => (
            <StagedFileChip
              key={file.id}
              file={file}
              onRemove={() => removeStagedFile(file.id)}
            />
          ))}
        </div>
      )}

      {/* Inline validation errors */}
      {dropErrors.length > 0 && (
        <div className="mb-2 space-y-1 animate-fade-in">
          {dropErrors.map((err, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5 px-2.5 py-1.5 bg-red-50 dark:bg-red-950/20 border
                         border-red-200 dark:border-red-900/40 rounded-xl text-[10px] text-red-600 dark:text-red-400"
            >
              <AlertCircle size={10} className="mt-0.5 shrink-0 text-red-400" />
              <span>
                <strong>{err.file}:</strong> {err.message}
              </span>
            </div>
          ))}
          <button
            onClick={() => setDropErrors([])}
            className="text-[10px] text-surface-400 dark:text-zinc-500 hover:text-surface-600 dark:hover:text-zinc-300 px-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Input container — drag-and-drop root ── */}
      <div
        {...getRootProps()}
        className={`
          relative flex items-end gap-2 bg-white dark:bg-slate-900/50 border rounded-2xl px-3 py-2.5
          transition-all duration-200 shadow-sm dark:shadow-[0_4px_20px_rgba(0,0,0,0.15)]
          ${isDragActive
            ? 'border-accent-400 ring-2 ring-accent-200 dark:ring-accent-950 bg-accent-50 dark:bg-accent-950/20'
            : 'border-surface-200 dark:border-slate-800/80 focus-within:border-accent-400 dark:focus-within:border-accent-500/50 focus-within:shadow-input dark:focus-within:shadow-[0_0_15px_rgba(99,102,241,0.15)]'
          }
        `}
      >
        {/* Hidden dropzone input (react-dropzone internal) */}
        <input {...getInputProps()} />

        {/* Drag overlay */}
        {isDragActive && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-2xl
                       bg-accent-50/80 dark:bg-accent-950/80 border-2 border-dashed border-accent-400 dark:border-accent-500 z-10
                       pointer-events-none"
          >
            <div className="flex flex-col items-center gap-1">
              <Paperclip size={20} className="text-accent-500" />
              <p className="text-xs font-medium text-accent-700 dark:text-accent-300">Drop files to attach</p>
              <p className="text-[10px] text-accent-500 dark:text-accent-400">PDF, DOCX, MD, TXT, PNG, JPG · max 20 MB</p>
            </div>
          </div>
        )}

        {/* Paperclip button — triggers the dropzone file picker */}
        <button
          type="button"
          onClick={open}                    // react-dropzone's programmatic open
          className="shrink-0 p-1.5 rounded-lg text-surface-400 dark:text-zinc-400 hover:text-surface-600 dark:hover:text-zinc-200
                     hover:bg-surface-100 dark:hover:bg-slate-800/50 transition-all duration-150 self-end mb-0.5
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          aria-label="Attach files"
          title="Attach files (PDF, DOCX, MD, TXT, PNG, JPG — max 20 MB)"
        >
          <Paperclip size={17} />
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isConnected
              ? 'Ask anything… (Shift+Enter for new line)'
              : 'Connecting to server…'
          }
          disabled={!isConnected || disabled}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-surface-800 dark:text-zinc-100
                     placeholder:text-surface-400 dark:placeholder:text-zinc-500 outline-none leading-relaxed
                     py-1 max-h-44 scrollbar-none"
          aria-label="Message input"
          aria-multiline="true"
        />

        {/* Send button */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className={`
            shrink-0 p-2 rounded-xl transition-all duration-150 self-end mb-0.5
            focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500
            ${canSend
              ? `bg-gradient-to-br from-accent-600 to-accent-500 text-white shadow-sm dark:shadow-[0_0_15px_rgba(99,102,241,0.25)]
                 hover:shadow-md active:scale-95 hover:from-accent-700 hover:to-accent-600`
              : 'bg-surface-100 dark:bg-slate-800 text-surface-300 dark:text-zinc-600 cursor-not-allowed'
            }
          `}
          aria-label="Send message"
        >
          <Send size={15} />
        </button>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between mt-1.5 px-1">
        <span
          className={`text-[10px] flex items-center gap-1 font-medium ${
            isConnected ? 'text-green-500' : 'text-amber-500'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isConnected ? 'bg-green-500' : 'bg-amber-450 animate-pulse'
            }`}
          />
          {isConnected ? 'Connected' : 'Reconnecting…'}
        </span>
        <span className="text-[10px] text-surface-400 dark:text-zinc-500 font-medium">
          {text.length > 0 && `${text.length} chars · `}Enter to send
        </span>
      </div>
    </div>
  );
}

// ── Staged file chip ──────────────────────────────────────────────────────

interface StagedFileChipProps {
  file: UploadedFile;
  onRemove: () => void;
}

function StagedFileChip({ file, onRemove }: StagedFileChipProps) {
  const isImage = isImageType(file.type);
  const isError = file.status === 'error';
  // 'uploading' = XHR in-flight; 'processing' = server parsing/indexing
  const isLoading = file.status === 'uploading' || file.status === 'processing';

  const statusLabel =
    file.status === 'uploading'
      ? `${file.progress ?? 0}%`
      : file.status === 'processing'
      ? file.backendStatus === 'parsing'
        ? 'Parsing…'
        : file.backendStatus === 'indexing'
        ? 'Indexing…'
        : 'Processing…'
      : formatFileSize(file.size);

  return (
    <div
      className={`
        flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-xl text-xs border
        transition-all duration-150 max-w-[200px]
        ${isError
          ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-400'
          : 'bg-surface-50 dark:bg-slate-900/40 border-surface-200 dark:border-slate-800/60 text-surface-700 dark:text-zinc-350'
        }
      `}
    >
      {isImage ? (
        <ImageIcon size={12} className="shrink-0 text-surface-400 dark:text-zinc-500" />
      ) : (
        <FileText size={12} className="shrink-0 text-surface-400 dark:text-zinc-500" />
      )}

      <div className="min-w-0">
        <p className="truncate font-medium" style={{ maxWidth: '120px' }}>
          {file.name}
        </p>
        <p className={`text-[10px] ${isError ? 'text-red-500 dark:text-red-400' : 'text-surface-400 dark:text-zinc-500'}`}>
          {isError ? (file.error ?? 'Error') : statusLabel}
        </p>
      </div>

      {isLoading ? (
        <Loader2 size={12} className="animate-spin text-accent-400 shrink-0" />
      ) : (
        <button
          onClick={onRemove}
          className="p-0.5 rounded text-surface-400 dark:text-zinc-500 hover:text-surface-700 dark:hover:text-zinc-350
                     hover:bg-surface-200 dark:hover:bg-slate-800 shrink-0"
          aria-label={`Remove ${file.name}`}
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

