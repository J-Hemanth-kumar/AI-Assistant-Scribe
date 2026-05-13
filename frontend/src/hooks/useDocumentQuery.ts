import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { fetchDocument } from '@/services/api';
import { useAppContext } from '@/context/AppContext';
import type { DocumentRecord, DocumentStatus } from '@/types';



// Statuses that mean processing is complete (stop polling)
const TERMINAL_STATUSES: DocumentStatus[] = ['parsed', 'indexed', 'error'];

/** Frontend display status derived from backend DocumentStatus */
function toDisplayStatus(s: DocumentStatus): 'uploading' | 'processing' | 'ready' | 'error' {
  if (s === 'error') return 'error';
  if (s === 'indexed' || s === 'parsed') return 'ready';
  return 'processing';
}

interface UseDocumentQueryOptions {
  docId: string | undefined;
  /** Local file ID so we can write back to AppContext on status change */
  localFileId: string;
  /** Only start polling when true (e.g., after upload succeeds) */
  enabled?: boolean;
}

/**
 * Polls GET /api/v1/documents/{doc_id} every 2 seconds while the
 * document is in a non-terminal state.
 *
 * Automatically stops polling once `status` is `parsed`, `indexed`,
 * or `error` — matching the TanStack Query refetchInterval pattern.
 *
 * When the status changes it dispatches an UPDATE_FILE action so
 * the FilePanel UI reflects the latest backend state without extra
 * prop-drilling.
 */
export function useDocumentQuery({ docId, localFileId, enabled = true }: UseDocumentQueryOptions) {
  const { dispatch } = useAppContext();

  const query = useQuery<DocumentRecord, Error>({
    queryKey: ['document', docId],
    queryFn: () => fetchDocument(docId!),
    enabled: !!docId && enabled,

    // Poll every 2 s while still processing; return false to stop.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) return 2_000;
      return TERMINAL_STATUSES.includes(status) ? false : 2_000;
    },

    staleTime: 0,        // always re-fetch on focus when polling
    gcTime: 60_000,
  });

  // Sync backend status back into AppContext whenever the query data changes
  useEffect(() => {
    const record = query.data;
    if (!record) return;

    dispatch({
      type: 'UPDATE_FILE',
      payload: {
        fileId: localFileId,
        patch: {
          backendStatus: record.status,
          status: toDisplayStatus(record.status),
        },
      },
    });
  }, [query.data?.status, localFileId, dispatch]);

  return query;
}
