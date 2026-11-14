'use client';

import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ListSkeleton } from '@/components/ui';

/** Guard (UX only, the API enforces roles) + simple top links for the teacher and student areas. */
export function RoleShell({ role, links, children }: { role: 'teacher' | 'student'; links: { href: string; label: string }[]; children: ReactNode }) {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: { role: string } }>('/auth/me'),
    retry: false,
  });
  const allowed = me.data?.user.role === role;
  useEffect(() => {
    if (me.isError || (me.data && !allowed)) window.location.assign('/login');
  }, [me.isError, me.data, allowed]);
  if (!allowed)
    return (
      <main className="mx-auto max-w-3xl p-4">
        <ListSkeleton />
      </main>
    );
  return (
    <div className="min-h-screen">
      <nav aria-label={role} className="mx-auto flex max-w-3xl gap-2 px-4 pt-3">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="flex min-h-11 items-center rounded-lg px-4 text-base font-medium text-indigo-700 hover:bg-indigo-50">
            {l.label}
          </Link>
        ))}
      </nav>
      <main className="mx-auto max-w-3xl p-4">{children}</main>
    </div>
  );
}
