'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import type { OfferingLite } from '@/lib/exams';
import { Badge, Card, EmptyState, ErrorState, ListSkeleton, PageTitle } from '@/components/ui';

/** Courses the teacher teaches (or whose section they mentor): the entry to exams, quizzes and progress. */
export default function TeacherExams() {
  const q = useQuery({ queryKey: ['exam-offerings'], queryFn: () => api<{ items: OfferingLite[] }>('/exams/offerings') });
  return (
    <>
      <PageTitle>Exams</PageTitle>
      {q.isPending && <ListSkeleton />}
      {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && q.data.items.length === 0 && <EmptyState title="No courses yet" hint="Courses appear here once the Admin assigns you to them." />}
      {(() => {
        const items = q.data?.items ?? [];
        const teach = items.filter((o) => o.teaches);
        const mentor = items.filter((o) => !o.teaches);
        const row = (o: OfferingLite) => (
          <Link key={o.id} href={`/teacher/exams/offerings/${o.id}`} data-testid={`offering-${o.course.code}`}>
            <Card className="flex min-h-11 items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold">{o.course.code}</p>
                <p className="truncate text-base text-slate-600">{o.course.name} · {o.section}</p>
              </div>
              <Badge>{o.teaches ? 'You teach' : 'Mentor'}</Badge>
            </Card>
          </Link>
        );
        return (
          <>
            {teach.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-1 text-xl font-semibold">Courses you teach</h2>
                <p className="mb-3 text-base text-slate-600">You can create exams and quizzes for these.</p>
                <div className="flex flex-col gap-3">{teach.map(row)}</div>
              </section>
            )}
            {mentor.length > 0 && (
              <section>
                <h2 className="mb-1 text-xl font-semibold">Your mentored section</h2>
                <p className="mb-3 text-base text-slate-600">Another teacher teaches these. You can only see their exams and results.</p>
                <div className="flex flex-col gap-3">{mentor.map(row)}</div>
              </section>
            )}
          </>
        );
      })()}
    </>
  );
}
