'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { fmtDateTime, useTick } from '@/lib/exams';
import type { OnlineClassRow } from '@/lib/learning';
import { Badge, Button, Card, EmptyState, ErrorState, ListSkeleton, PageTitle } from '@/components/ui';

const PLATFORM = { meet: 'Google Meet', jitsi: 'Jitsi', other: 'Meeting link' } as const;
const TONE = { live: 'green', scheduled: 'amber', ended: 'slate', cancelled: 'red' } as const;

export default function StudentLive() {
  const qc = useQueryClient();
  const tick = useTick(30_000);
  const [error, setError] = useState('');
  const q = useQuery({ queryKey: ['online-classes'], queryFn: () => api<{ items: OnlineClassRow[] }>('/classes/online'), refetchInterval: 60_000 });
  const join = useMutation({
    mutationFn: (id: string) => api<{ joinUrl: string }>(`/classes/online/${id}/join`, { method: 'POST' }),
    onSuccess: ({ joinUrl }) => {
      setError('');
      // New tab, no opener: the meeting site gets no handle on this page.
      window.open(joinUrl, '_blank', 'noopener,noreferrer');
    },
    onError: (e) => setError(errMsg(e)),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['online-classes'] }),
  });
  const items = (q.data?.items ?? []).filter((c) => c.status !== 'cancelled' || new Date(c.startAt).getTime() > tick - 86_400_000);
  const upcoming = items.filter((c) => c.status === 'live' || c.status === 'scheduled').sort((a, b) => a.startAt.localeCompare(b.startAt));
  const past = items.filter((c) => c.status === 'ended' || c.status === 'cancelled').slice(0, 10);
  return (
    <>
      <PageTitle>Live classes</PageTitle>
      <p className="mb-4 text-base text-slate-600">Classes open in a free meeting tool (Google Meet sessions on personal accounts may last about 60 minutes; Jitsi has no limit). Join opens from 10 minutes before the start.</p>
      {error && <p role="alert" className="mb-3 text-base text-red-700">{error}</p>}
      {q.isPending && <ListSkeleton />}
      {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && items.length === 0 && <EmptyState title="No online classes" hint="When a teacher schedules one for your course it shows here." />}
      <div className="flex flex-col gap-3">
        {upcoming.map((c) => (
          <Card key={c.id} data-testid={`class-${c.id}`} className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-lg font-semibold">{c.title}</p>
                <p className="text-base text-slate-600">{c.offerings.map((o) => o.course).join(', ')} · {c.teacher}</p>
              </div>
              <Badge tone={TONE[c.status]}>{c.status === 'live' ? 'Live now' : 'Upcoming'}</Badge>
            </div>
            <p className="text-base text-slate-600">{fmtDateTime(c.startAt)} · {c.durationMin} min · {PLATFORM[c.platform]}</p>
            {c.topic && <p className="text-base">{c.topic}</p>}
            <Button disabled={!c.joinOpen || join.isPending} onClick={() => join.mutate(c.id)}>
              {c.joinOpen ? 'Join class' : 'Opens 10 min before start'}
            </Button>
          </Card>
        ))}
        {past.length > 0 && <h2 className="mt-2 text-lg font-semibold">Earlier</h2>}
        {past.map((c) => (
          <Card key={c.id} className="flex items-center justify-between gap-2 opacity-80">
            <div className="min-w-0">
              <p className="truncate text-base font-medium">{c.title}</p>
              <p className="text-sm text-slate-600">{fmtDateTime(c.startAt)}</p>
            </div>
            <Badge tone={TONE[c.status]}>{c.status === 'cancelled' ? 'Cancelled' : 'Ended'}</Badge>
          </Card>
        ))}
      </div>
    </>
  );
}
