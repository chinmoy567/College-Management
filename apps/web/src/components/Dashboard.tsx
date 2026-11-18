'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { Badge, Card, EmptyState, ErrorState, ListSkeleton } from '@/components/ui';
import { Icon } from '@/components/Icon';

interface Today {
  holiday: { title: string } | null;
  meetings: { id: string; startTime: string; endTime: string; status: string; extra: boolean; current: boolean; next: boolean; offerings: { course: { code: string } }[] }[];
}

export const Section = ({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) => (
  <section aria-label={title} className="mb-10">
    <div className="mb-4 flex items-end justify-between gap-2 border-b border-ink/15 pb-2">
      <h2 className="text-2xl font-medium text-ink">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

/** Greeting band at the top of each dashboard. The h1 keeps the old "Hello, Name" text. */
export function DashHero({ title, sub }: { title: string; sub?: string }) {
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <header className="relative mb-10 overflow-hidden rounded-3xl bg-ink px-6 py-8 text-white sm:px-9 sm:py-10">
      <div aria-hidden className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-teal/30 blur-2xl" />
      <div aria-hidden className="absolute -bottom-16 right-10 h-40 w-40 rounded-full border border-mist/25" />
      <p className="relative text-xs font-bold uppercase tracking-[0.22em] text-mist">{date}</p>
      <h1 className="relative mt-2 text-4xl font-light leading-tight sm:text-5xl">{title}</h1>
      {sub && <p className="relative mt-2 text-mist/80">{sub}</p>}
    </header>
  );
}

export function Tiles({ items }: { items: { href: string; label: string; hint?: string; icon: string }[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((t, i) => (
        <li key={t.href} className={i === 0 ? 'sm:col-span-2' : ''}>
          <Link
            href={t.href}
            className={`group flex min-h-16 items-center gap-4 rounded-2xl p-4 transition-all duration-200 hover:-translate-y-0.5 ${
              i === 0 ? 'bg-rust text-white hover:bg-rust-dark' : 'border border-slate-200 bg-white hover:border-teal hover:shadow-[0_12px_28px_-18px_rgba(0,49,53,0.5)]'
            }`}
          >
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${i === 0 ? 'bg-white/15' : 'bg-mist/50 text-deep'}`}>
              <Icon name={t.icon} className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-display block text-xl font-medium">{t.label}</span>
              {t.hint && <span className={`block text-sm ${i === 0 ? 'text-white/80' : 'text-slate-600'}`}>{t.hint}</span>}
            </span>
            <span aria-hidden className="text-xl transition-transform group-hover:translate-x-1">→</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Today's classes for a Student or Teacher (spec 04 /schedule/me/today). */
export function TodayWidget({ href }: { href: string }) {
  const q = useQuery({ queryKey: ['sch-today'], queryFn: () => api<Today>('/schedule/me/today') });
  return (
    <Section title="Today" action={<Link href={href} className="flex min-h-11 items-center text-sm font-semibold uppercase tracking-widest text-rust">Full routine</Link>}>
      {q.isPending && <ListSkeleton rows={2} />}
      {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />}
      {q.data?.holiday && <Card className="mb-3 border-amber-300 bg-amber-50"><p className="text-lg font-semibold">Holiday: {q.data.holiday.title}</p></Card>}
      {q.data && !q.data.meetings.length && !q.data.holiday && <EmptyState title="No classes today" />}
      <ol className="relative ml-2 flex flex-col gap-3 border-l border-ink/20 pl-6">
        {q.data?.meetings.map((m) => (
          <li key={m.id} className="relative">
          <span aria-hidden className={`absolute -left-[1.95rem] top-6 h-3 w-3 rounded-full ring-4 ring-paper ${m.current ? 'bg-rust' : 'bg-teal'}`} />
          <Card className={`flex items-center justify-between gap-3 ${m.current ? 'border-rust' : ''}`}>
            <div>
              <p className="font-display text-2xl font-medium text-ink">{m.offerings.map((o) => o.course.code).join(' + ')}</p>
              <p className="text-sm font-semibold tracking-wide text-slate-600">{m.startTime}–{m.endTime}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {m.extra && <Badge tone="amber">Extra class</Badge>}
              {m.status === 'cancelled' && <Badge tone="red">Cancelled</Badge>}
              {m.current && <Badge tone="green">Now</Badge>}
              {m.next && <Badge>Next</Badge>}
            </div>
          </Card>
          </li>
        ))}
      </ol>
    </Section>
  );
}
