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
      <Link href={user.firstLogin ? '/complete-profile' : user.mustChangePassword ? '/admin/setup' : HOME[user.role]} className="flex min-h-12 items-center justify-center rounded-full bg-rust px-7 text-lg font-semibold text-white transition-transform hover:scale-[1.03]">
        Open my dashboard
      </Link>
    );
  return <div className="flex flex-col divide-y divide-white/15 border-y border-white/15">{children}</div>;
}
