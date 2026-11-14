'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ListSkeleton } from '@/components/ui';
import { TopLinks } from '@/components/chat/TopLinks';
import { UrgentBanner } from '@/components/chat/UrgentBanner';

/** Guard (UX only, the API enforces roles) + simple top links for the teacher and student areas. */
export function RoleShell({ role, links, children }: { role: 'teacher' | 'student'; links: { href: string; label: string }[]; children: ReactNode }) {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: { role: string } }>('/auth/me'),
    retry: false,
  });
  const pathname = usePathname();
  /** The exam page has no navigation (05 §8): nothing to tap away to by accident. */
  const bare = pathname.startsWith('/student/take/');
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
      {!bare && <UrgentBanner />}
      {!bare && (
        <nav aria-label={role} className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-2 pt-3 sm:gap-2 sm:px-4">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-base font-medium text-indigo-700 hover:bg-indigo-50 sm:px-4">
              {l.label}
            </Link>
          ))}
          <TopLinks />
        </nav>
      )}
      <main className={bare ? 'mx-auto max-w-3xl' : 'mx-auto max-w-3xl p-4'}>{children}</main>
    </div>
  );
}
