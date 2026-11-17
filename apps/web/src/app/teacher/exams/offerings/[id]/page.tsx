'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { OfferingLabel } from '@/components/OfferingLabel';
import { examStatusTone, fmtDateTime, type ExamRow, type OfferingLite } from '@/lib/exams';
import { Badge, Button, Card, EmptyState, ErrorState, ListSkeleton, PageTitle } from '@/components/ui';

export default function OfferingExams() {
  const { id } = useParams<{ id: string }>();
  const offerings = useQuery({ queryKey: ['exam-offerings'], queryFn: () => api<{ items: OfferingLite[] }>('/exams/offerings') });
  const offering = offerings.data?.items.find((o) => o.id === id);
  const q = useInfiniteQuery({
    queryKey: ['offering-exams', id],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<{ items: ExamRow[]; nextCursor: string | null }>(`/exams?offeringId=${id}&limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageTitle>{offering ? `${offering.course.code} exams` : 'Exams'}</PageTitle>
      <OfferingLabel of={offering} className="-mt-2" />
      <div className="mb-4 grid grid-cols-2 gap-2">
        {offering?.teaches && (
          <Link href={`/teacher/exams/offerings/${id}/new`} className="flex min-h-11 items-center justify-center rounded-lg bg-indigo-600 px-4 text-base font-medium text-white" data-testid="new-exam">New exam</Link>
        )}
        <Link href={`/teacher/exams/offerings/${id}/progress`} className="flex min-h-11 items-center justify-center rounded-lg bg-slate-100 px-4 text-base font-medium">Student progress</Link>
      </div>
      {q.isPending && <ListSkeleton />}
      {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && items.length === 0 && <EmptyState title="No exams yet" hint={offering?.teaches ? 'Create the first exam or quiz for this course.' : undefined} />}
      <div className="flex flex-col gap-3">
        {items.map((e) => (
          <Link key={e.id} href={`/teacher/exams/${e.id}`}>
            <Card className="flex flex-col gap-1" data-testid={`exam-row-${e.id}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-lg font-semibold">{e.title}</p>
                <Badge tone={examStatusTone(e.status)}>{e.status === 'draft' ? 'Draft' : e.status === 'published' ? 'Published' : 'Closed'}</Badge>
              </div>
              <p className="text-base text-slate-600">{e.kind === 'quiz' ? 'Quiz' : 'Exam'} · {e.totalMarks} marks · {e.durationMin} min</p>
              <p className="text-base text-slate-600">{fmtDateTime(e.startAt)} – {fmtDateTime(e.endAt)}</p>
            </Card>
          </Link>
        ))}
      </div>
      {q.hasNextPage && <Button variant="secondary" className="mt-4 w-full" onClick={() => void q.fetchNextPage()}>Load more</Button>}
    </>
  );
}
