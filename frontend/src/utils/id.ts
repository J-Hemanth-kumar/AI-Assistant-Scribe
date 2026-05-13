// ── ID Generation ─────────────────────────────────────────────────────────

export function generateId(prefix = ''): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return prefix ? `${prefix}_${ts}${rand}` : `${ts}${rand}`;
}

// ── File Utilities ────────────────────────────────────────────────────────

import type { SupportedFileType } from '@/types';

export const SUPPORTED_MIME_TYPES: Record<string, SupportedFileType> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const SUPPORTED_EXTENSIONS: Record<string, SupportedFileType> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.md': 'md',
  '.markdown': 'md',
  '.txt': 'txt',
  '.png': 'png',
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.webp': 'webp',
  '.gif': 'gif',
};

export function getFileType(file: File): SupportedFileType | null {
  if (SUPPORTED_MIME_TYPES[file.type]) return SUPPORTED_MIME_TYPES[file.type];
  const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
  return SUPPORTED_EXTENSIONS[ext] ?? null;
}

export function isFileSupported(file: File): boolean {
  return getFileType(file) !== null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const FILE_ICONS: Record<SupportedFileType, string> = {
  pdf: '📄',
  docx: '📝',
  md: '📋',
  txt: '📃',
  png: '🖼️',
  jpg: '🖼️',
  jpeg: '🖼️',
  webp: '🖼️',
  gif: '🎞️',
};

export function isImageType(type: SupportedFileType): boolean {
  return ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(type);
}

// ── Date Formatting ───────────────────────────────────────────────────────

export function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Text Utilities ────────────────────────────────────────────────────────

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return `${str.slice(0, max - 1)}…`;
}

/** Parse [N] citation markers from text into segments */
export interface TextSegment {
  type: 'text' | 'citation';
  content: string;
  index?: number;
}

export function parseInlineCitations(text: string): TextSegment[] {
  const parts: TextSegment[] = [];
  const regex = /\[(\d+)\]/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: 'text', content: text.slice(last, match.index) });
    }
    parts.push({ type: 'citation', content: match[0], index: parseInt(match[1]) });
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push({ type: 'text', content: text.slice(last) });
  }

  return parts;
}

/** Very light markdown → plain-text excerpt */
export function stripMarkdown(md: string): string {
  return md
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/`[^`]+`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}
