'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SECTION_MAX } from '@cms/shared';
import { api } from '@/lib/api';
import { errMsg, groupLabel, sectionLabel, type SessionRow } from '@/lib/queries';
import { Badge, Button, Card, ErrorState, ListSkeleton, PageTitle, Sheet } from '@/components/ui';

export default function SessionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ items: SessionRow[] }>('/academics/sessions') });
  const [confirm, setConfirm] = useState(false);
  const close = useMutation({
    mutationFn: () => api<{ passedOut: number }>(`/academics/sessions/${id}/close`, { method: 'POST', json: { confirm: true } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      setConfirm(false);
    },
  });
  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />;
  const s = q.data.items.find((x) => x.id === id);
  if (!s) return <ErrorState message="Session not found." />;
  const active = s.status === 'active';
  return (
    <>
      <PageTitle action={<Badge tone={active ? 'green' : 'slate'}>{active ? 'Active' : 'Closed (Passed Out)'}</Badge>}>{s.name}</PageTitle>
      <div className="flex flex-col gap-4">
        {s.groups.map((g) => (
          <Card key={g.id}>
            <h2 className="mb-2 text-lg font-semibold">
              {groupLabel(g.type)} <span className="text-base font-normal text-slate-600">· {g.studentCount} students</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {g.sections.map((x) => (
                <li key={x.id}>
                  <Link href={`/admin/sections/${x.id}`} className="flex min-h-11 items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="text-base">{sectionLabel(x)}</span>
                    <span className="text-base text-slate-600">{Math.max(0, SECTION_MAX - x.studentCount)} free</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
        {active && (
          <>
            <Link href="/admin/students/new">
              <Button className="w-full">Add student</Button>
            </Link>
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Close session
            </Button>
          </>
        )}
      </div>
      <Sheet open={confirm} title="Close session" onClose={() => setConfirm(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-base">
            Closing {s.name} marks every student in it as Passed Out. They can no longer log in. This is never automatic and cannot be undone.
          </p>
          {close.isError && (
            <p role="alert" className="text-base text-red-700">
              {errMsg(close.error)}
            </p>
          )}
          <Button variant="danger" disabled={close.isPending} onClick={() => close.mutate()}>
            {close.isPending ? 'Closing…' : 'Yes, close session'}
          </Button>
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        </div>
      </Sheet>
    </>
  );
}
