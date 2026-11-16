'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { Button, ErrorState, ListSkeleton, PageTitle, cn } from '@/components/ui';

type Status = 'present' | 'absent' | 'late' | 'excused';
const ORDER: Status[] = ['present', 'absent', 'late', 'excused'];
const chip: Record<Status, string> = {
  present: 'bg-emerald-100 text-emerald-800',
  absent: 'bg-red-100 text-red-800',
  late: 'bg-amber-100 text-amber-800',
  excused: 'bg-slate-200 text-slate-700',
};
interface Student { id: string; name: string; roll: string; status: Status }
interface Sheet {
  meeting: { id: string; date: string; startTime: string; endTime: string; period: string | null; teacher: string; status: string };
  offerings: { id: string; course: { code: string; name: string }; session: string; group: string; section: string; classLevel: number; students: Student[] }[];
}
interface Draft { statuses: Record<string, Status>; clientDraftId: string }

const draftKey = (id: string) => `att-draft:${id}`;
const readDraft = (id: string): Draft | null => {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
};
const writeDraft = (id: string, d: Draft | null) => {
  try {
    if (d) localStorage.setItem(draftKey(id), JSON.stringify(d));
    else localStorage.removeItem(draftKey(id));
  } catch {
    /* storage unavailable: the sheet still works, only the draft is lost */
  }
};

export default function AttendanceSheet({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['att-sheet', id], queryFn: () => api<Sheet>(`/attendance/meetings/${id}/sheet`), refetchOnWindowFocus: false });
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [draftId, setDraftId] = useState('');
  const [state, setState] = useState<'idle' | 'sent' | 'failed'>('idle');

  // Server status (default Present, or what was saved) is the base; a kept draft wins over it.
  useEffect(() => {
    if (!q.data) return;
    const base: Record<string, Status> = {};
    for (const o of q.data.offerings) for (const s of o.students) base[s.id] = s.status;
    const draft = readDraft(id);
    setStatuses({ ...base, ...(draft?.statuses ?? {}) });
    setDraftId(draft?.clientDraftId ?? crypto.randomUUID());
    if (draft) setState('failed');
  }, [q.data, id]);

  const students = useMemo(() => q.data?.offerings.flatMap((o) => o.students) ?? [], [q.data]);
  const counts = useMemo(() => {
    const c: Record<Status, number> = { present: 0, absent: 0, late: 0, excused: 0 };
    for (const s of students) c[statuses[s.id] ?? s.status]++;
    return c;
  }, [students, statuses]);

  const cycle = (sid: string) => {
    const next = { ...statuses, [sid]: ORDER[(ORDER.indexOf(statuses[sid] ?? 'present') + 1) % ORDER.length]! };
    setStatuses(next);
    setState('idle');
    writeDraft(id, { statuses: next, clientDraftId: draftId });
  };

  const submit = useMutation({
    mutationFn: () =>
      api(`/attendance/meetings/${id}/sheet`, {
        method: 'POST',
        json: { records: students.map((s) => ({ studentId: s.id, status: statuses[s.id] ?? s.status })), clientDraftId: draftId },
      }),
    onSuccess: () => {
      writeDraft(id, null); // cleared only on a 200
      setDraftId(crypto.randomUUID()); // a later edit on this page is a new submit, not a repeat of the saved one
      setState('sent');
    },
    onError: () => {
      writeDraft(id, { statuses, clientDraftId: draftId });
      setState('failed');
    },
  });

  if (q.isPending) return <ListSkeleton rows={6} />;
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />;
  const m = q.data.meeting;
  return (
    <div className="pb-32">
      <PageTitle>Attendance</PageTitle>
      <p className="mb-3 text-base text-slate-600">
        {m.date} · {m.startTime}–{m.endTime}
        {m.period ? ` · ${m.period}` : ''} · {m.teacher}
      </p>
      {q.data.offerings.map((o) => (
        <section key={o.id} aria-label={o.course.code} className="mb-4">
          <h2 className="mb-2 text-lg font-semibold">
            {o.course.code} {o.course.name} · {o.session} · {o.group} · Class {o.classLevel} {o.section}
          </h2>
          <ul className="flex flex-col gap-2">
            {o.students.map((s) => {
              const st = statuses[s.id] ?? s.status;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    data-testid={`row-${s.roll}`}
                    aria-label={`${s.name}, roll ${s.roll}, ${st}. Tap to change`}
                    onClick={() => cycle(s.id)}
                    className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 text-left"
                  >
                    <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-base font-semibold text-slate-600">
                      {s.name.charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base text-slate-500">Roll {s.roll}</span>
                      <span className="block truncate text-base font-medium">{s.name}</span>
                    </span>
                    <span data-testid="status" className={cn('rounded-full px-3 py-1 text-base font-medium capitalize', chip[st])}>
                      {st}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <div className="fixed inset-x-0 bottom-14 z-40 lg:bottom-0 lg:left-64 border-t border-slate-200 bg-white p-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {state === 'failed' && (
            <p role="alert" data-testid="not-sent" className="text-base text-red-800">
              Not sent, retry. Your marks are kept on this phone.
            </p>
          )}
          {state === 'failed' && submit.error && (
            <p data-testid="not-sent-reason" className="text-sm text-slate-700">Reason: {errMsg(submit.error)}</p>
          )}
          {state === 'sent' && <p role="status" className="text-base text-emerald-800">Attendance saved.</p>}
          <Button disabled={submit.isPending} onClick={() => submit.mutate()} className="w-full">
            {submit.isPending ? 'Sending…' : state === 'failed' ? 'Retry' : 'Submit'} ({counts.present + counts.late} present, {counts.absent} absent)
          </Button>
        </div>
      </div>
    </div>
  );
}
