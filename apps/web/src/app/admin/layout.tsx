'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ListSkeleton, cn } from '@/components/ui';

const tabs = [
  { href: '/admin/sessions', label: 'Sessions' },
  { href: '/admin/students', label: 'Students' },
  { href: '/admin/teachers', label: 'Teachers' },
  { href: '/admin/courses', label: 'Courses' },
  { href: '/admin/more', label: 'More' },
];

/** Admin shell: guard (UX only, the API enforces roles) + bottom tab bar on phones, top bar from md. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: { role: string; stepUpPending?: boolean } }>('/auth/me'),
    retry: false,
  });
  const allowed = me.data?.user.role === 'admin' && !me.data.user.stepUpPending;
  useEffect(() => {
    if (me.isError || (me.data && !allowed)) window.location.assign('/login?role=admin');
  }, [me.isError, me.data, allowed]);

  if (!allowed)
    return (
      <main className="mx-auto max-w-3xl p-4">
        <ListSkeleton />
      </main>
    );
  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <nav
        aria-label="Admin"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white md:static md:mx-auto md:flex md:max-w-3xl md:gap-2 md:border-0 md:px-4 md:pt-3"
      >
        {tabs.map((t) => {
          const on = path === t.href || path.startsWith(t.href + '/');
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'flex min-h-14 items-center justify-center px-1 text-center text-sm font-medium md:min-h-11 md:rounded-lg md:px-4 md:text-base',
                on ? 'text-indigo-700 md:bg-indigo-50' : 'text-slate-600',
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <main className="mx-auto max-w-3xl p-4">{children}</main>
    </div>
  );
}
