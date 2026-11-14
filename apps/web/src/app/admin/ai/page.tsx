'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { Card, EmptyState, ErrorState, ListSkeleton, PageTitle } from '@/components/ui';

interface Usage { from: string; to: string; days: { date: string; count: number }[]; sections: { sectionId: string; label: string; count: number }[] }

/** Counts only: the Admin never sees what students asked (09 section 2.8). */
export default function AdminAi() {
  const q = useQuery({ queryKey: ['ai-admin-usage'], queryFn: () => api<Usage>('/admin/ai/usage') });
  return (
    <>
      <PageTitle>AI usage</PageTitle>
      {q.isPending && <ListSkeleton />}
      {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && (
        <div className="flex flex-col gap-4">
          <p className="text-base text-slate-600">{q.data.from} to {q.data.to}. Message counts only; chats are private to students.</p>
          <section className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">Per day</h2>
            {q.data.days.length === 0 && <EmptyState title="No AI messages in this period" />}
            {[...q.data.days].reverse().map((d) => (
              <Card key={d.date} className="flex items-center justify-between"><span className="text-base">{d.date}</span><span className="text-lg font-semibold">{d.count}</span></Card>
            ))}
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">Per section</h2>
            {q.data.sections.map((s) => (
              <Card key={s.sectionId} className="flex items-center justify-between"><span className="text-base">{s.label}</span><span className="text-lg font-semibold">{s.count}</span></Card>
            ))}
          </section>
        </div>
      )}
    </>
  );
}
