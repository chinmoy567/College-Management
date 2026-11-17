'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { countdownText, fmtDateTime, offeringLabel, useServerOffset, useTick } from '@/lib/exams';
import { Badge, Button, Card, EmptyState, ErrorState, ListSkeleton, PageTitle, cn } from '@/components/ui';

interface Item {
  id: string; course: { id: string; code: string; name: string }; session: string; group: string; section: string; classLevel: number; kind: 'exam' | 'quiz'; title: string; startAt: string; endAt: string; durationMin: number;
  totalMarks: number; phase: 'upcoming' | 'live' | 'completed'; attemptsUsed: number; maxAttempts: number; inProgressAttempt: { id: string; deadlineAt: string } | null;
}
interface Page { serverNow: string; nextCursor: string | null; items: Item[] }
const TABS = [['', 'All'], ['live', 'Live'], ['upcoming', 'Upcoming'], ['completed', 'Done']] as const;

export default function StudentExams() {
  const [tab, setTab] = useState<string>('');
  const q = useInfiniteQuery({
    queryKey: ['my-exams', tab],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<Page>(`/exams/me?limit=20${tab ? `&status=${tab}` : ''}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 60_000,
  });
  const serverNow = q.data?.pages[0]?.serverNow;
  const offset = useServerOffset(serverNow);
  const tick = useTick();
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageTitle>Exams</PageTitle>
      <div role="tablist" aria-label="Filter" className="mb-4 grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">
        {TABS.map(([v, label]) => (
          <button key={v} role="tab" aria-selected={tab === v} type="button" onClick={() => setTab(v)} className={cn('min-h-11 rounded-lg text-base font-medium', tab === v ? 'bg-white shadow-sm' : 'text-slate-600')}>
            {label}
          </button>
        ))}
      </div>
      {q.isPending && <ListSkeleton />}
      {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && items.length === 0 && <EmptyState title="No exams here" hint="Exams and quizzes of your courses appear when your teacher publishes them." />}
      <div className="flex flex-col gap-3">
        {items.map((e) => {
          const nowMs = tick + offset;
          const toStart = new Date(e.startAt).getTime() - nowMs;
          const toEnd = new Date(e.endAt).getTime() - nowMs;
          const left = e.maxAttempts === 0 ? null : Math.max(0, e.maxAttempts - e.attemptsUsed);
          return (
            <Link key={e.id} href={`/student/exams/${e.id}`} data-testid={`exam-${e.id}`}>
              <Card className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold">{e.title}</p>
                    <p className="truncate text-base text-slate-600" data-testid="offering-label">{offeringLabel(e)}</p>
                    <p className="truncate text-base text-slate-600">{e.course.code} · {e.kind === 'quiz' ? 'Quiz' : 'Exam'} · {e.totalMarks} marks · {e.durationMin} min</p>
                  </div>
                  <Badge tone={e.phase === 'live' ? 'green' : e.phase === 'upcoming' ? 'amber' : 'slate'}>{e.phase === 'live' ? 'Live' : e.phase === 'upcoming' ? 'Upcoming' : 'Done'}</Badge>
                </div>
                <p className="text-base text-slate-600">{fmtDateTime(e.startAt)} – {fmtDateTime(e.endAt)}</p>
                {e.phase === 'upcoming' && <p data-testid="countdown" className="text-base font-medium text-amber-800">Starts in {countdownText(toStart)}</p>}
                {e.phase === 'live' && (
                  <p data-testid="countdown" className="text-base font-medium text-emerald-800">
                    {e.inProgressAttempt ? 'In progress. Tap to resume' : `Closes in ${countdownText(toEnd)}`}
                    {left !== null && !e.inProgressAttempt ? ` · ${left} attempt${left === 1 ? '' : 's'} left` : ''}
                  </p>
                )}
              </Card>
            </Link>
          );
        })}
      </div>
      {q.hasNextPage && (
        <Button variant="secondary" className="mt-4 w-full" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </>
  );
}
