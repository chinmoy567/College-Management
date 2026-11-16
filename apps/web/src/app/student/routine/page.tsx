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
interface WeekMeeting {
  id: string; date: string; startTime: string; endTime: string; status: string; extra: boolean;
  routineSlotId: string | null; originalDate: string | null;
  period: { id: string; name: string } | null; room: { name: string } | null;
  teacher: { name: string }; substitute: { name: string } | null;
  offerings: { course: { code: string; name: string } }[];
}
interface Week {
  weekFrom?: string; weekMeetings?: WeekMeeting[];
  routineFiles?: { id: string; mime: string; name: string | null; url: string | null }[];
  slots: { id: string; day: string; period: { id: string; name: string; startTime: string; endTime: string }; room: { name: string } | null; offerings: { course: { code: string; name: string }; teacher: { name: string } }[] }[];
}

const GRID_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu'];
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** One class on one day, after one-off changes (cancelled, moved, extra, substitute) are applied to the weekly slots. */
interface Item {
  key: string; rowId: string; rowName: string; startTime: string; endTime: string;
  courses: string; courseNames: string; teacher: string; room: string | null;
  state: 'normal' | 'cancelled' | 'moved' | 'extra' | 'moved-in'; note: string | null;
}

function itemsFor(week: Week, day: string): Item[] {
  const idx = DAYS.indexOf(day);
  const date = week.weekFrom ? addDays(week.weekFrom, idx) : null;
  const wm = week.weekMeetings ?? [];
  const out: Item[] = [];
  for (const sl of week.slots.filter((x) => x.day === day)) {
    const m = date ? wm.find((x) => x.routineSlotId === sl.id && (x.originalDate ?? x.date) === date) : undefined;
    const base = {
      key: sl.id, rowId: sl.period.id, rowName: sl.period.name, startTime: sl.period.startTime, endTime: sl.period.endTime,
      courses: sl.offerings.map((o) => o.course.code).join(' + '), courseNames: sl.offerings.map((o) => o.course.name).join(', '),
      teacher: [...new Set(sl.offerings.map((o) => o.teacher.name))].join(', '), room: sl.room?.name ?? null,
    };
    if (!m) out.push({ ...base, state: 'normal', note: null });
    else if (m.date !== date) out.push({ ...base, state: 'moved', note: `Moved to ${m.date}` });
    else if (m.status === 'cancelled') out.push({ ...base, state: 'cancelled', note: null });
    else out.push({ ...base, state: 'normal', note: m.substitute ? `Substitute: ${m.substitute.name}` : null, teacher: m.substitute?.name ?? base.teacher, room: m.room?.name ?? base.room });
  }
  if (date) {
    for (const m of wm.filter((x) => x.date === date && (x.routineSlotId === null || (x.originalDate !== null && x.originalDate !== date)))) {
      const moved = m.routineSlotId !== null;
      out.push({
        key: m.id, rowId: m.period?.id ?? `t-${m.startTime}-${m.endTime}`, rowName: m.period?.name ?? 'Extra', startTime: m.startTime, endTime: m.endTime,
        courses: m.offerings.map((o) => o.course.code).join(' + '), courseNames: m.offerings.map((o) => o.course.name).join(', '),
        teacher: (m.substitute ?? m.teacher).name, room: m.room?.name ?? null,
        state: m.status === 'cancelled' ? 'cancelled' : moved ? 'moved-in' : 'extra',
        note: m.status === 'cancelled' ? null : moved ? `Moved from ${m.originalDate}` : 'Extra class',
      });
    }
  }
  return out;
}

function StateBadge({ it }: { it: Item }) {
  if (it.state === 'cancelled') return <Badge tone="red">Cancelled</Badge>;
  if (it.state === 'moved') return <Badge tone="amber">{it.note}</Badge>;
  if (it.note) return <Badge tone={it.state === 'normal' ? 'amber' : 'green'}>{it.note}</Badge>;
  return null;
}

function FullWeekTable({ week }: { week: Week }) {
  const byDay = new Map(GRID_DAYS.map((d) => [d, itemsFor(week, d)]));
  const periods = [...new Map([...byDay.values()].flat().map((i) => [i.rowId, { id: i.rowId, name: i.rowName, startTime: i.startTime, endTime: i.endTime }])).values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
  return (
    <div data-testid="week-grid" className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[40rem] border-collapse text-base">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 min-h-11 border-b border-r border-slate-200 bg-white p-2 text-left">Period</th>
            {GRID_DAYS.map((d) => <th key={d} scope="col" data-testid="week-day" className="min-h-11 border-b border-slate-200 p-2 text-left capitalize">{d}</th>)}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id}>
              <th scope="row" className="sticky left-0 z-10 min-h-11 border-b border-r border-slate-200 bg-white p-2 text-left font-medium">
                {p.name}<br /><span className="text-sm font-normal text-slate-500">{p.startTime}–{p.endTime}</span>
              </th>
              {GRID_DAYS.map((d) => {
                const cell = (byDay.get(d) ?? []).filter((i) => i.rowId === p.id);
                return (
                  <td key={d} className="min-h-11 border-b border-slate-200 p-1 align-top">
                    {cell.length === 0 ? (
                      <span aria-label="No class" className="block min-h-11 p-2 text-slate-300">–</span>
                    ) : cell.map((i) => (
                      <div key={i.key} data-testid="week-cell" data-state={i.state} title={i.courseNames} className={`mb-1 min-h-11 rounded-lg p-2 ${i.state === 'cancelled' || i.state === 'moved' ? 'bg-slate-100 text-slate-500' : 'bg-indigo-50'}`}>
                        <span className={`block font-semibold ${i.state === 'cancelled' || i.state === 'moved' ? 'line-through' : ''}`}>{i.courses}</span>
                        <span data-testid="week-teacher" className="block break-words text-sm text-slate-600">{i.teacher}</span>
                        {i.room && <span className="block break-words text-sm text-slate-600">{i.room}</span>}
                        <StateBadge it={i} />
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
  );
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
          const items = week.data ? itemsFor(week.data, d) : [];
          if (!items.length) return null;
          return (
            <div key={d} className="mb-3">
              <h3 className="mb-1 text-lg font-semibold capitalize">{d}</h3>
              <div className="flex flex-col gap-2">
                {items.map((i) => (
                  <Card key={i.key} data-state={i.state}>
                    <p className={`text-base font-medium ${i.state === 'cancelled' || i.state === 'moved' ? 'text-slate-500 line-through' : ''}`}>{`${i.courses} · ${i.teacher}`}</p>
                    <p className="text-base text-slate-600">
                      {i.startTime}–{i.endTime} · {i.rowName}
                      {i.room ? ` · ${i.room}` : ''}
                    </p>
                    <StateBadge it={i} />
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section aria-label="Full week routine" className="mt-6">
        <h2 className="mb-2 text-xl font-semibold">Full week routine</h2>
        {week.isPending && <ListSkeleton rows={2} />}
        {week.isError && <ErrorState message={errMsg(week.error)} onRetry={() => void week.refetch()} />}
        {week.data && !week.data.slots.some((s) => GRID_DAYS.includes(s.day)) && <EmptyState title="No classes in your week" />}
        {week.data && week.data.slots.some((s) => GRID_DAYS.includes(s.day)) && <FullWeekTable week={week.data} />}
      </section>
    </>
  );
}
