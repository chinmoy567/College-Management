'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { Button, Card, EmptyState, ErrorState, ListSkeleton, PageTitle, cn } from '@/components/ui';
import { monthCells, monthLabel, shiftMonth, todayYm } from '@/lib/calendar';

type Colour = 'green' | 'orange' | 'red' | 'none';
const pctTone: Record<Colour, string> = { green: 'text-emerald-700', orange: 'text-amber-700', red: 'text-red-700', none: 'text-slate-600' };
const dayTone: Record<string, string> = { present: 'bg-emerald-100 text-emerald-900', partial: 'bg-amber-100 text-amber-900', absent: 'bg-red-100 text-red-900' };
interface Summary { threshold: number; overall: { display: string; colour: Colour; held: number }; courses: { offeringId: string; code: string; name: string; display: string; colour: Colour; held: number }[] }
interface Cal { days: { date: string; colour: 'present' | 'partial' | 'absent'; periods: { period: string | null; course: string; status: string }[] }[] }

export default function StudentAttendance() {
  const [month, setMonth] = useState(todayYm());
  const [open, setOpen] = useState<string | null>(null);
  const sum = useQuery({ queryKey: ['att-me'], queryFn: () => api<Summary>('/attendance/me') });
  const cal = useQuery({ queryKey: ['att-cal', month], queryFn: () => api<Cal>(`/attendance/me/calendar?month=${month}`) });
  const byDate = new Map(cal.data?.days.map((d) => [d.date, d]));
  const day = open ? byDate.get(open) : undefined;
  return (
    <>
      <PageTitle>My attendance</PageTitle>
      {sum.isPending && <ListSkeleton rows={2} />}
      {sum.isError && <ErrorState message={errMsg(sum.error)} onRetry={() => void sum.refetch()} />}
      {sum.data && (
        <div className="flex flex-col gap-3">
          <Card data-testid="overall" className="text-center">
            <p className="text-base text-slate-600">Overall</p>
            <p data-testid="overall-pct" data-colour={sum.data.overall.colour} className={cn('text-4xl font-bold', pctTone[sum.data.overall.colour])}>
              {sum.data.overall.display}
            </p>
            <p className="text-base text-slate-600">Below {sum.data.threshold}% is a warning</p>
          </Card>
          {sum.data.courses.length === 0 && <EmptyState title="No courses yet" />}
          {sum.data.courses.map((c) => (
            <Card key={c.offeringId} data-testid={`course-${c.code}`} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold">{c.code}</p>
                <p className="truncate text-base text-slate-600">{c.name} · {c.held} classes</p>
              </div>
              <p data-testid="course-pct" data-colour={c.colour} className={cn('text-2xl font-bold', pctTone[c.colour])}>{c.display}</p>
            </Card>
          ))}
        </div>
      )}

      <section aria-label="Calendar" className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <Button variant="secondary" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>Prev</Button>
          <h2 className="text-lg font-semibold">{monthLabel(month)}</h2>
          <Button variant="secondary" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>Next</Button>
        </div>
        {cal.isError && <ErrorState message={errMsg(cal.error)} onRetry={() => void cal.refetch()} />}
        <div className="grid grid-cols-7 gap-1 text-center text-sm text-slate-500">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {monthCells(month).map((c, i) =>
            c ? (
              <button
                key={c.date}
                type="button"
                data-testid={`day-${c.date}`}
                data-colour={byDate.get(c.date)?.colour ?? 'none'}
                aria-label={`${c.date}${byDate.get(c.date) ? `, ${byDate.get(c.date)!.colour}` : ''}`}
                onClick={() => byDate.has(c.date) && setOpen(c.date)}
                className={cn('min-h-11 rounded-lg text-base', dayTone[byDate.get(c.date)?.colour ?? ''] ?? 'bg-slate-50 text-slate-700')}
              >
                {c.day}
              </button>
            ) : (
              <span key={i} />
            ),
          )}
        </div>
        {day && (
          <Card data-testid="day-detail" className="mt-3">
            <p className="mb-2 text-lg font-semibold">{day.date}</p>
            <ul className="flex flex-col gap-1">
              {day.periods.map((p, i) => (
                <li key={i} className="flex justify-between text-base">
                  <span>{p.period ?? 'Extra class'} · {p.course}</span>
                  <span className="font-medium capitalize">{p.status}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </>
  );
}
