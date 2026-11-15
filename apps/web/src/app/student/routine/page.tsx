'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { Badge, Card, EmptyState, ErrorState, ListSkeleton, PageTitle } from '@/components/ui';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
interface Today {
  date: string; holiday: { id: string; title: string } | null;
  meetings: { id: string; startTime: string; endTime: string; status: string; extra: boolean; current: boolean; next: boolean; period: { name: string } | null; room: { name: string } | null; offerings: { course: { code: string; name: string } }[] }[];
}
interface Week {
  routineFiles?: { id: string; mime: string; name: string | null; url: string | null }[];
  slots: { id: string; day: string; period: { name: string; startTime: string; endTime: string }; room: { name: string } | null; offerings: { course: { code: string; name: string }; teacher: { name: string } }[] }[];
}

export default function StudentRoutine() {
  const today = useQuery({ queryKey: ['sch-today'], queryFn: () => api<Today>('/schedule/me/today') });
  const week = useQuery({ queryKey: ['sch-week'], queryFn: () => api<Week>('/schedule/me/week') });
  return (
    <>
      <PageTitle>Routine</PageTitle>
      <section aria-label="Today" className="mb-6">
        <h2 className="mb-2 text-xl font-semibold">Today</h2>
        {today.isPending && <ListSkeleton rows={2} />}
        {today.isError && <ErrorState message={errMsg(today.error)} onRetry={() => void today.refetch()} />}
        {today.data?.holiday && (
          <Card data-testid="today-holiday" className="mb-3 border-amber-300 bg-amber-50">
            <p className="text-lg font-semibold">Holiday: {today.data.holiday.title}</p>
          </Card>
        )}
        {today.data && today.data.meetings.length === 0 && !today.data.holiday && <EmptyState title="No classes today" />}
        <div className="flex flex-col gap-3">
          {today.data?.meetings.map((m) => (
            <Card key={m.id} data-testid="today-class" className="flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{m.offerings.map((o) => o.course.code).join(' + ')}</p>
                <p className="text-base text-slate-600">
                  {m.startTime}–{m.endTime}
                  {m.period ? ` · ${m.period.name}` : ''}
                  {m.room ? ` · ${m.room.name}` : ''}
                </p>
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
      </section>

      <section aria-label="Week">
        <h2 className="mb-2 text-xl font-semibold">This week</h2>
        {week.data?.routineFiles?.filter((f) => f.url).map((f) => (
          <Card key={f.id} data-testid="routine-file" className="mb-3">
            <p className="mb-2 text-base font-medium">Class routine from the college</p>
            {f.mime.startsWith('image/') ? (
              <a href={f.url!} target="_blank" rel="noreferrer"><img src={f.url!} alt="Class routine" className="w-full rounded-lg" /></a>
            ) : (
              <a href={f.url!} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline">Open routine PDF{f.name ? ` (${f.name})` : ''}</a>
            )}
          </Card>
        ))}
        {week.isPending && <ListSkeleton rows={2} />}
        {week.isError && <ErrorState message={errMsg(week.error)} onRetry={() => void week.refetch()} />}
        {week.data && week.data.slots.length === 0 && <EmptyState title="No routine yet" />}
        {DAYS.map((d) => {
          const slots = week.data?.slots.filter((s) => s.day === d) ?? [];
          if (!slots.length) return null;
          return (
            <div key={d} className="mb-3">
              <h3 className="mb-1 text-lg font-semibold capitalize">{d}</h3>
              <div className="flex flex-col gap-2">
                {slots.map((s) => (
                  <Card key={s.id}>
                    <p className="text-base font-medium">{s.offerings.map((o) => `${o.course.code} · ${o.teacher.name}`).join(', ')}</p>
                    <p className="text-base text-slate-600">
                      {s.period.startTime}–{s.period.endTime} · {s.period.name}
                      {s.room ? ` · ${s.room.name}` : ''}
                    </p>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}
