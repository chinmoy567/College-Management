'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { HOME, type MeUser, type Role } from '@/lib/auth';
import { TABS, isActive, moreFor } from '@/lib/nav';
import { useSocketEvent } from '@/lib/socket';
import { Button, ListSkeleton, Sheet, cn } from '@/components/ui';
import { Icon } from '@/components/Icon';
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
    <Link href="/notifications" aria-label={n ? `Notifications, ${n} unread` : 'Notifications'} className="relative flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-mist/50">
      <Icon name="bell" className="h-6 w-6" />
      {n > 0 && (
        <span data-testid="bell-count" className="absolute right-0 top-0 min-w-5 rounded-full bg-rust px-1 text-center text-xs font-bold text-white">
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
  const mustChange = !!user?.mustChangePassword;
  const wrongRole = !!user && !!role && user.role !== role;
  useEffect(() => setMore(false), [path]);
  useEffect(() => {
    if (me.isError) window.location.assign(role === 'admin' ? '/login?role=admin' : '/login');
    else if (mustChange) window.location.assign('/admin/setup');
    else if (user?.firstLogin && user.role !== 'admin') window.location.assign('/complete-profile');
    else if (wrongRole) window.location.assign(HOME[user!.role]);
  }, [me.isError, mustChange, wrongRole, user, role]);

  if (!user || mustChange || wrongRole)
    return (
      <main className="mx-auto max-w-3xl p-4">
        <ListSkeleton />
      </main>
    );

  /** The exam page has no navigation or motion (05 §8, FE-08). */
  if (path.startsWith('/student/take/')) return <main className="mx-auto max-w-3xl">{typeof children === 'function' ? children(user) : children}</main>;

  const r = user.role;
  const tabs = TABS[r];
  const menu = moreFor(r, !!user.isMentorOf);
  const root = HOME[r];
  const body = typeof children === 'function' ? children(user) : children;
  const tabClass = (on: boolean) =>
    cn('relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-1 text-[11px] font-semibold transition-colors lg:min-h-11 lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:rounded-xl lg:px-4 lg:text-base', on ? 'bg-deep text-white lg:bg-white/10' : 'text-mist/60 lg:hover:bg-white/5 lg:hover:text-white');

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-64 lg:flex-col lg:gap-1 lg:overflow-y-auto lg:bg-ink lg:p-5">
        <Link href={root} className="font-display mb-6 flex min-h-11 items-center gap-2 text-2xl font-medium text-white"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-rust" />College</Link>
        <nav aria-label={`${r} sidebar`} className="flex flex-col gap-1">
          {[...tabs, ...menu].map((t) => (
            <Link key={t.href} href={t.href} aria-current={isActive(path, t.href, root) ? 'page' : undefined} className={tabClass(isActive(path, t.href, root))}>
              <Icon name={t.icon} className="h-5 w-5" />
              {t.label}
            </Link>
          ))}
        </nav>
      </aside>

      <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between border-b border-slate-200/70 bg-paper/85 px-3 backdrop-blur-md">
        <Link href={root} className="font-display flex min-h-11 min-w-11 items-center gap-2 text-xl font-medium text-ink lg:hidden"><span aria-hidden className="h-2 w-2 rounded-full bg-rust" />College</Link>
        <span className="hidden lg:block" />
        <div className="flex items-center gap-1">
          <Bell />
          <Link href="/profile" aria-label="My profile" className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-base font-semibold text-mist">
            {user.name.trim().charAt(0).toUpperCase() || '?'}
          </Link>
        </div>
      </header>

      <UrgentBanner />
      <main className="mx-auto max-w-4xl p-4 pb-28 lg:p-8">{body}</main>

      {r === 'student' && !path.startsWith('/student/ai') && !path.startsWith('/messages/') && (
        <Link href="/student/ai" aria-label="AI study helper" className="fixed bottom-24 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-rust text-lg font-bold text-white shadow-[0_12px_30px_-8px_rgba(150,71,52,0.7)] transition-transform hover:scale-105 lg:bottom-6">
          AI
        </Link>
      )}

      <nav aria-label={`${r} tabs`} className="fixed inset-x-3 bottom-3 z-40 flex gap-0.5 rounded-full bg-ink p-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] shadow-[0_18px_40px_-12px_rgba(0,49,53,0.7)] lg:hidden">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={isActive(path, t.href, root) ? 'page' : undefined} className={tabClass(isActive(path, t.href, root))}>
            <Icon name={t.icon} className="h-5 w-5" />
            {t.label}
          </Link>
        ))}
        <button type="button" aria-haspopup="dialog" onClick={() => setMore(true)} className={tabClass(false)}>
          <Icon name="menu" className="h-5 w-5" />
          More
        </button>
      </nav>

      <Sheet open={more} title="More" onClose={() => setMore(false)}>
        <ul className="flex flex-col">
          {menu.map((m) => (
            <li key={m.href}>
              <Link href={m.href} className="flex min-h-12 items-center gap-3 rounded-xl px-2 text-lg text-ink hover:bg-mist/40">
                <Icon name={m.icon} className="h-5 w-5 text-teal" />
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
