'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Urgent notices stay on top of the dashboards until they are read (PRD §5.9). */
export function UrgentBanner() {
  const q = useQuery({ queryKey: ['urgent-unread'], queryFn: () => api<{ items: { id: string; title: string }[] }>('/notices/urgent-unread'), retry: false });
  const items = q.data?.items ?? [];
  if (!items.length) return null;
  return (
    <div role="alert" data-testid="urgent-banner" className="border-b border-red-300 bg-red-50 px-4 py-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-1">
        {items.map((n) => (
          <Link key={n.id} href="/notices" className="min-h-11 text-base font-semibold text-red-800 underline">
            Urgent: {n.title}
          </Link>
        ))}
      </div>
    </div>
  );
}
