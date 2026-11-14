'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg, groupLabel, sectionLabel, type SessionRow } from '@/lib/queries';
import { Slip, type SlipData } from '@/components/Slip';
import { Badge, Button, Card, ErrorState, Field, Input, ListSkeleton, PageTitle, Select, Sheet } from '@/components/ui';

interface Student {
  id: string;
  name: string;
  roll: string;
  loginId: string | null;
  status: string;
  section: { id: string; name: string; classLevel: number; group: string; session: string };
  courses: { offeringId: string; name: string; teacher: string }[];
}

export default function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['student', id], queryFn: () => api<Student>(`/users/students/${id}`) });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ items: SessionRow[] }>('/academics/sessions') });
  const [sheet, setSheet] = useState<'reset' | 'delete' | 'move' | null>(null);
  const [slip, setSlip] = useState<SlipData | null>(null);
  const [typed, setTyped] = useState('');
  const [target, setTarget] = useState('');
  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['student', id] });
    void qc.invalidateQueries({ queryKey: ['sessions'] });
  };
  const reset = useMutation({
    mutationFn: () => api<{ password: string }>(`/users/${id}/reset-password`, { method: 'POST', json: {} }),
    onSuccess: (r) => {
      setSheet(null);
      setSlip({ role: 'Student', name: q.data?.name ?? '', loginId: q.data?.loginId ?? '', password: r.password });
    },
  });
  const toggle = useMutation({
    mutationFn: () => api(`/users/${id}/${q.data?.status === 'active' ? 'deactivate' : 'reactivate'}`, { method: 'POST', json: {} }),
    onSuccess: reload,
  });
  const del = useMutation({
    mutationFn: () => api(`/users/${id}`, { method: 'DELETE', json: { confirmLoginId: typed } }),
    onSuccess: () => window.location.assign('/admin/students'),
  });
  const move = useMutation({
    mutationFn: () => api('/users/students/move', { method: 'POST', json: { studentIds: [id], targetSectionId: target } }),
    onSuccess: () => {
      setSheet(null);
      reload();
    },
  });

  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const targets = (sessions.data?.items ?? [])
    .filter((x) => x.name === s.section.session)
    .flatMap((x) => x.groups.filter((g) => g.type === s.section.group).flatMap((g) => g.sections))
    .filter((x) => x.id !== s.section.id);
  const err = (m: { isError: boolean; error: unknown }) => m.isError && <p role="alert" className="text-base text-red-700">{errMsg(m.error)}</p>;

  return (
    <>
      <PageTitle action={<Badge tone={s.status === 'active' ? 'green' : 'slate'}>{s.status}</Badge>}>{s.name}</PageTitle>
      <div className="flex flex-col gap-4">
        <Card>
          <p className="text-base">Login ID: <strong>{s.loginId}</strong></p>
          <p className="text-base">Roll {s.roll}</p>
          <p className="text-base text-slate-600">{s.section.session} · {groupLabel(s.section.group)} · {sectionLabel(s.section)}</p>
        </Card>
        <section>
          <h2 className="mb-2 text-xl font-semibold">Courses</h2>
          <ul className="flex flex-col gap-2">
            {s.courses.map((c) => (
              <li key={c.offeringId}>
                <Card><p className="text-base font-semibold">{c.name}</p><p className="text-base text-slate-600">{c.teacher}</p></Card>
              </li>
            ))}
          </ul>
        </section>
        {s.status === 'active' || s.status === 'inactive' ? (
          <div className="flex flex-col gap-2">
            <Button variant="secondary" onClick={() => setSheet('move')}>Move to another section</Button>
            <Button variant="secondary" onClick={() => setSheet('reset')}>Reset password</Button>
            <Button variant="secondary" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
              {s.status === 'active' ? 'Deactivate' : 'Reactivate'}
            </Button>
            {err(toggle)}
            <Button variant="danger" onClick={() => setSheet('delete')}>Delete student</Button>
          </div>
        ) : null}
      </div>

      <Sheet open={sheet === 'reset'} title="Reset password" onClose={() => setSheet(null)}>
        <div className="flex flex-col gap-4">
          <p className="text-base">A new password is generated and shown once on a slip. The old password stops working.</p>
          {err(reset)}
          <Button disabled={reset.isPending} onClick={() => reset.mutate()}>Reset and show slip</Button>
        </div>
      </Sheet>
      <Sheet open={sheet === 'move'} title="Move student" onClose={() => setSheet(null)}>
        <div className="flex flex-col gap-4">
          <Field label="Target section">
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose a section</option>
              {targets.map((x) => (
                <option key={x.id} value={x.id}>{sectionLabel(x)} ({Math.max(0, 30 - x.studentCount)} free)</option>
              ))}
            </Select>
          </Field>
          {err(move)}
          <Button disabled={!target || move.isPending} onClick={() => move.mutate()}>Move</Button>
        </div>
      </Sheet>
      <Sheet open={sheet === 'delete'} title="Delete student" onClose={() => setSheet(null)}>
        <div className="flex flex-col gap-4">
          <p className="text-base">Personal data is anonymised and AI chats are deleted. This cannot be undone. Type the login ID <strong>{s.loginId}</strong> to confirm.</p>
          <Field label="Login ID">
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" />
          </Field>
          {err(del)}
          <Button variant="danger" disabled={typed.trim() !== s.loginId || del.isPending} onClick={() => del.mutate()}>Delete permanently</Button>
        </div>
      </Sheet>
      {slip && <Slip slips={[slip]} onClose={() => setSlip(null)} />}
    </>
  );
}
