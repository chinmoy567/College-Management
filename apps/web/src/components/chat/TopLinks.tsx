'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';

const link = 'flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-base font-medium text-indigo-700 hover:bg-indigo-50 sm:px-4';

/** Messages, Notices and the bell with a live unread count. Shown in every role's top bar. */
export function TopLinks() {
  const qc = useQueryClient();
  const count = useQuery({ queryKey: ['unread-count'], queryFn: () => api<{ unread: number }>('/notifications/unread-count'), retry: false });
  useSocketEvent<{ unread: number }>('notif:new', (p) => {
    qc.setQueryData(['unread-count'], { unread: p.unread });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    void qc.invalidateQueries({ queryKey: ['urgent-unread'] });
    void qc.invalidateQueries({ queryKey: ['notices'] });
  });
  useSocketEvent<{ unread: number }>('notif:count', (p) => qc.setQueryData(['unread-count'], { unread: p.unread }));
  const n = count.data?.unread ?? 0;
  return (
    <>
      <Link href="/messages" className={link}>Messages</Link>
      <Link href="/notices" className={link}>Notices</Link>
      <Link href="/notifications" className={link} aria-label={n ? `Notifications, ${n} unread` : 'Notifications'}>
        <span aria-hidden>🔔</span>
        {n > 0 && <span data-testid="bell-count" className="ml-1 rounded-full bg-red-600 px-2 text-sm font-semibold text-white">{n > 99 ? '99+' : n}</span>}
      </Link>
    </>
  );
}
