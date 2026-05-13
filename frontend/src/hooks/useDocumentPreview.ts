import { useQuery } from '@tanstack/react-query';
import { fetchDocumentPreview } from '@/services/api';
import type { PreviewData, DocumentStatus } from '@/types';

const PREVIEWABLE_STATUSES: DocumentStatus[] = ['parsed', 'indexed'];

/**
 * Fetches GET /api/v1/documents/{doc_id}/preview using TanStack Query.
 *
 * - Only enabled when the document status is `parsed` or `indexed`.
 * - staleTime: Infinity — preview content doesn't change after parsing.
 * - The query is cached keyed by doc_id, so navigating away and back
 *   shows the preview instantly without a re-fetch.
 */
export function useDocumentPreview(
  docId: string | undefined,
  backendStatus: DocumentStatus | undefined
) {
  const canPreview = !!docId && !!backendStatus && PREVIEWABLE_STATUSES.includes(backendStatus);

  return useQuery<PreviewData, Error>({
    queryKey: ['preview', docId],
    queryFn: () => fetchDocumentPreview(docId!),
    enabled: canPreview,
    staleTime: Infinity,   // preview never becomes stale
    gcTime: 10 * 60_000,
    retry: 1,
  });
}
