'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { HOME, type MeUser, type Role } from '@/lib/auth';
import { MORE, TABS, isActive } from '@/lib/nav';
import { useSocketEvent } from '@/lib/socket';
import { Button, ListSkeleton, Sheet, cn } from '@/components/ui';
import { UrgentBanner } from '@/components/chat/UrgentBanner';

export const useMeUser = () =>
  useQuery({ queryKey: ['me'], queryFn: () => api<{ user: MeUser }>('/auth/me'), retry: false });

function Bell() {
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
    <Link href="/notifications" aria-label={n ? `Notifications, ${n} unread` : 'Notifications'} className="relative flex h-11 w-11 items-center justify-center rounded-full text-xl hover:bg-slate-100">
      <span aria-hidden>🔔</span>
      {n > 0 && (
        <span data-testid="bell-count" className="absolute right-0 top-0 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs font-semibold text-white">
          {n > 99 ? '99+' : n}
        </span>
      )}
    </Link>
  );
}

/**
 * One shell for all three roles (spec 10 §3): bottom tab bar on phones, left sidebar from `lg`, top bar with
 * the bell and the avatar. The guard is UX only; the API enforces roles. `role` pins a role area, omitted for shared pages.
 */
export function AppShell({ role, children }: { role?: Role; children: ReactNode | ((me: MeUser) => ReactNode) }) {
  const me = useMeUser();
  const path = usePathname();
  const [more, setMore] = useState(false);
  const user = me.data?.user;
  const stepUp = !!user?.stepUpPending;
  const wrongRole = !!user && !!role && user.role !== role;
  useEffect(() => setMore(false), [path]);
  useEffect(() => {
    if (me.isError || stepUp) window.location.assign(role === 'admin' || user?.role === 'admin' ? '/login?role=admin' : '/login');
    else if (user?.firstLogin && user.role !== 'admin') window.location.assign('/complete-profile');
    else if (wrongRole) window.location.assign(HOME[user!.role]);
  }, [me.isError, stepUp, wrongRole, user, role]);

  if (!user || stepUp || wrongRole)
    return (
      <main className="mx-auto max-w-3xl p-4">
        <ListSkeleton />
      </main>
    );

  /** The exam page has no navigation or motion (05 §8, FE-08). */
  if (path.startsWith('/student/take/')) return <main className="mx-auto max-w-3xl">{typeof children === 'function' ? children(user) : children}</main>;

  const r = user.role;
  const tabs = TABS[r];
  const root = HOME[r];
  const body = typeof children === 'function' ? children(user) : children;
  const tabClass = (on: boolean) =>
    cn('flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium lg:min-h-11 lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:rounded-lg lg:px-4 lg:text-base', on ? 'text-indigo-700 lg:bg-indigo-50' : 'text-slate-600 lg:hover:bg-slate-100');

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-64 lg:flex-col lg:gap-1 lg:overflow-y-auto lg:border-r lg:border-slate-200 lg:bg-white lg:p-4">
        <Link href={root} className="mb-3 min-h-11 text-lg font-semibold">College</Link>
        <nav aria-label={`${r} sidebar`} className="flex flex-col gap-1">
          {[...tabs, ...MORE[r]].map((t) => (
            <Link key={t.href} href={t.href} aria-current={isActive(path, t.href, root) ? 'page' : undefined} className={tabClass(isActive(path, t.href, root))}>
              <span aria-hidden>{t.icon}</span>
              {t.label}
            </Link>
          ))}
        </nav>
      </aside>

      <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between border-b border-slate-200 bg-white px-3">
        <Link href={root} className="flex min-h-11 min-w-11 items-center text-lg font-semibold lg:hidden">College</Link>
        <span className="hidden lg:block" />
        <div className="flex items-center gap-1">
          <Bell />
          <Link href="/profile" aria-label="My profile" className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-100 text-base font-semibold text-indigo-700">
            {user.name.trim().charAt(0).toUpperCase() || '?'}
          </Link>
        </div>
      </header>

      <UrgentBanner />
      <main className="mx-auto max-w-3xl p-4 pb-24 lg:pb-6">{body}</main>

      {r === 'student' && !path.startsWith('/student/ai') && (
        <Link href="/student/ai" aria-label="AI study helper" className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-lg font-bold text-white shadow-lg lg:bottom-6">
          AI
        </Link>
      )}

      <nav aria-label={`${r} tabs`} className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={isActive(path, t.href, root) ? 'page' : undefined} className={tabClass(isActive(path, t.href, root))}>
            <span aria-hidden className="text-xl">{t.icon}</span>
            {t.label}
          </Link>
        ))}
        <button type="button" aria-haspopup="dialog" onClick={() => setMore(true)} className={tabClass(false)}>
          <span aria-hidden className="text-xl">☰</span>
          More
        </button>
      </nav>

      <Sheet open={more} title="More" onClose={() => setMore(false)}>
        <ul className="flex flex-col">
          {MORE[r].map((m) => (
            <li key={m.href}>
              <Link href={m.href} className="flex min-h-12 items-center gap-3 rounded-lg px-2 text-lg hover:bg-slate-100">
                <span aria-hidden>{m.icon}</span>
                {m.label}
              </Link>
            </li>
          ))}
        </ul>
        <Logout />
      </Sheet>
    </div>
  );
}

export function Logout({ className }: { className?: string }) {
  return (
    <Button
      variant="secondary"
      className={cn('mt-4 w-full', className)}
      onClick={async () => {
        await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
        window.location.assign('/');
      }}
    >
      Log out
    </Button>
  );
}
