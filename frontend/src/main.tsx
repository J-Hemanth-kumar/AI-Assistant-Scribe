import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { App } from './App';
import { AppProvider } from './context/AppContext';
import { queryClient } from './lib/queryClient';
import { warmFontCache } from './lib/pretext/layout';
import './index.css';

// ── Warm Canvas font measurement cache before first render ────────────────
// This ensures the first call to computeLayout() is fast (cache hit) rather
// than measuring every ASCII character on the critical path.
// Runs synchronously before React renders anything — acceptable cost: ~2ms.
warmFontCache('JetBrains Mono',      12); // document viewer
warmFontCache('Plus Jakarta Sans',   14); // chat messages

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {/*
      QueryClientProvider must wrap AppProvider so that hooks inside
      AppProvider (and any component beneath it) can call useQuery /
      useMutation.  queryClient is the singleton defined in lib/queryClient.ts.
    */}
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <App />
      </AppProvider>

      {/*
        ReactQueryDevtools — only bundled in development builds.
        Vite strips this via dead-code elimination when NODE_ENV=production.
        Renders a floating button (bottom-left) that opens the TanStack Query
        inspector showing cache state, active queries and mutations.
      */}
      {import.meta.env.DEV && (
        <ReactQueryDevtools
          initialIsOpen={false}
          buttonPosition="bottom-left"
        />
      )}
    </QueryClientProvider>
  </React.StrictMode>
);
