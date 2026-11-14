'use client';

import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Me } from '@/lib/community';
import { ListSkeleton } from '@/components/ui';

const HOME = { admin: '/admin', teacher: '/teacher/attendance', student: '/student/routine' } as const;

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api<{ user: Me & { stepUpPending?: boolean } }>('/auth/me')).user,
    retry: false,
  });

/** Shared by every role (`/feed`, `/u/[id]`): guard for any signed-in user (UX only) and a small top bar. */
export function CommunityShell({ children }: { children: (me: Me) => ReactNode }) {
  const me = useMe();
  const bad = me.isError || (me.data && me.data.stepUpPending);
  useEffect(() => {
    if (bad) window.location.assign('/login');
  }, [bad]);
  if (!me.data || bad)
    return (
      <main className="mx-auto max-w-2xl p-4">
        <ListSkeleton />
      </main>
    );
  return (
    <div className="min-h-screen">
      <nav aria-label="Community" className="mx-auto flex max-w-2xl gap-1 overflow-x-auto px-2 pt-3">
        <Link href={HOME[me.data.role]} className="flex min-h-11 items-center rounded-lg px-3 text-base font-medium text-indigo-700 hover:bg-indigo-50">
          ← Home
        </Link>
        <Link href="/feed" className="flex min-h-11 items-center rounded-lg px-3 text-base font-medium text-indigo-700 hover:bg-indigo-50">
          Feed
        </Link>
        {me.data.role === 'admin' && (
          <Link href="/admin/moderation" className="flex min-h-11 items-center rounded-lg px-3 text-base font-medium text-indigo-700 hover:bg-indigo-50">
            Moderation
          </Link>
        )}
      </nav>
      <main className="mx-auto max-w-2xl p-4">{children(me.data)}</main>
    </div>
  );
}
