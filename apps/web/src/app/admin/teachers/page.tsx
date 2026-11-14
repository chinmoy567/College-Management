'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { teacherCreateBody } from '@cms/shared';
import { api } from '@/lib/api';
import { errMsg, type Teacher } from '@/lib/queries';
import { Slip, type SlipData } from '@/components/Slip';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, ListSkeleton, PageTitle, Sheet } from '@/components/ui';

export default function TeachersPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['teachers'], queryFn: () => api<{ items: Teacher[] }>('/users/teachers') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', subjects: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [slip, setSlip] = useState<SlipData | null>(null);
  const [filter, setFilter] = useState('');
  const create = useMutation({
    mutationFn: (body: unknown) => api<{ loginId: string; password: string }>('/users/teachers', { method: 'POST', json: body }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['teachers'] });
      setSlip({ role: 'Teacher', name: f.name, loginId: r.loginId, password: r.password });
      setOpen(false);
      setF({ name: '', email: '', subjects: '' });
    },
    onError: (e) => setErrs({ form: errMsg(e) }),
  });
  const submit = () => {
    const p = teacherCreateBody.safeParse({ name: f.name, email: f.email, subjects: f.subjects.split(',').map((x) => x.trim()).filter(Boolean) });
    if (!p.success) {
      const m: Record<string, string> = {};
      for (const i of p.error.issues) m[String(i.path[0])] = i.message;
      return setErrs(m);
    }
    setErrs({});
    create.mutate(p.data);
  };
  const items = (q.data?.items ?? []).filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()) || (t.loginId ?? '').toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <PageTitle action={<Button onClick={() => setOpen(true)}>Add teacher</Button>}>Teachers</PageTitle>
      <div className="mb-4">
        <Input type="search" aria-label="Search teachers" placeholder="Search by name or login ID" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="No teachers found" />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((t) => (
            <li key={t.id}>
              <Card>
                <p className="text-lg font-semibold">{t.name}</p>
                <p className="text-base text-slate-600">
                  {t.designation ?? 'Teacher'} · {t.loginId}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.subjects.map((s) => (
                    <Badge key={s}>{s}</Badge>
                  ))}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={open} title="Add teacher" onClose={() => setOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Name" error={errs.name}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Email" error={errs.email}>
            <Input type="email" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Subjects" hint="Separate with commas" error={errs.subjects}>
            <Input value={f.subjects} onChange={(e) => setF({ ...f, subjects: e.target.value })} />
          </Field>
          {errs.form && <p role="alert" className="text-base text-red-700">{errs.form}</p>}
          <Button type="submit" disabled={create.isPending}>
            Create teacher
          </Button>
        </form>
      </Sheet>
      {slip && <Slip slips={[slip]} onClose={() => setSlip(null)} />}
    </>
  );
}
