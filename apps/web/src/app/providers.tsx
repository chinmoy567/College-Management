'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function Providers({ children }: { children: ReactNode }) {
  // Data stays fresh for 60 s so page changes reuse the cached /auth/me, bell count and urgent banner
  // instead of re-fetching them from the database on every navigation and tab focus.
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } } }));
  useEffect(() => {
    // PWA: offline shell + push handler (public/sw.js). Never caches API data.
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
