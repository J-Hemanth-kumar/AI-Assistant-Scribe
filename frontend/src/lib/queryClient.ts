import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Do not retry on 4xx — only retry transient network errors
      retry: (failureCount, error) => {
        if (error instanceof Error && error.message.includes('40')) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
      // Keep previous data while re-fetching (no flash of empty state)
      placeholderData: (prev: unknown) => prev,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
    mutations: {
      retry: false,
    },
  },
});
