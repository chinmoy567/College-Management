'use client';

import Link from 'next/link';
import { use, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg, groupLabel, sectionLabel, type Course, type SectionDetail, type SessionRow, type Teacher } from '@/lib/queries';
import { Badge, Button, Card, EmptyState, ErrorState, Field, ListSkeleton, PageTitle, Select, Sheet } from '@/components/ui';

interface Suggestion extends Course {
  offered: boolean;
  offeringId: string | null;
  teacherId: string | null;
}
interface Row {
  on: boolean;
  teacherId: string;
  students: Set<string> | null; // null = all students (default)
}

export default function SectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['section', id], queryFn: () => api<SectionDetail>(`/academics/sections/${id}`) });
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => api<{ items: Teacher[] }>('/users/teachers') });
  const [sheet, setSheet] = useState<'assign' | 'mentor' | 'move' | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['section', id] });
    void qc.invalidateQueries({ queryKey: ['sessions'] });
  };
  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const open = s.session.status === 'active';
  return (
    <>
      <p className="text-base text-slate-600">
        <Link href={`/admin/sessions/${s.session.id}`} className="underline">
          {s.session.name}
        </Link>{' '}
        · {groupLabel(s.group.type)}
      </p>
      <PageTitle action={<Badge tone={s.freePlaces > 0 ? 'green' : 'amber'}>{s.freePlaces} free</Badge>}>{sectionLabel(s)}</PageTitle>

      <div className="flex flex-col gap-4">
        <Card className="flex items-center justify-between gap-3">
          <div>
            <p className="text-base text-slate-600">Section Mentor</p>
            <p className="text-lg font-semibold">{s.mentor?.name ?? 'No mentor yet'}</p>
          </div>
          {open && (
            <Button variant="secondary" onClick={() => setSheet('mentor')}>
              {s.mentor ? 'Change' : 'Assign'}
            </Button>
          )}
        </Card>

        <section aria-labelledby="off">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 id="off" className="text-xl font-semibold">
              Courses
            </h2>
            {open && <Button onClick={() => setSheet('assign')}>Assign Courses</Button>}
          </div>
          {s.offerings.length === 0 ? (
            <EmptyState title="No courses assigned" hint="Use Assign Courses to pick courses and teachers." />
          ) : (
            <ul className="flex flex-col gap-2">
              {s.offerings.map((o) => (
                <li key={o.id}>
                  <Card className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold">{o.course.name}</p>
                      <p className="text-base text-slate-600">{o.teacher.name}</p>
                    </div>
                    {o.course.isOptional && <Badge tone="amber">Optional</Badge>}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="stu">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 id="stu" className="text-xl font-semibold">
              Students ({s.students.length})
            </h2>
            {open && (
              <Button variant="secondary" onClick={() => setSheet('move')} disabled={s.students.length === 0}>
                Move / promote
              </Button>
            )}
          </div>
          {s.students.length === 0 ? (
            <EmptyState title="No students yet" action={open ? <Link href="/admin/students/new"><Button>Add student</Button></Link> : undefined} />
          ) : (
            <ul className="flex flex-col gap-2">
              {s.students.map((st) => (
                <li key={st.id}>
                  <Link href={`/admin/students/${st.id}`}>
                    <Card className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold">{st.name}</p>
                        <p className="text-base text-slate-600">Roll {st.roll} · {st.loginId}</p>
                      </div>
                      {st.status !== 'active' && <Badge tone="slate">{st.status}</Badge>}
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {sheet === 'assign' && <AssignSheet section={s} teachers={teachers.data?.items ?? []} onClose={() => setSheet(null)} onDone={refresh} />}
      {sheet === 'mentor' && <MentorSheet section={s} teachers={teachers.data?.items ?? []} onClose={() => setSheet(null)} onDone={refresh} />}
      {sheet === 'move' && <MoveSheet section={s} onClose={() => setSheet(null)} onDone={refresh} />}
    </>
  );
}

function MentorSheet({ section, teachers, onClose, onDone }: { section: SectionDetail; teachers: Teacher[]; onClose: () => void; onDone: () => void }) {
  const [t, setT] = useState(section.mentor?.id ?? '');
  const save = useMutation({
    mutationFn: () => api(`/academics/sections/${section.id}`, { method: 'PATCH', json: { mentorTeacherId: t || null } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Sheet open title="Section Mentor" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="Teacher" hint="A teacher can mentor one section only.">
          <Select value={t} onChange={(e) => setT(e.target.value)}>
            <option value="">No mentor</option>
            {teachers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        {save.isError && <p role="alert" className="text-base text-red-700">{errMsg(save.error)}</p>}
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </Sheet>
  );
}

function AssignSheet({ section, teachers, onClose, onDone }: { section: SectionDetail; teachers: Teacher[]; onClose: () => void; onDone: () => void }) {
  const sug = useQuery({ queryKey: ['suggestions', section.id], queryFn: () => api<{ items: Suggestion[] }>(`/academics/sections/${section.id}/course-suggestions`) });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ items: SessionRow[] }>('/academics/sessions') });
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [copyFrom, setCopyFrom] = useState('');
  const get = (c: Suggestion): Row => rows[c.id] ?? { on: c.offered, teacherId: c.teacherId ?? '', students: null };
  const patch = (c: Suggestion, p: Partial<Row>) => setRows((r) => ({ ...r, [c.id]: { ...get(c), ...p } }));
  const sorted = (c: Suggestion) => {
    const key = c.name.toLowerCase();
    const m = (t: Teacher) => t.subjects.some((x) => key.includes(x.toLowerCase()) || x.toLowerCase().includes(key));
    return [...teachers].sort((a, b) => Number(m(b)) - Number(m(a)) || a.name.localeCompare(b.name));
  };
  const others = useMemo(() => {
    const ses = sessions.data?.items.find((x) => x.id === section.session.id);
    return (ses?.groups ?? []).filter((g) => g.type === section.group.type).flatMap((g) => g.sections).filter((x) => x.id !== section.id && x.classLevel === section.classLevel);
  }, [sessions.data, section]);

  const save = useMutation({
    mutationFn: () => {
      const items = (sug.data?.items ?? []).filter((c) => get(c).on).map((c) => {
        const r = get(c);
        return { courseId: c.id, teacherId: r.teacherId, ...(c.isOptional && r.students ? { optionalStudentIds: [...r.students] } : {}) };
      });
      return api(`/academics/sections/${section.id}/offerings`, { method: 'PUT', json: { items } });
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const copy = useMutation({
    mutationFn: () => api(`/academics/sections/${section.id}/offerings/copy`, { method: 'POST', json: { fromSectionId: copyFrom } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const missing = (sug.data?.items ?? []).some((c) => get(c).on && !get(c).teacherId);

  return (
    <Sheet open title="Assign Courses" onClose={onClose}>
      {sug.isPending ? (
        <ListSkeleton />
      ) : sug.isError ? (
        <ErrorState message={errMsg(sug.error)} onRetry={() => void sug.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          {others.length > 0 && (
            <Card className="flex flex-col gap-2 bg-slate-50">
              <Field label="Copy assignments from">
                <Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                  <option value="">Choose a section</option>
                  {others.map((x) => (
                    <option key={x.id} value={x.id}>
                      {sectionLabel(x)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button variant="secondary" disabled={!copyFrom || copy.isPending} onClick={() => copy.mutate()}>
                Copy
              </Button>
              {copy.isError && <p role="alert" className="text-base text-red-700">{errMsg(copy.error)}</p>}
            </Card>
          )}
          {sug.data.items.length === 0 && <EmptyState title="No suggested courses" hint="Add courses in the catalog first." />}
          {sug.data.items.map((c) => {
            const r = get(c);
            return (
              <Card key={c.id} className="flex flex-col gap-3">
                <label className="flex min-h-11 items-center gap-3 text-base font-semibold">
                  <input type="checkbox" className="size-6" checked={r.on} onChange={(e) => patch(c, { on: e.target.checked })} />
                  <span>
                    {c.name} <span className="font-normal text-slate-600">({c.code})</span>
                  </span>
                </label>
                {r.on && (
                  <>
                    <Field label="Teacher">
                      <Select aria-label={`Teacher for ${c.name}`} value={r.teacherId} onChange={(e) => patch(c, { teacherId: e.target.value })}>
                        <option value="">Choose a teacher</option>
                        {sorted(c).map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {t.subjects.length ? ` (${t.subjects.join(', ')})` : ''}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {c.isOptional && (
                      <fieldset className="flex flex-col gap-1">
                        <legend className="text-base font-medium">Students taking this optional course</legend>
                        <p className="text-sm text-slate-500">{r.students ? `${r.students.size} chosen` : 'All students (default)'}</p>
                        {section.students.map((st) => {
                          const checked = r.students ? r.students.has(st.id) : true;
                          return (
                            <label key={st.id} className="flex min-h-11 items-center gap-3 text-base">
                              <input
                                type="checkbox"
                                className="size-6"
                                checked={checked}
                                onChange={(e) => {
                                  const base = new Set(r.students ?? section.students.map((x) => x.id));
                                  if (e.target.checked) base.add(st.id);
                                  else base.delete(st.id);
                                  patch(c, { students: base });
                                }}
                              />
                              {st.name} <span className="text-slate-600">Roll {st.roll}</span>
                            </label>
                          );
                        })}
                      </fieldset>
                    )}
                  </>
                )}
              </Card>
            );
          })}
          {save.isError && <p role="alert" className="text-base text-red-700">{errMsg(save.error)}</p>}
          {missing && <p className="text-base text-amber-700">Pick a teacher for every selected course.</p>}
          <Button disabled={save.isPending || missing} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save assignments'}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function MoveSheet({ section, onClose, onDone }: { section: SectionDetail; onClose: () => void; onDone: () => void }) {
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ items: SessionRow[] }>('/academics/sessions') });
  const [target, setTarget] = useState('');
  const targets = (sessions.data?.items.find((x) => x.id === section.session.id)?.groups ?? [])
    .filter((g) => g.type === section.group.type)
    .flatMap((g) => g.sections)
    .filter((x) => x.id !== section.id);
  const move = useMutation({
    mutationFn: () => api('/users/students/move', { method: 'POST', json: { wholeSectionId: section.id, targetSectionId: target } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Sheet open title="Move or promote section" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-base">Moves all active students of {sectionLabel(section)} to another section of this session. Choose a Class 12 section to promote them.</p>
        <Field label="Target section">
          <Select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Choose a section</option>
            {targets.map((x) => (
              <option key={x.id} value={x.id}>
                {sectionLabel(x)} ({Math.max(0, 30 - x.studentCount)} free)
              </option>
            ))}
          </Select>
        </Field>
        {move.isError && <p role="alert" className="text-base text-red-700">{errMsg(move.error)}</p>}
        <Button disabled={!target || move.isPending} onClick={() => move.mutate()}>
          {move.isPending ? 'Moving…' : 'Move students'}
        </Button>
      </div>
    </Sheet>
  );
}
