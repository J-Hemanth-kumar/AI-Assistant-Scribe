import type { FileValidationError } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────

export const MAX_FILE_SIZE_MB = 20;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export const ACCEPT_MIME_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'text/markdown': ['.md', '.markdown'],
  'text/plain': ['.txt'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
};

// For react-dropzone `accept` prop format
export const DROPZONE_ACCEPT = ACCEPT_MIME_TYPES;

export const ACCEPT_EXTENSIONS = ['.pdf', '.docx', '.md', '.txt', '.png', '.jpg', '.jpeg', '.webp', '.gif'];

// ─── Magic byte signatures ────────────────────────────────────────────────
// Used by FileReader MIME check — prevents renamed files from bypassing validation

interface MagicSignature {
  bytes: number[];
  mask?: number[];   // optional bitmask (0xFF = exact match)
  offset?: number;
}

const MAGIC_BYTES: Record<string, MagicSignature[]> = {
  'application/pdf': [{ bytes: [0x25, 0x50, 0x44, 0x46] }],               // %PDF
  'image/png':       [{ bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A] }],  // PNG
  'image/jpeg':      [{ bytes: [0xFF, 0xD8, 0xFF] }],                      // JPEG SOI
  'image/webp':      [{ bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }],    // WEBP (at offset 8)
  'image/gif':       [{ bytes: [0x47, 0x49, 0x46] }],                      // GIF
  // DOCX = ZIP container: PK header
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    { bytes: [0x50, 0x4B, 0x03, 0x04] },
  ],
  // Text-based — no binary magic, rely on extension + MIME
  'text/plain':    [],
  'text/markdown': [],
};

// ─── Read file header via FileReader ─────────────────────────────────────

function readHeader(file: File, bytes = 16): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const buf = e.target?.result as ArrayBuffer;
      resolve(new Uint8Array(buf));
    };
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsArrayBuffer(file.slice(0, bytes));
  });
}

function matchesMagic(header: Uint8Array, sig: MagicSignature): boolean {
  const offset = sig.offset ?? 0;
  for (let i = 0; i < sig.bytes.length; i++) {
    const mask = sig.mask?.[i] ?? 0xff;
    if ((header[offset + i] & mask) !== (sig.bytes[i] & mask)) return false;
  }
  return true;
}

async function verifyMime(file: File): Promise<boolean> {
  const claimedMime = file.type;
  const sigs = MAGIC_BYTES[claimedMime];
  if (!sigs) return false;       // unknown MIME — reject
  if (sigs.length === 0) return true;  // text types — no magic, trust extension

  const header = await readHeader(file, 16);
  return sigs.some((sig) => matchesMagic(header, sig));
}

// ─── Extension → expected MIME ────────────────────────────────────────────

const EXT_TO_MIME: Record<string, string> = {
  pdf:  'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md:   'text/markdown',
  markdown: 'text/markdown',
  txt:  'text/plain',
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif:  'image/gif',
};

// ─── Public API ───────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: File[];
  errors: FileValidationError[];
}

/**
 * Validates files by:
 * 1. Extension whitelist check
 * 2. Size ≤ 20 MB
 * 3. FileReader magic-byte MIME verification
 *
 * Returns separated valid/errors arrays so the UI can proceed with valid
 * files immediately and display inline errors for rejected ones.
 */
export async function validateFiles(files: File[]): Promise<ValidationResult> {
  const valid: File[] = [];
  const errors: FileValidationError[] = [];

  for (const file of files) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const expectedMime = EXT_TO_MIME[ext];

    // 1. Extension check
    if (!expectedMime) {
      errors.push({
        file: file.name,
        reason: 'type',
        message: `Unsupported file type (.${ext}). Accepted: PDF, DOCX, MD, TXT, PNG, JPG`,
      });
      continue;
    }

    // 2. Size check
    if (file.size > MAX_FILE_SIZE_BYTES) {
      errors.push({
        file: file.name,
        reason: 'size',
        message: `File exceeds ${MAX_FILE_SIZE_MB} MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB)`,
      });
      continue;
    }

    // 3. MIME magic-byte check via FileReader
    // If the browser doesn't assign a MIME (some OS/browsers omit it for .md/.txt),
    // patch it from the extension before verifying.
    const fileWithMime =
      file.type && MAGIC_BYTES[file.type] !== undefined
        ? file
        : new File([file], file.name, { type: expectedMime });

    try {
      const mimeOk = await verifyMime(fileWithMime);
      if (!mimeOk) {
        errors.push({
          file: file.name,
          reason: 'mime_mismatch',
          message: `File content doesn't match its extension (.${ext}). The file may be corrupt or renamed.`,
        });
        continue;
      }
    } catch {
      // If FileReader fails, fall through to extension-only validation
    }

    valid.push(file);
  }

  return { valid, errors };
}
