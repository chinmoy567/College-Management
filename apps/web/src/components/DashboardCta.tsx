'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { HOME, type MeUser } from '@/lib/auth';

/** Landing hero buttons: the three role logins, or "Open my dashboard" when already signed in (PRD §5.1). */
export function DashboardCta({ children }: { children: ReactNode }) {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ user: MeUser }>('/auth/me'), retry: false });
  const user = me.data?.user;
  if (user)
    return (
      <Link href={user.firstLogin ? '/complete-profile' : user.mustChangePassword ? '/admin/setup' : HOME[user.role]} className="flex min-h-12 items-center justify-center rounded-xl bg-white px-4 text-lg font-semibold text-indigo-700">
        Open my dashboard
      </Link>
    );
  return <div className="flex flex-col gap-3">{children}</div>;
}
