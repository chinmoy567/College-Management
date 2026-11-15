'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { uploadForm, bytes } from '@/lib/learning';
import { errMsg, fieldErrors, sectionLabel, type SectionDetail, type SessionRow } from '@/lib/queries';
import { Badge, Button, Card, EmptyState, ErrorState, Field, ListSkeleton, Select, Sheet } from '@/components/ui';
import type { Period, Room } from './SetupTabs';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_NAME: Record<string, string> = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };

interface Slot {
  id: string; day: string;
  period: { id: string; name: string; startTime: string; endTime: string };
  room: { id: string; name: string } | null;
  offerings: { id: string; sectionId: string; course: { code: string; name: string }; teacher: { id: string; name: string } }[];
}
interface Upload { id: string; mime: string; name: string | null; url: string | null }
interface Warning { type: 'teacher_double_booked' | 'room_double_booked'; slotId: string }

const warnText = (w: Warning) => (w.type === 'teacher_double_booked' ? 'The teacher has another class at an overlapping time.' : 'The room is already used at an overlapping time.');

function SlotForm({ sectionId, slot, day, periods, rooms, offerings, onDone, onWarn }: {
  sectionId: string; slot?: Slot; day?: string; periods: Period[]; rooms: Room[];
  offerings: SectionDetail['offerings']; onDone: () => void; onWarn: (w: Warning[]) => void;
}) {
  const qc = useQueryClient();
  const [d, setDay] = useState(slot?.day ?? day ?? 'sun');
  const [periodId, setPeriodId] = useState(slot?.period.id ?? '');
  const [roomId, setRoomId] = useState(slot?.room?.id ?? '');
  const [picked, setPicked] = useState<string[]>(slot?.offerings.map((o) => o.id) ?? []);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const save = useMutation({
    mutationFn: () =>
      api<{ warnings: Warning[] }>(`/schedule/routine/slots${slot ? `/${slot.id}` : ''}`, {
        method: slot ? 'PATCH' : 'POST',
        json: { day: d, periodId, roomId: roomId || null, offeringIds: picked },
      }),
    onSuccess: (r) => { onWarn(r.warnings); void qc.invalidateQueries({ queryKey: ['routine', sectionId] }); onDone(); },
  });
  const remove = useMutation({
    mutationFn: () => api(`/schedule/routine/slots/${slot!.id}`, { method: 'DELETE' }),
    onSuccess: () => { onWarn([]); void qc.invalidateQueries({ queryKey: ['routine', sectionId] }); onDone(); },
  });
  const f = fieldErrors(save.error);
  const others = slot?.offerings.filter((o) => !offerings.some((x) => x.id === o.id)) ?? [];
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Field label="Day" error={f.day}>
        <Select value={d} onChange={(e) => setDay(e.target.value)}>{DAYS.map((x) => <option key={x} value={x}>{DAY_NAME[x]}</option>)}</Select>
      </Field>
      <Field label="Period" error={f.periodId} hint={periods.length ? undefined : 'Add periods in the Periods tab first.'}>
        <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)} required>
          <option value="">Choose…</option>
          {periods.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.startTime}–{p.endTime})</option>)}
        </Select>
      </Field>
      <Field label="Room (optional)" error={f.roomId}>
        <Select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">No room</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      </Field>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-base font-medium">Course(s) {picked.length > 1 && <span className="text-slate-600">(combined class: one teacher)</span>}</legend>
        {offerings.map((o) => (
          <label key={o.id} className="flex min-h-11 items-center gap-3 text-base">
            <input type="checkbox" className="h-5 w-5" checked={picked.includes(o.id)} onChange={() => toggle(o.id)} />
            {o.course.code} · {o.course.name} · {o.teacher.name}
          </label>
        ))}
        {others.map((o) => (
          <label key={o.id} className="flex min-h-11 items-center gap-3 text-base">
            <input type="checkbox" className="h-5 w-5" checked={picked.includes(o.id)} onChange={() => toggle(o.id)} />
            {o.course.code} · {o.teacher.name} <Badge>Other section</Badge>
          </label>
        ))}
        {f.offeringIds && <p role="alert" className="text-base text-red-700">{f.offeringIds}</p>}
      </fieldset>
      {(save.isError || remove.isError) && !Object.keys(f).length && <p role="alert" className="text-base text-red-700">{errMsg(save.error ?? remove.error)}</p>}
      <Button type="submit" disabled={save.isPending || !picked.length || !periodId}>{slot ? 'Save changes' : 'Add to routine'}</Button>
      {slot && <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete this class</Button>}
    </form>
  );
}

function CopyForm({ toSectionId, sections, onDone }: { toSectionId: string; sections: { id: string; label: string }[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState('');
  const copy = useMutation({
    mutationFn: () => api<{ created: number; skippedCourses: string[] }>('/schedule/routine/copy', { method: 'POST', json: { fromSectionId: from, toSectionId } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['routine', toSectionId] }),
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); copy.mutate(); }}>
      <p className="text-base text-slate-600">Copies the classes of another section whose courses also run in this section. Existing classes here are kept.</p>
      <Field label="Copy from">
        <Select value={from} onChange={(e) => setFrom(e.target.value)} required>
          <option value="">Choose…</option>
          {sections.filter((s) => s.id !== toSectionId).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
      </Field>
      {copy.isError && <p role="alert" className="text-base text-red-700">{errMsg(copy.error)}</p>}
      {copy.data && (
        <p role="status" className="text-base">
          Copied {copy.data.created} class{copy.data.created === 1 ? '' : 'es'}.
          {copy.data.skippedCourses.length > 0 && ` Skipped (course not in this section): ${copy.data.skippedCourses.join(', ')}.`}
        </p>
      )}
      <Button type="submit" disabled={!from || copy.isPending}>Copy routine</Button>
      {copy.data && <Button variant="secondary" onClick={onDone}>Done</Button>}
    </form>
  );
}

function UploadCard({ sectionId }: { sectionId: string }) {
  const qc = useQueryClient();
  const [pct, setPct] = useState(0);
  const list = useQuery({ queryKey: ['routine-uploads', sectionId], queryFn: () => api<{ uploads: Upload[] }>(`/schedule/routine/uploads?sectionId=${sectionId}`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['routine-uploads', sectionId] });
  const up = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append('sectionId', sectionId); fd.append('file', file); setPct(0); return uploadForm('/schedule/routine/upload', fd, setPct); },
    onSuccess: refresh,
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/schedule/routine/upload/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const current = list.data?.uploads[0];
  return (
    <Card data-testid="routine-upload" className="mb-4 flex flex-col gap-2">
      <h3 className="text-lg font-semibold">Routine file (optional)</h3>
      <p className="text-base text-slate-600">Upload a photo or PDF of the routine. Students and teachers of this section see it above the weekly list. A new file replaces the old one.</p>
      {current && (
        <p className="flex flex-wrap items-center gap-2 text-base">
          {current.url ? <a href={current.url} target="_blank" rel="noreferrer" className="underline">{current.name ?? 'Routine file'}</a> : (current.name ?? 'Routine file')}
          <Badge>{current.mime === 'application/pdf' ? 'PDF' : 'Image'}</Badge>
          <Button variant="secondary" disabled={del.isPending} onClick={() => del.mutate(current.id)}>Remove</Button>
        </p>
      )}
      <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-slate-100 px-4 text-base font-medium hover:bg-slate-200">
        {up.isPending ? `Uploading ${pct}%` : current ? 'Replace file' : 'Choose image or PDF'}
        <input type="file" data-testid="routine-file" className="sr-only" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={up.isPending}
          onChange={(e) => { const file = e.target.files?.[0]; if (file) up.mutate(file); e.target.value = ''; }} />
      </label>
      <p className="text-sm text-slate-500">JPEG, PNG, WebP or PDF, up to {bytes(20 * 1024 * 1024)}.</p>
      {(up.isError || del.isError) && <p role="alert" className="text-base text-red-700">{errMsg(up.error ?? del.error)}</p>}
    </Card>
  );
}

export function RoutineTab({ initialSectionId = '' }: { initialSectionId?: string }) {
  const [sectionId, setSectionId] = useState(initialSectionId);
  const [sheet, setSheet] = useState<{ slot?: Slot; day?: string } | 'copy' | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ items: SessionRow[] }>('/academics/sessions') });
  const periods = useQuery({ queryKey: ['periods'], queryFn: () => api<{ periods: Period[] }>('/schedule/periods') });
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api<{ rooms: Room[] }>('/schedule/rooms') });
  const section = useQuery({ queryKey: ['section', sectionId], enabled: !!sectionId, queryFn: () => api<SectionDetail>(`/academics/sections/${sectionId}`) });
  const routine = useQuery({ queryKey: ['routine', sectionId], enabled: !!sectionId, queryFn: () => api<{ slots: Slot[] }>(`/schedule/routine?sectionId=${sectionId}`) });
  const sections = (sessions.data?.items ?? []).filter((s) => s.status === 'active').flatMap((s) => s.groups.flatMap((g) => g.sections.map((x) => ({ id: x.id, label: `${s.name} · ${g.type.charAt(0).toUpperCase() + g.type.slice(1)} · ${sectionLabel(x)}` }))));
  const slots = routine.data?.slots ?? [];
  const shown = DAYS.filter((d) => ['sun', 'mon', 'tue', 'wed', 'thu'].includes(d) || slots.some((s) => s.day === d));
  const slotText = (s: Slot) => s.offerings.map((o) => o.course.code).join(' + ');
  const closeSheet = () => setSheet(null);
  const editing = sheet && sheet !== 'copy' ? sheet : null;

  return (
    <section aria-label="Routine">
      <Field label="Section">
        <Select value={sectionId} onChange={(e) => { setSectionId(e.target.value); setWarnings([]); }} data-testid="routine-section">
          <option value="">Choose a section…</option>
          {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
      </Field>
      {sessions.isError && <ErrorState message={errMsg(sessions.error)} onRetry={() => void sessions.refetch()} />}
      {!sectionId && <div className="mt-4"><EmptyState title="Choose a section" hint="The routine is built for one session, group and section at a time." /></div>}

      {sectionId && (
        <div className="mt-4">
          <UploadCard sectionId={sectionId} />
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold">Weekly routine</h2>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setSheet('copy')}>Copy from section</Button>
              <Button onClick={() => setSheet({})}>Add class</Button>
            </div>
          </div>
          {warnings.length > 0 && (
            <Card role="status" data-testid="routine-warnings" className="mb-3 border-amber-300 bg-amber-50">
              <p className="font-semibold">Saved, but check these clashes:</p>
              <ul className="list-disc pl-5 text-base">{warnings.map((w, i) => <li key={i}>{warnText(w)}</li>)}</ul>
            </Card>
          )}
          {routine.isPending && <ListSkeleton rows={3} />}
          {routine.isError && <ErrorState message={errMsg(routine.error)} onRetry={() => void routine.refetch()} />}
          {routine.data && slots.length === 0 && <EmptyState title="No routine yet" hint="Add classes one by one, or copy another section's routine." />}

          {/* Phones: day-by-day list */}
          <div className="flex flex-col gap-4 lg:hidden" data-testid="routine-list">
            {shown.map((d) => (
              <div key={d}>
                <div className="mb-1 flex items-center justify-between">
                  <h3 className="text-lg font-semibold">{DAY_NAME[d]}</h3>
                  <Button variant="ghost" onClick={() => setSheet({ day: d })}>+ Add</Button>
                </div>
                <div className="flex flex-col gap-2">
                  {slots.filter((s) => s.day === d).sort((a, b) => a.period.startTime.localeCompare(b.period.startTime)).map((s) => (
                    <button key={s.id} type="button" data-testid="routine-slot" onClick={() => setSheet({ slot: s })} className="min-h-11 rounded-xl border border-slate-200 bg-white p-3 text-left">
                      <p className="text-base font-semibold">{slotText(s)}</p>
                      <p className="text-base text-slate-600">{s.period.startTime}–{s.period.endTime} · {s.period.name}{s.room ? ` · ${s.room.name}` : ''}</p>
                      <p className="text-sm text-slate-500">{s.offerings.map((o) => o.teacher.name).filter((t, i, a) => a.indexOf(t) === i).join(', ')}</p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: days x periods grid */}
          <div className="hidden overflow-x-auto lg:block" data-testid="routine-grid">
            <table className="w-full border-collapse text-base">
              <thead>
                <tr>
                  <th className="border border-slate-200 p-2 text-left">Period</th>
                  {shown.map((d) => <th key={d} className="border border-slate-200 p-2 text-left">{DAY_NAME[d]}</th>)}
                </tr>
              </thead>
              <tbody>
                {(periods.data?.periods ?? []).map((p) => (
                  <tr key={p.id}>
                    <th className="border border-slate-200 p-2 text-left font-medium">{p.name}<br /><span className="text-sm font-normal text-slate-500">{p.startTime}–{p.endTime}</span></th>
                    {shown.map((d) => {
                      const cell = slots.filter((s) => s.day === d && s.period.id === p.id);
                      return (
                        <td key={d} className="border border-slate-200 p-1 align-top">
                          {cell.map((s) => (
                            <button key={s.id} type="button" onClick={() => setSheet({ slot: s })} className="mb-1 block min-h-11 w-full rounded-lg bg-indigo-50 p-2 text-left hover:bg-indigo-100">
                              <span className="block font-semibold">{slotText(s)}</span>
                              <span className="block text-sm text-slate-600">{s.room?.name ?? 'No room'}</span>
                            </button>
                          ))}
                          <button type="button" aria-label={`Add class ${DAY_NAME[d]} ${p.name}`} onClick={() => setSheet({ day: d })} className="min-h-11 w-full rounded-lg text-slate-400 hover:bg-slate-50">+</button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Sheet open={!!editing} title={editing?.slot ? 'Edit class' : 'Add class'} onClose={closeSheet}>
        {editing && section.data && (
          <SlotForm sectionId={sectionId} slot={editing.slot} day={editing.day} periods={periods.data?.periods ?? []} rooms={rooms.data?.rooms ?? []} offerings={section.data.offerings} onDone={closeSheet} onWarn={setWarnings} />
        )}
        {editing && section.isPending && <ListSkeleton rows={2} />}
      </Sheet>
      <Sheet open={sheet === 'copy'} title="Copy routine" onClose={closeSheet}>
        <CopyForm toSectionId={sectionId} sections={sections} onDone={closeSheet} />
      </Sheet>
    </section>
  );
}
