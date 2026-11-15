'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg, fieldErrors, type SessionRow } from '@/lib/queries';
import { fmtDateTime, fromDhakaInput, toDhakaInput, type OfferingLite } from '@/lib/exams';
import { EXAM_TYPES, uploadForm, type ChapterRow, type CourseRow, type OnlineClassRow } from '@/lib/learning';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, ListSkeleton, PageTitle, Select, Sheet, cn } from '@/components/ui';
import { MaterialList } from '@/components/MaterialList';
import { PreviousList } from '@/components/PreviousList';
import { RecordingList } from '@/components/RecordingList';

type Tab = 'classes' | 'recordings' | 'notes' | 'previous';
type Role = 'teacher' | 'admin';

/** Hook shared by the three upload/creation forms: busy flag, progress and field errors. */
function useSubmit(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const run = async (fn: (progress: (n: number) => void) => Promise<unknown>) => {
    setBusy(true); setError(''); setFields({}); setPct(0);
    try { await fn(setPct); onDone(); } catch (e) { setError(errMsg(e)); setFields(fieldErrors(e)); } finally { setBusy(false); }
  };
  return { busy, pct, error, fields, run };
}
const Progress = ({ busy, pct }: { busy: boolean; pct: number }) => busy && pct > 0 ? <div role="progressbar" aria-valuenow={pct} className="h-2 w-full rounded bg-slate-200"><div className="h-2 rounded bg-indigo-600" style={{ width: `${pct}%` }} /></div> : null;
const Err = ({ msg }: { msg: string }) => msg ? <p role="alert" className="text-base text-red-700">{msg}</p> : null;

function useOfferings(enabled: boolean) {
  return useQuery({ queryKey: ['exam-offerings'], enabled, queryFn: () => api<{ items: OfferingLite[] }>('/exams/offerings') });
}
function useChapters(courseId: string) {
  return useQuery({ queryKey: ['chapters', courseId], enabled: !!courseId, queryFn: () => api<{ items: ChapterRow[] }>(`/academics/courses/${courseId}/chapters`) });
}
const chapterSelect = (courseId: string, value: string, set: (v: string) => void, items: ChapterRow[] | undefined) => (
  <Field label="Chapter (optional)">
    <Select value={value} disabled={!courseId} onChange={(e) => set(e.target.value)}>
      <option value="">No chapter</option>
      {items?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </Select>
  </Field>
);

// ───── online class ─────
function ClassForm({ onDone }: { onDone: () => void }) {
  const offerings = useOfferings(true);
  const mine = offerings.data?.items.filter((o) => o.teaches) ?? [];
  const [ids, setIds] = useState<string[]>([]);
  const [f, setF] = useState({ title: '', topic: '', startAt: toDhakaInput(new Date(Date.now() + 3_600_000)), durationMin: '60', joinUrl: '' });
  const s = useSubmit(onDone);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void s.run(() => api('/classes/online', { method: 'POST', json: { offeringIds: ids, title: f.title, topic: f.topic || undefined, startAt: fromDhakaInput(f.startAt), durationMin: Number(f.durationMin), joinUrl: f.joinUrl } }));
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1"><legend className="text-base font-medium">Course offerings</legend>
        {mine.map((o) => (
          <label key={o.id} className="flex min-h-11 items-center gap-2 text-base">
            <input type="checkbox" className="size-5" checked={ids.includes(o.id)} onChange={(e) => setIds(e.target.checked ? [...ids, o.id] : ids.filter((x) => x !== o.id))} />
            {o.course.code} · {o.section}
          </label>
        ))}
      </fieldset>
      <Field label="Title" error={s.fields.title}><Input value={f.title} maxLength={200} required onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Topic (optional)"><Input value={f.topic} maxLength={200} onChange={(e) => setF({ ...f, topic: e.target.value })} /></Field>
      <Field label="Starts (Dhaka time)" error={s.fields.startAt}><Input type="datetime-local" value={f.startAt} required onChange={(e) => setF({ ...f, startAt: e.target.value })} /></Field>
      <Field label="Duration (minutes)" error={s.fields.durationMin} hint="15 to 240"><Input type="number" inputMode="numeric" min={15} max={240} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} /></Field>
      <Field label="Meeting link" error={s.fields.joinUrl} hint="Paste a Google Meet or Jitsi link (https://). Meet on a personal account ends after about 60 minutes."><Input type="url" inputMode="url" placeholder="https://meet.google.com/..." value={f.joinUrl} required onChange={(e) => setF({ ...f, joinUrl: e.target.value })} /></Field>
      <Err msg={s.error} />
      <Button type="submit" disabled={s.busy || ids.length === 0}>{s.busy ? 'Saving…' : 'Schedule class'}</Button>
    </form>
  );
}

function ClassCard({ c, onChanged }: { c: OnlineClassRow; onChanged: () => void }) {
  const [moving, setMoving] = useState(false);
  const [when, setWhen] = useState(toDhakaInput(c.startAt));
  const [showJoins, setShowJoins] = useState(false);
  const s = useSubmit(() => { setMoving(false); onChanged(); });
  const joins = useQuery({ queryKey: ['joins', c.id], enabled: showJoins, queryFn: () => api<{ items: { studentId: string; name: string; roll: string; clickedJoinAt: string }[] }>(`/classes/online/${c.id}/joins`) });
  const open = c.status === 'scheduled' || c.status === 'live';
  return (
    <Card data-testid={`class-${c.id}`} className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><p className="text-lg font-semibold">{c.title}</p><p className="text-base text-slate-600">{c.offerings.map((o) => `${o.course} ${o.section}`).join(', ')}</p></div>
        <Badge tone={c.status === 'live' ? 'green' : c.status === 'scheduled' ? 'amber' : c.status === 'cancelled' ? 'red' : 'slate'}>{c.status}</Badge>
      </div>
      <p className="text-base text-slate-600">{fmtDateTime(c.startAt)} · {c.durationMin} min</p>
      {moving && (
        <div className="flex flex-col gap-2">
          <Field label="New start (Dhaka time)"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <Button disabled={s.busy} onClick={() => void s.run(() => api(`/classes/online/${c.id}`, { method: 'PATCH', json: { startAt: fromDhakaInput(when) } }))}>Save new time</Button>
        </div>
      )}
      <Err msg={s.error} />
      <div className="flex flex-wrap gap-1">
        {open && c.status === 'scheduled' && <Button variant="secondary" onClick={() => setMoving(!moving)}>Reschedule</Button>}
        {open && <Button variant="danger" disabled={s.busy} onClick={() => void s.run(() => api(`/classes/online/${c.id}/cancel`, { method: 'POST' }))}>Cancel class</Button>}
        <Button variant="ghost" onClick={() => setShowJoins(!showJoins)}>Who joined</Button>
      </div>
      {showJoins && (joins.data ? (joins.data.items.length ? <ul className="text-base">{joins.data.items.map((j) => <li key={j.studentId + j.clickedJoinAt}>{j.name} ({j.roll}) · {fmtDateTime(j.clickedJoinAt)}</li>)}</ul> : <p className="text-base text-slate-600">No one has clicked Join yet.</p>) : <ListSkeleton rows={1} />)}
    </Card>
  );
}

function ClassesTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['online-classes'], queryFn: () => api<{ items: OnlineClassRow[] }>('/classes/online') });
  const reload = () => void qc.invalidateQueries({ queryKey: ['online-classes'] });
  return (
    <>
      <Button className="mb-3 w-full" onClick={() => setOpen(true)}>Schedule an online class</Button>
      <Sheet open={open} title="Schedule an online class" onClose={() => setOpen(false)}><ClassForm onDone={() => { setOpen(false); reload(); }} /></Sheet>
      {q.isPending && <ListSkeleton />}
      {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && q.data.items.length === 0 && <EmptyState title="No online classes yet" />}
      <div className="flex flex-col gap-3">{q.data?.items.map((c) => <ClassCard key={c.id} c={c} onChanged={reload} />)}</div>
    </>
  );
}

// ───── recording ─────
function RecordingForm({ role, onDone }: { role: Role; onDone: () => void }) {
  const offerings = useOfferings(role === 'teacher');
  const courses = useQuery({ queryKey: ['courses-lite'], queryFn: () => api<{ items: CourseRow[] }>('/academics/courses') });
  const [offeringId, setOfferingId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [f, setF] = useState({ title: '', description: '', url: '', visibility: role === 'admin' ? 'college' : 'section' });
  const course = role === 'teacher' ? offerings.data?.items.find((o) => o.id === offeringId)?.courseId ?? '' : courseId;
  const chapters = useChapters(course);
  const s = useSubmit(onDone);
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void s.run(() => api('/materials/recordings', { method: 'POST', json: { courseId: course, courseOfferingId: role === 'teacher' ? offeringId : undefined, chapterId: chapterId || undefined, ...f, description: f.description || undefined } })); }}>
      {role === 'teacher' ? (
        <Field label="Course offering"><Select value={offeringId} required onChange={(e) => { setOfferingId(e.target.value); setChapterId(''); }}><option value="">Choose…</option>{offerings.data?.items.map((o) => <option key={o.id} value={o.id}>{o.course.code} · {o.section}</option>)}</Select></Field>
      ) : (
        <Field label="Course"><Select value={courseId} required onChange={(e) => { setCourseId(e.target.value); setChapterId(''); }}><option value="">Choose…</option>{courses.data?.items.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</Select></Field>
      )}
      {chapterSelect(course, chapterId, setChapterId, chapters.data?.items)}
      <Field label="Title" error={s.fields.title}><Input value={f.title} required maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Description (optional)"><Input value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="YouTube or Google Drive link" error={s.fields.url} hint="Upload the video to YouTube (Unlisted is fine) and paste the link."><Input type="url" inputMode="url" value={f.url} required onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
      {role === 'teacher' && <Field label="Who can watch"><Select value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value })}><option value="section">My section only</option><option value="college">Free for all students</option></Select></Field>}
      <Err msg={s.error} />
      <Button type="submit" disabled={s.busy || !course}>{s.busy ? 'Saving…' : 'Add recording'}</Button>
    </form>
  );
}

// ───── notes ─────
function MaterialForm({ role, onDone }: { role: Role; onDone: () => void }) {
  const offerings = useOfferings(role === 'teacher');
  const options = useQuery({ queryKey: ['notice-options'], enabled: role === 'teacher', queryFn: () => api<{ sections: { id: string; label: string }[] }>('/notices/audience-options') });
  const sessions = useQuery({ queryKey: ['sessions'], enabled: role === 'admin', queryFn: () => api<{ items: SessionRow[] }>('/academics/sessions') });
  const courses = useQuery({ queryKey: ['courses-lite'], enabled: role === 'admin', queryFn: () => api<{ items: CourseRow[] }>('/academics/courses') });
  const [scope, setScope] = useState<string>(role === 'admin' ? 'college' : 'offering');
  const [target, setTarget] = useState('');
  const [courseId, setCourseId] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [f, setF] = useState({ title: '', description: '', linkUrl: '' });
  const [files, setFiles] = useState<File[]>([]);
  const offeringCourse = scope === 'offering' ? offerings.data?.items.find((o) => o.id === target)?.courseId ?? '' : courseId;
  const chapters = useChapters(offeringCourse);
  const s = useSubmit(onDone);
  const groups = (sessions.data?.items ?? []).filter((x) => x.status === 'active').flatMap((x) => x.groups.map((g) => ({ id: g.id, label: `${x.name} · ${g.type}` })));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set('scope', scope); fd.set('title', f.title);
    if (f.description) fd.set('description', f.description);
    if (f.linkUrl) fd.set('linkUrl', f.linkUrl);
    if (scope === 'offering') fd.set('courseOfferingId', target);
    if (scope === 'section') fd.set('sectionId', target);
    if (scope === 'group') fd.set('groupId', target);
    if (courseId && scope !== 'offering') fd.set('courseId', courseId);
    if (chapterId) fd.set('chapterId', chapterId);
    for (const file of files) fd.append('files', file);
    void s.run((p) => uploadForm('/materials', fd, p));
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      {role === 'teacher' ? (
        <Field label="Share with"><Select value={scope} onChange={(e) => { setScope(e.target.value); setTarget(''); }}><option value="offering">One of my courses</option><option value="section">My whole section (Section Mentor)</option></Select></Field>
      ) : (
        <Field label="Share with"><Select value={scope} onChange={(e) => { setScope(e.target.value); setTarget(''); }}><option value="college">Whole college</option><option value="group">One group</option></Select></Field>
      )}
      {scope === 'offering' && <Field label="Course offering"><Select value={target} required onChange={(e) => { setTarget(e.target.value); setChapterId(''); }}><option value="">Choose…</option>{offerings.data?.items.filter((o) => o.teaches).map((o) => <option key={o.id} value={o.id}>{o.course.code} · {o.section}</option>)}</Select></Field>}
      {scope === 'section' && <Field label="Section"><Select value={target} required onChange={(e) => setTarget(e.target.value)}><option value="">Choose…</option>{options.data?.sections.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>}
      {scope === 'group' && <Field label="Group"><Select value={target} required onChange={(e) => setTarget(e.target.value)}><option value="">Choose…</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</Select></Field>}
      {scope !== 'offering' && <Field label="Course (optional)"><Select value={courseId} onChange={(e) => { setCourseId(e.target.value); setChapterId(''); }}><option value="">No course</option>{(courses.data?.items ?? offerings.data?.items.map((o) => ({ id: o.courseId, code: o.course.code, name: o.course.name })) ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</Select></Field>}
      {chapterSelect(offeringCourse, chapterId, setChapterId, chapters.data?.items)}
      <Field label="Title" error={s.fields.title}><Input value={f.title} required maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Description (optional)"><Input value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Link (optional)" error={s.fields.linkUrl}><Input type="url" inputMode="url" value={f.linkUrl} onChange={(e) => setF({ ...f, linkUrl: e.target.value })} /></Field>
      <Field label="Files" error={s.fields.files} hint="Up to 10. PDF, Word, PowerPoint (20 MB each) or images (5 MB each)."><Input type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,image/png,image/jpeg,image/webp" onChange={(e) => setFiles([...(e.target.files ?? [])])} /></Field>
      <Err msg={s.error} /><Progress busy={s.busy} pct={s.pct} />
      <Button type="submit" disabled={s.busy || !target && scope !== 'college'}>{s.busy ? 'Uploading…' : 'Share'}</Button>
    </form>
  );
}

// ───── previous questions ─────
function PreviousForm({ role, onDone }: { role: Role; onDone: () => void }) {
  const offerings = useOfferings(role === 'teacher');
  const courses = useQuery({ queryKey: ['courses-lite'], enabled: role === 'admin', queryFn: () => api<{ items: CourseRow[] }>('/academics/courses') });
  const choices = role === 'admin' ? courses.data?.items ?? [] : [...new Map((offerings.data?.items ?? []).map((o) => [o.courseId, { id: o.courseId, code: o.course.code, name: o.course.name }])).values()];
  const [f, setF] = useState({ courseId: '', year: String(new Date().getFullYear()), examType: 'hsc_board', board: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [solution, setSolution] = useState<File | null>(null);
  const s = useSubmit(onDone);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    for (const [k, v] of Object.entries(f)) if (v) fd.set(k, v);
    for (const file of files) fd.append('files', file);
    if (solution) fd.append('solution', solution);
    void s.run((p) => uploadForm('/materials/previous-questions', fd, p));
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <Field label="Course"><Select value={f.courseId} required onChange={(e) => setF({ ...f, courseId: e.target.value })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</Select></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Year" error={s.fields.year}><Input type="number" inputMode="numeric" value={f.year} required onChange={(e) => setF({ ...f, year: e.target.value })} /></Field>
        <Field label="Exam type"><Select value={f.examType} onChange={(e) => setF({ ...f, examType: e.target.value })}>{EXAM_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      </div>
      <Field label="Board (optional)"><Input value={f.board} maxLength={100} onChange={(e) => setF({ ...f, board: e.target.value })} /></Field>
      <Field label="Question files" error={s.fields.files} hint="PDF or images, up to 10."><Input type="file" multiple required accept=".pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFiles([...(e.target.files ?? [])])} /></Field>
      <Field label="Solution (optional PDF)" error={s.fields.solution}><Input type="file" accept=".pdf" onChange={(e) => setSolution(e.target.files?.[0] ?? null)} /></Field>
      <Err msg={s.error} /><Progress busy={s.busy} pct={s.pct} />
      <Button type="submit" disabled={s.busy || !f.courseId}>{s.busy ? 'Uploading…' : 'Upload'}</Button>
    </form>
  );
}

function Adder({ label, children }: { label: string; children: (done: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className="mb-3 w-full" onClick={() => setOpen(true)}>{label}</Button>
      <Sheet open={open} title={label} onClose={() => setOpen(false)}>{children(() => setOpen(false))}</Sheet>
    </>
  );
}

export function LearningManager({ role }: { role: Role }) {
  const qc = useQueryClient();
  const tabs: [Tab, string][] = [...(role === 'teacher' ? [['classes', 'Classes'] as [Tab, string]] : []), ['recordings', 'Recordings'], ['notes', 'Notes'], ['previous', 'Past papers']];
  const [tab, setTab] = useState<Tab>(tabs[0]![0]);
  const refresh = (key: string) => () => void qc.invalidateQueries({ queryKey: [key] });
  return (
    <>
      <PageTitle>{role === 'admin' ? 'College library' : 'Teaching content'}</PageTitle>
      <div role="tablist" aria-label="Content" className={cn('mb-4 grid gap-1 rounded-xl bg-slate-100 p-1', tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
        {tabs.map(([v, label]) => (
          <button key={v} role="tab" aria-selected={tab === v} type="button" onClick={() => setTab(v)} className={cn('min-h-11 rounded-lg px-1 text-base font-medium', tab === v ? 'bg-white shadow-sm' : 'text-slate-600')}>{label}</button>
        ))}
      </div>
      {tab === 'classes' && <ClassesTab />}
      {tab === 'recordings' && <><Adder label="Add a recording">{(done) => <RecordingForm role={role} onDone={() => { done(); refresh('recordings')(); }} />}</Adder><RecordingList student={false} canDelete /></>}
      {tab === 'notes' && <><Adder label="Share notes or materials">{(done) => <MaterialForm role={role} onDone={() => { done(); refresh('materials')(); }} />}</Adder><MaterialList staff /></>}
      {tab === 'previous' && <><Adder label="Upload previous questions">{(done) => <PreviousForm role={role} onDone={() => { done(); refresh('previous')(); }} />}</Adder><PreviousList staff /></>}
    </>
  );
}
