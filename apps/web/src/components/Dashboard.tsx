'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { Badge, Card, EmptyState, ErrorState, ListSkeleton } from '@/components/ui';

interface Today {
  holiday: { title: string } | null;
  meetings: { id: string; startTime: string; endTime: string; status: string; extra: boolean; current: boolean; next: boolean; offerings: { course: { code: string } }[] }[];
}

export const Section = ({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) => (
  <section aria-label={title} className="mb-6">
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-xl font-semibold">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

export function Tiles({ items }: { items: { href: string; label: string; hint?: string; icon: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((t) => (
        <Link key={t.href} href={t.href} className="min-h-11">
          <Card className="flex h-full flex-col gap-1 hover:bg-slate-50">
            <span aria-hidden className="text-2xl">{t.icon}</span>
            <p className="text-lg font-semibold">{t.label}</p>
            {t.hint && <p className="text-base text-slate-600">{t.hint}</p>}
          </Card>
        </Link>
      ))}
    </div>
  );
}

/** Today's classes for a Student or Teacher (spec 04 /schedule/me/today). */
export function TodayWidget({ href }: { href: string }) {
  const q = useQuery({ queryKey: ['sch-today'], queryFn: () => api<Today>('/schedule/me/today') });
  return (
    <Section title="Today" action={<Link href={href} className="flex min-h-11 items-center text-base text-indigo-700">Full routine</Link>}>
      {q.isPending && <ListSkeleton rows={2} />}
      {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />}
      {q.data?.holiday && <Card className="mb-3 border-amber-300 bg-amber-50"><p className="text-lg font-semibold">Holiday: {q.data.holiday.title}</p></Card>}
      {q.data && !q.data.meetings.length && !q.data.holiday && <EmptyState title="No classes today" />}
      <div className="flex flex-col gap-3">
        {q.data?.meetings.map((m) => (
          <Card key={m.id} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">{m.offerings.map((o) => o.course.code).join(' + ')}</p>
              <p className="text-base text-slate-600">{m.startTime}–{m.endTime}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {m.extra && <Badge tone="amber">Extra class</Badge>}
              {m.status === 'cancelled' && <Badge tone="red">Cancelled</Badge>}
              {m.current && <Badge tone="green">Now</Badge>}
              {m.next && <Badge>Next</Badge>}
            </div>
          </Card>
        ))}
      </div>
    </Section>
  );
}
