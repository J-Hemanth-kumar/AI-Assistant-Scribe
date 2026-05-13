import { useMutation } from '@tanstack/react-query';
import { useAppContext } from '@/context/AppContext';
import { uploadFileToApi } from '@/services/api';

import type { DocumentUploadResponse } from '@/types';

interface UploadArgs {
  file: File;
  sessionId: string;
  /** Local UUID assigned before the mutation fires (for optimistic updates) */
  localFileId: string;
  onProgress?: (pct: number) => void;
}

/**
 * TanStack Query useMutation wrapper for POST /api/v1/upload.
 *
 * Lifecycle:
 *   onMutate  → optimistically add placeholder to AppContext
 *   mutationFn → Axios multipart POST with upload-progress callback
 *   onSuccess → patch placeholder with server doc_id + status=processing
 *   onError   → patch placeholder with status=error
 */
export function useUploadMutation() {
  const { dispatch } = useAppContext();

  return useMutation<DocumentUploadResponse, Error, UploadArgs>({
    mutationKey: ['upload'],

    mutationFn: ({ file, sessionId, localFileId, onProgress }) =>
      uploadFileToApi(file, sessionId, (pct) => {
        // Relay progress back into AppContext so FilePanel progress bar updates
        dispatch({
          type: 'UPDATE_FILE',
          payload: { fileId: localFileId, patch: { progress: pct } },
        });
        onProgress?.(pct);
      }),

    onSuccess: (data, { localFileId }) => {
      dispatch({
        type: 'UPDATE_FILE',
        payload: {
          fileId: localFileId,
          patch: {
            docId: data.doc_id,
            status: 'processing',   // triggers polling in FileRow
            progress: 100,
            backendStatus: data.status,
          },
        },
      });
    },

    onError: (err, { localFileId }) => {
      dispatch({
        type: 'UPDATE_FILE',
        payload: {
          fileId: localFileId,
          patch: {
            status: 'error',
            error: err.message,
          },
        },
      });
    },
  });
}
