'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg, fieldErrors, sectionLabel, type SectionDetail, type SessionRow } from '@/lib/queries';
import { Badge, Button, Card, ErrorState, Field, Input, ListSkeleton, PageTitle, Select, Sheet, cn } from '@/components/ui';
import { monthCells, monthLabel, monthRange, shiftMonth, todayYm, todayYmd } from '@/lib/calendar';

interface Holiday { id: string; title: string; startDate: string; endDate: string }
interface Meeting { id: string; date: string; startTime: string; endTime: string; status: string; extra: boolean; offerings: { course: { code: string }; section: string }[] }
interface CalendarData { holidays: Holiday[]; specialDays: { id: string; date: string; title: string }[]; meetings: Meeting[] }
interface Period { id: string; name: string; startTime: string; endTime: string }

function HolidayForm({ date, onDone }: { date: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(date);
  const [end, setEnd] = useState(date);
  const save = useMutation({
    mutationFn: () => api('/schedule/holidays', { method: 'POST', json: { title, startDate: start, endDate: end } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['sch-cal'] }); onDone(); },
  });
  const f = fieldErrors(save.error);
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Field label="Title" error={f.title}><Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} /></Field>
      <Field label="From" error={f.startDate}><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} required /></Field>
      <Field label="To" error={f.endDate}><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} required /></Field>
      {save.isError && !Object.keys(f).length && <p role="alert" className="text-base text-red-700">{errMsg(save.error)}</p>}
      <Button type="submit" disabled={save.isPending}>Save holiday</Button>
    </form>
  );
}

function ExtraClassForm({ date, onDone }: { date: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [sectionId, setSectionId] = useState('');
  const [offeringId, setOfferingId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [day, setDay] = useState(date);
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ items: SessionRow[] }>('/academics/sessions') });
  const periods = useQuery({ queryKey: ['periods'], queryFn: () => api<{ periods: Period[] }>('/schedule/periods') });
  const section = useQuery({ queryKey: ['section', sectionId], enabled: !!sectionId, queryFn: () => api<SectionDetail>(`/academics/sections/${sectionId}`) });
  const sections = (sessions.data?.items ?? []).filter((s) => s.status === 'active').flatMap((s) => s.groups.flatMap((g) => g.sections.map((x) => ({ ...x, label: `${s.name} · ${sectionLabel(x)}` }))));
  const save = useMutation({
    mutationFn: () => api('/schedule/meetings/extra', { method: 'POST', json: { offeringIds: [offeringId], date: day, periodId } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['sch-cal'] }); onDone(); },
  });
  const f = fieldErrors(save.error);
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Field label="Section">
        <Select value={sectionId} onChange={(e) => { setSectionId(e.target.value); setOfferingId(''); }} required>
          <option value="">Choose…</option>
          {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
      </Field>
      <Field label="Course" error={f.offeringIds}>
        <Select value={offeringId} onChange={(e) => setOfferingId(e.target.value)} required disabled={!section.data}>
          <option value="">Choose…</option>
          {section.data?.offerings.map((o) => <option key={o.id} value={o.id}>{o.course.code} · {o.teacher.name}</option>)}
        </Select>
      </Field>
      <Field label="Date" error={f.date}><Input type="date" value={day} min={todayYmd()} onChange={(e) => setDay(e.target.value)} required /></Field>
      <Field label="Period" error={f.periodId}>
        <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)} required>
          <option value="">Choose…</option>
          {periods.data?.periods.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.startTime}–{p.endTime})</option>)}
        </Select>
      </Field>
      {save.isError && !Object.keys(f).length && <p role="alert" className="text-base text-red-700">{errMsg(save.error)}</p>}
      <Button type="submit" disabled={save.isPending}>Save extra class</Button>
    </form>
  );
}

export default function ScheduleManager() {
  const [month, setMonth] = useState(todayYm());
  const [picked, setPicked] = useState(todayYmd());
  const [form, setForm] = useState<'holiday' | 'extra' | null>(null);
  const { from, to } = monthRange(month);
  const cal = useQuery({ queryKey: ['sch-cal', month], queryFn: () => api<CalendarData>(`/schedule/calendar?from=${from}&to=${to}`) });
  const d = cal.data;
  const holidayOn = (date: string) => d?.holidays.find((h) => h.startDate <= date && date <= h.endDate);
  const classesOn = (date: string) => d?.meetings.filter((m) => m.date === date && m.status !== 'removed') ?? [];
  const pickedHoliday = holidayOn(picked);
  const pickedSpecial = d?.specialDays.find((s) => s.date === picked);
  const pickedClasses = classesOn(picked);
  return (
    <>
      <PageTitle>Schedule</PageTitle>
      <div className="mb-2 flex items-center justify-between">
        <Button variant="secondary" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>Prev</Button>
        <h2 className="text-lg font-semibold">{monthLabel(month)}</h2>
        <Button variant="secondary" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>Next</Button>
      </div>
      {cal.isPending && <ListSkeleton rows={2} />}
      {cal.isError && <ErrorState message={errMsg(cal.error)} onRetry={() => void cal.refetch()} />}
      <div className="grid grid-cols-7 gap-1 text-center text-sm text-slate-500">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x, i) => <span key={i}>{x}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {monthCells(month).map((c, i) =>
          c ? (
            <button
              key={c.date}
              type="button"
              data-testid={`day-${c.date}`}
              aria-pressed={picked === c.date}
              onClick={() => setPicked(c.date)}
              className={cn(
                'flex min-h-12 flex-col items-center justify-center rounded-lg text-base',
                holidayOn(c.date) ? 'bg-amber-100 text-amber-900' : 'bg-slate-50 text-slate-800',
                picked === c.date && 'ring-2 ring-indigo-600',
              )}
            >
              {c.day}
              {classesOn(c.date).length > 0 && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-indigo-600" />}
            </button>
          ) : (
            <span key={i} />
          ),
        )}
      </div>

      <Card data-testid="day-panel" className="mt-4 flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{picked}</h2>
        {pickedHoliday && <Badge tone="amber">Holiday: {pickedHoliday.title}</Badge>}
        {pickedSpecial && <Badge>Special day: {pickedSpecial.title}</Badge>}
        {pickedClasses.length === 0 && !pickedHoliday && <p className="text-base text-slate-600">No classes.</p>}
        <ul className="flex flex-col gap-1">
          {pickedClasses.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 text-base">
              <span>{m.startTime}–{m.endTime} · {m.offerings.map((o) => o.course.code).join(' + ')}</span>
              {m.extra && <Badge tone="amber">Extra</Badge>}
              {m.status === 'cancelled' && <Badge tone="red">Cancelled</Badge>}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setForm('holiday')}>Add holiday</Button>
          <Button variant="secondary" onClick={() => setForm('extra')}>Add extra class</Button>
        </div>
      </Card>

      <Sheet open={form === 'holiday'} title="Add holiday" onClose={() => setForm(null)}>
        <HolidayForm date={picked} onDone={() => setForm(null)} />
      </Sheet>
      <Sheet open={form === 'extra'} title="Add extra class" onClose={() => setForm(null)}>
        <ExtraClassForm date={picked < todayYmd() ? todayYmd() : picked} onDone={() => setForm(null)} />
      </Sheet>
    </>
  );
}
