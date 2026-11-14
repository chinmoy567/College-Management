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
      <div className="flex flex-col gap-3">
        {q.data?.items.map((o) => (
          <Link key={o.id} href={`/teacher/exams/offerings/${o.id}`} data-testid={`offering-${o.course.code}`}>
            <Card className="flex min-h-11 items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold">{o.course.code}</p>
                <p className="truncate text-base text-slate-600">{o.course.name} · {o.section}</p>
              </div>
              {!o.teaches && <Badge>Mentor</Badge>}
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
