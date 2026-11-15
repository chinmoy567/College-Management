'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SECTION_MAX, studentCreateBody } from '@cms/shared';
import { api, ApiError } from '@/lib/api';
import { errMsg, groupLabel, type SessionRow } from '@/lib/queries';
import { Slip, type SlipData } from '@/components/Slip';
import { Button, Card, ErrorState, Field, Input, ListSkeleton, PageTitle, Select } from '@/components/ui';

const nextName = (names: string[]) => {
  for (let i = 0; i < 26; i++) {
    const n = String.fromCharCode(65 + i);
    if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) return n;
  }
  return `S${names.length + 1}`;
};

export default function NewStudent() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ items: SessionRow[] }>('/academics/sessions') });
  const [sessionId, setSessionId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [classLevel, setClassLevel] = useState<11 | 12>(11);
  const [sectionId, setSectionId] = useState('');
  const [f, setF] = useState({ name: '', roll: '', email: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [forceFull, setForceFull] = useState(false);
  const [newName, setNewName] = useState('');
  const [slip, setSlip] = useState<SlipData | null>(null);

  const active = (sessions.data?.items ?? []).filter((s) => s.status === 'active');
  const session = active.find((s) => s.id === (sessionId || active[0]?.id));
  const group = session?.groups.find((g) => g.id === groupId);
  const sections = (group?.sections ?? []).filter((s) => s.classLevel === classLevel);
  const free = (n: number) => Math.max(0, SECTION_MAX - n);
  const allFull = !!group && (forceFull || (sections.length > 0 && sections.every((s) => free(s.studentCount) === 0)));

  const createSection = useMutation({
    mutationFn: () => api<{ id: string }>(`/academics/groups/${groupId}/sections`, { method: 'POST', json: { name: newName || nextName(sections.map((s) => s.name)), classLevel } }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['sessions'] });
      setSectionId(r.id);
      setForceFull(false);
      setNewName('');
    },
    onError: (e) => setErrs({ section: errMsg(e) }),
  });

  const create = useMutation({
    mutationFn: (body: unknown) => api<{ loginId: string; password: string }>('/users/students', { method: 'POST', json: body }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      const sec = group?.sections.find((s) => s.id === sectionId);
      setSlip({
        role: 'Student',
        name: f.name,
        loginId: r.loginId,
        password: r.password,
        placement: `${session?.name ?? ''} · ${group ? groupLabel(group.type) : ''} · Class ${classLevel} Section ${sec?.name ?? ''} · Roll ${f.roll}`,
      });
      setF({ name: '', roll: '', email: '' });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'SECTION_FULL') {
        setForceFull(true);
        void qc.invalidateQueries({ queryKey: ['sessions'] });
        return setErrs({ section: e.message });
      }
      const fields = e instanceof ApiError ? e.fields : undefined;
      setErrs({ form: errMsg(e), ...(fields?.roll ? { roll: 'This roll number is already used in the section.' } : {}) });
    },
  });

  const submit = () => {
    const p = studentCreateBody.safeParse({ ...f, email: f.email.trim() || undefined, sectionId });
    if (!p.success) {
      const m: Record<string, string> = {};
      for (const i of p.error.issues) m[String(i.path[0])] = i.path[0] === 'sectionId' ? 'Choose a section.' : i.message;
      return setErrs(m);
    }
    setErrs({});
    create.mutate(p.data);
  };

  if (sessions.isPending) return <ListSkeleton />;
  if (sessions.isError) return <ErrorState message={errMsg(sessions.error)} onRetry={() => void sessions.refetch()} />;

  return (
    <>
      <PageTitle>Add student</PageTitle>
      {active.length === 0 ? (
        <Card>Create an active session first.</Card>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Session">
            <Select value={session?.id ?? ''} onChange={(e) => { setSessionId(e.target.value); setGroupId(''); setSectionId(''); setForceFull(false); }}>
              {active.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Group">
            <Select value={groupId} onChange={(e) => { setGroupId(e.target.value); setSectionId(''); setForceFull(false); }}>
              <option value="">Choose a group</option>
              {session?.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {groupLabel(g.type)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Class">
            <Select value={classLevel} onChange={(e) => { setClassLevel(Number(e.target.value) as 11 | 12); setSectionId(''); setForceFull(false); }}>
              <option value={11}>Class 11</option>
              <option value={12}>Class 12</option>
            </Select>
          </Field>
          <Field label="Section" error={errs.sectionId}>
            <Select value={sectionId} onChange={(e) => { setSectionId(e.target.value); setErrs({}); }} disabled={!group}>
              <option value="">Choose a section</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id} disabled={free(s.studentCount) === 0}>
                  Section {s.name} ({free(s.studentCount)} free)
                </option>
              ))}
            </Select>
          </Field>
          {group && (allFull || sections.length === 0) && (
            <Card className="flex flex-col gap-3 border-amber-300 bg-amber-50" data-testid="all-full">
              <p role="alert" className="text-base text-amber-900">
                {sections.length === 0 ? 'This group has no section for this class yet.' : errs.section || 'Every section of this group and class is full (30 students).'}
              </p>
              <Field label="New section name">
                <Input value={newName} placeholder={nextName(sections.map((s) => s.name))} onChange={(e) => setNewName(e.target.value)} autoComplete="off" />
              </Field>
              <Button variant="secondary" disabled={createSection.isPending} onClick={() => createSection.mutate()}>
                {createSection.isPending ? 'Creating…' : 'Create new section'}
              </Button>
            </Card>
          )}
          <Field label="Full name" error={errs.name}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Roll number" error={errs.roll}>
            <Input value={f.roll} onChange={(e) => setF({ ...f, roll: e.target.value })} inputMode="numeric" autoComplete="off" />
          </Field>
          <Field label="Email (optional)" hint="Leave empty. The student can add it later from their profile." error={errs.email}>
            <Input type="email" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" />
          </Field>
          {errs.form && <p role="alert" className="text-base text-red-700">{errs.form}</p>}
          <Button type="submit" disabled={create.isPending || !sectionId}>
            {create.isPending ? 'Creating…' : 'Create student'}
          </Button>
        </form>
      )}
      {slip && <Slip slips={[slip]} onClose={() => setSlip(null)} />}
    </>
  );
}
