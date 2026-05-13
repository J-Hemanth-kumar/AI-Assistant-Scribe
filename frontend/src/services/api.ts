import axios from 'axios';
import type {
  DocumentUploadResponse,
  DocumentRecord,
  PreviewData,
  ExportOptions,
  ParsedContent,
  EditDiff,
  DocumentVersion,
  ExportResponse,
} from '@/types';

// ─── Axios instance ───────────────────────────────────────────────────────
export const apiClient = axios.create({
  baseURL: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:18000',
  timeout: 60_000,
  headers: { Accept: 'application/json' },
});

apiClient.interceptors.response.use(
  (res) => res,
  (err: unknown) => {
    if (axios.isAxiosError(err)) {
      const detail =
        (err.response?.data as { detail?: string } | undefined)?.detail ?? err.message;
      return Promise.reject(new Error(detail));
    }
    return Promise.reject(err);
  }
);

// ─── Documents ────────────────────────────────────────────────────────────

export async function uploadFileToApi(
  file: File,
  sessionId: string,
  onUploadProgress?: (pct: number) => void
): Promise<DocumentUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('session_id', sessionId);

  const { data } = await apiClient.post<DocumentUploadResponse>('/api/v1/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (evt) => {
      if (evt.total && onUploadProgress) {
        onUploadProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    },
  });
  return data;
}

export async function fetchDocument(docId: string): Promise<DocumentRecord> {
  const { data } = await apiClient.get<DocumentRecord>(`/api/v1/documents/${docId}`);
  return data;
}

export async function fetchDocumentPreview(docId: string): Promise<PreviewData> {
  const { data } = await apiClient.get<PreviewData>(`/api/v1/documents/${docId}/preview`);
  return data;
}

export async function deleteDocument(docId: string): Promise<void> {
  await apiClient.delete(`/api/v1/documents/${docId}`);
}

export async function listDocuments(sessionId: string): Promise<DocumentRecord[]> {
  const { data } = await apiClient.get<DocumentRecord[]>('/api/v1/documents', {
    params: { session_id: sessionId },
  });
  return data;
}

// ─── Sessions ─────────────────────────────────────────────────────────────

export async function createSession(title?: string): Promise<{ id: string; title: string }> {
  const { data } = await apiClient.post<{ id: string; title: string }>('/api/v1/sessions', {
    title: title ?? 'New conversation',
  });
  return data;
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  await apiClient.patch(`/api/v1/sessions/${sessionId}`, { title });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await apiClient.delete(`/api/v1/sessions/${sessionId}`);
}

export async function listSessions(): Promise<{ id: string; title: string; documents_count: number; documents?: any[] }[]> {
  const { data } = await apiClient.get('/api/v1/sessions');
  return data;
}

export async function fetchSession(sessionId: string): Promise<any> {
  const { data } = await apiClient.get(`/api/v1/sessions/${sessionId}`);
  return data;
}

// ─── Export ───────────────────────────────────────────────────────────────

export async function exportDocument(options: ExportOptions): Promise<ExportResponse> {
  const { data } = await apiClient.post<ExportResponse>('/api/v1/export/', options);
  return data;
}

/**
 * Downloads a raw file as a Blob from the given URL.
 * Handles the second step of the two-step export process.
 */
export async function fetchBlob(url: string): Promise<Blob> {
  const { data } = await apiClient.get<Blob>(url, {
    responseType: 'blob',
  });
  return data;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Edit / RAG ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/edit/chunks/{doc_id}
 * FIX: was calling /api/v1/chunks/{doc_id} — backend has it under /edit prefix.
 */
export async function fetchParsedContent(docId: string): Promise<ParsedContent[]> {
  const { data } = await apiClient.get<ParsedContent[]>(`/api/v1/edit/chunks/${docId}`);
  return data;
}

/**
 * GET /api/v1/edit/diff/{version_id}
 * FIX: was calling /api/v1/diff/{version_id}.
 */
export async function fetchEditDiffs(versionId: string): Promise<EditDiff[]> {
  const { data } = await apiClient.get<EditDiff[]>(`/api/v1/edit/diff/${versionId}`);
  return data;
}

/**
 * GET /api/v1/edit/versions/{doc_id}
 * FIX: was calling /api/v1/versions/{doc_id}.
 */
export async function fetchDocumentVersions(docId: string): Promise<DocumentVersion[]> {
  const { data } = await apiClient.get<DocumentVersion[]>(`/api/v1/edit/versions/${docId}`);
  return data;
}

/**
 * GET /api/v1/edit/preview/{doc_id}?version_id=N
 * NEW: Returns full edited text for a specific version.
 * Used by DocumentPreview to render the LLM-edited document.
 */
export async function fetchEditPreview(
  docId: string,
  versionId?: number
): Promise<{
  doc_id: string;
  filename: string;
  version_id: number | null;
  version_number: number;
  prompt: string | null;
  full_text: string;
  edits: EditDiff[];
  is_original: boolean;
  created_at?: string;
}> {
  const params = versionId != null ? { version_id: versionId } : {};
  const { data } = await apiClient.get(`/api/v1/edit/preview/${docId}`, { params });
  return data;
}

// Backwards-compatible alias
export { deleteDocument as deleteFile };
