'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { Badge, Button, EmptyState, ErrorState, ListSkeleton, PageTitle } from '@/components/ui';

interface Meeting {
  id: string; date: string; startTime: string; endTime: string; status: string; attendanceTaken: boolean;
  period: { id: string; name: string } | null; room: { name: string } | null;
  teacher: { id: string; name: string }; substitute: { id: string; name: string } | null;
  offerings: { id: string; section: string; course: { code: string; name: string } }[];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => ymd(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000));
const todayDhaka = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
/** The Sunday on or before a date. */
const weekStart = (s: string) => addDays(s, -new Date(`${s}T00:00:00Z`).getUTCDay());

function Action({ m, today }: { m: Meeting; today: string }) {
  if (m.status === 'cancelled') return <Badge tone="red">Cancelled</Badge>;
  if (m.date > today) return <span className="text-sm text-slate-500">Not yet</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      {!m.attendanceTaken && m.date < today && <Badge tone="amber">Attendance not taken</Badge>}
      <Link
        href={`/teacher/attendance/${m.id}`}
        data-testid="take-attendance"
        className="inline-flex min-h-11 items-center rounded-lg bg-indigo-600 px-3 text-base font-medium text-white"
      >
        {m.attendanceTaken ? 'Edit attendance' : 'Take attendance'}
      </Link>
    </div>
  );
}

export default function TeacherRoutine() {
  const today = todayDhaka();
  const [start, setStart] = useState(() => weekStart(today));
  const end = addDays(start, 4);
  const q = useQuery({
    queryKey: ['teacher-routine', start],
    queryFn: () => api<{ meetings: Meeting[] }>(`/schedule/me/meetings?from=${start}&to=${end}`),
  });
  const meetings = q.data?.meetings ?? [];
  const rows = [...new Map(meetings.map((m) => [`${m.startTime}-${m.endTime}`, m])).values()].sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <>
      <PageTitle>Routine</PageTitle>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button type="button" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">‹ Prev</Button>
        <p data-testid="week-range" className="text-center text-base font-medium">{start} to {end}</p>
        <Button type="button" onClick={() => setStart(addDays(start, 7))} aria-label="Next week">Next ›</Button>
      </div>
      {q.isPending && <ListSkeleton rows={3} />}
      {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && meetings.length === 0 && <EmptyState title="No classes this week" />}
      {meetings.length > 0 && (
        <div data-testid="teacher-grid" className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[44rem] border-collapse text-base">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white p-2 text-left">Time</th>
                {DAYS.map((d, i) => (
                  <th key={d} scope="col" className={`border-b border-slate-200 p-2 text-left ${addDays(start, i) === today ? 'bg-indigo-50' : ''}`}>
                    {d}<br /><span className="text-sm font-normal text-slate-500">{addDays(start, i)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.startTime}-${r.endTime}`}>
                  <th scope="row" className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white p-2 text-left font-medium">
                    {r.period?.name ?? 'Extra'}<br /><span className="text-sm font-normal text-slate-500">{r.startTime}–{r.endTime}</span>
                  </th>
                  {DAYS.map((d, i) => {
                    const date = addDays(start, i);
                    const cell = meetings.filter((m) => m.date === date && m.startTime === r.startTime && m.endTime === r.endTime);
                    return (
                      <td key={d} className="border-b border-slate-200 p-1 align-top">
                        {cell.length === 0 ? (
                          <span aria-label="No class" className="block min-h-11 p-2 text-slate-300">–</span>
                        ) : cell.map((m) => (
                          <div key={m.id} data-testid="teacher-cell" className="mb-1 rounded-lg bg-indigo-50 p-2">
                            <span className="block font-semibold">{m.offerings.map((o) => o.course.code).join(' + ')}</span>
                            <span className="block break-words text-sm text-slate-600">{[...new Set(m.offerings.map((o) => o.section))].join(', ')}</span>
                            {m.room && <span className="block break-words text-sm text-slate-600">{m.room.name}</span>}
                            {m.substitute && <span className="block text-sm text-amber-700">Substitute: {m.substitute.name} (for {m.teacher.name})</span>}
                            <div className="mt-1"><Action m={m} today={today} /></div>
                          </div>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
