'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { Badge, Card, EmptyState, ErrorState, ListSkeleton, PageTitle } from '@/components/ui';

interface Meeting {
  id: string; startTime: string; endTime: string; status: string; done: boolean;
  period: { name: string } | null; offerings: { id: string; section: string; course: { code: string; name: string } }[];
}

export default function TeacherAttendance() {
  const q = useQuery({ queryKey: ['att-today'], queryFn: () => api<{ meetings: Meeting[] }>('/attendance/today') });
  return (
    <>
      <PageTitle>Today&apos;s classes</PageTitle>
      {q.isPending && <ListSkeleton />}
      {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && q.data.meetings.length === 0 && <EmptyState title="No classes today" />}
      <div className="flex flex-col gap-3">
        {q.data?.meetings.map((m) => (
          <Link key={m.id} href={`/teacher/attendance/${m.id}`}>
            <Card className="flex min-h-11 items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{m.offerings.map((o) => o.course.code).join(' + ')}</p>
                <p className="text-base text-slate-600">
                  {m.startTime}–{m.endTime} · {m.offerings.map((o) => o.section).join(', ')}
                </p>
              </div>
              <Badge tone={m.done ? 'green' : 'amber'}>{m.done ? 'Done' : 'Pending'}</Badge>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
