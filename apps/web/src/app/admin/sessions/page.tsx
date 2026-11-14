'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sessionBody } from '@cms/shared';
import { api } from '@/lib/api';
import { errMsg, fieldErrors, type SessionRow } from '@/lib/queries';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, ListSkeleton, PageTitle, Sheet } from '@/components/ui';

export default function SessionsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ items: SessionRow[] }>('/academics/sessions') });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const create = useMutation({
    mutationFn: (n: string) => api('/academics/sessions', { method: 'POST', json: { name: n } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      setOpen(false);
      setName('');
      setErr('');
    },
    onError: (e) => setErr(fieldErrors(e).name === 'duplicate' ? 'This session already exists.' : errMsg(e)),
  });
  const submit = () => {
    const p = sessionBody.safeParse({ name });
    if (!p.success) return setErr(p.error.issues[0]?.message ?? 'Invalid name');
    create.mutate(p.data.name);
  };
  return (
    <>
      <PageTitle action={<Button onClick={() => setOpen(true)}>New session</Button>}>Sessions</PageTitle>
      {q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState title="No sessions yet" hint="Create the first session. Science, Commerce and Arts groups are added for you." />
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.items.map((s) => (
            <li key={s.id}>
              <Link href={`/admin/sessions/${s.id}`}>
                <Card className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">{s.name}</p>
                    <p className="text-base text-slate-600">{s.groups.reduce((n, g) => n + g.studentCount, 0)} students</p>
                  </div>
                  <Badge tone={s.status === 'active' ? 'green' : 'slate'}>{s.status === 'active' ? 'Active' : 'Closed (Passed Out)'}</Badge>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={open} title="New session" onClose={() => setOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Session name" hint="Example: 2026–27" error={err}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="2026–27" autoComplete="off" />
          </Field>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create session'}
          </Button>
        </form>
      </Sheet>
    </>
  );
}
