import { useCallback } from 'react';
import { useAppContext } from '@/context/AppContext';
import { useUploadMutation } from '@/hooks/useUploadMutation';
import { generateId, getFileType } from '@/utils/id';
import { validateFiles } from '@/utils/fileValidation';
import type { UploadedFile, FileValidationError } from '@/types';

export interface UseFileUploadReturn {
  files: UploadedFile[];
  uploadFiles: (raw: File[]) => Promise<{ uploaded: UploadedFile[]; errors: FileValidationError[] }>;
  removeFile: (fileId: string) => void;
  isPending: boolean;
}

/**
 * Facade hook — keeps the same external interface used by FilePanel and ChatInput
 * but delegates to:
 *   - validateFiles()         (FileReader MIME + size check)
 *   - useUploadMutation()     (TanStack Query useMutation → Axios POST /api/v1/upload)
 *   - AppContext dispatch      (optimistic UI updates)
 */
export function useFileUpload(): UseFileUploadReturn {
  const { state, dispatch } = useAppContext();
  const mutation = useUploadMutation();

  const uploadFiles = useCallback(
    async (raw: File[]): Promise<{ uploaded: UploadedFile[]; errors: FileValidationError[] }> => {
      const sessionId = state.activeSessionId;
      if (!sessionId) throw new Error('No active session');

      // Step 1 — validate with FileReader before any API call
      const { valid, errors } = await validateFiles(raw);

      const uploaded: UploadedFile[] = [];

      // Step 2 — for each valid file, optimistic add + useMutation
      for (const file of valid) {
        const fileType = getFileType(file)!;
        const localFileId = generateId('file');

        // Optimistic placeholder shown immediately in the UI
        const placeholder: UploadedFile = {
          id: localFileId,
          name: file.name,
          type: fileType,
          size: file.size,
          uploadedAt: new Date(),
          status: 'uploading',
          progress: 0,
        };
        dispatch({ type: 'ADD_FILE', payload: { file: placeholder } });

        try {
          // TanStack Query useMutation — Axios multipart POST
          await mutation.mutateAsync({ file, sessionId, localFileId });
          uploaded.push(placeholder);
        } catch {
          // onError in useUploadMutation already patches the status to 'error'
        }
      }

      return { uploaded, errors };
    },
    [state.activeSessionId, dispatch, mutation]
  );

  const removeFile = useCallback(
    (fileId: string) => {
      dispatch({ type: 'REMOVE_FILE', payload: { fileId } });
    },
    [dispatch]
  );

  return {
    files: state.globalFiles,
    uploadFiles,
    removeFile,
    isPending: mutation.isPending,
  };
}
