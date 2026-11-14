'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { timeAgo, type Author } from '@/lib/community';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, ListSkeleton, PageTitle, Sheet } from '@/components/ui';

interface QueueItem {
  key: string;
  kind: 'report' | 'held';
  targetType: 'post' | 'comment' | 'message' | 'user';
  targetId: string;
  preview: string;
  reasons: string[];
  reporterCount: number;
  removed: boolean;
  createdAt: string;
  author: Author | null;
}
type Action = 'dismiss' | 'delete' | 'delete_warn' | 'mute' | 'approve';
const LABEL: Record<Action, string> = { dismiss: 'Dismiss', delete: 'Delete', delete_warn: 'Delete & warn', mute: 'Mute user', approve: 'Approve' };

function ActionSheet({ item, action, onClose }: { item: QueueItem; action: Action; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('3');
  const m = useMutation({
    mutationFn: () => api(`/admin/moderation/${item.targetType}/${item.targetId}`, { method: 'POST', json: { action, reason: reason.trim(), ...(action === 'mute' ? { days: Number(days) } : {}) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['moderation'] });
      void qc.invalidateQueries({ queryKey: ['sanctions'] });
      onClose();
    },
  });
  return (
    <Sheet open title={LABEL[action]} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) m.mutate();
        }}
      >
        <p className="text-base text-slate-700">{item.preview}</p>
        {action === 'mute' && (
          <Field label="Mute for how many days?">
            <Input type="number" inputMode="numeric" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        )}
        <Field label="Reason (kept in the audit log)">
          <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {m.isError && (
          <p role="alert" className="text-base text-red-700">
            {errMsg(m.error)}
          </p>
        )}
        <Button type="submit" variant={action === 'delete' || action === 'delete_warn' ? 'danger' : 'primary'} disabled={m.isPending || !reason.trim()}>
          {LABEL[action]}
        </Button>
      </form>
    </Sheet>
  );
}

function Queue() {
  const [type, setType] = useState('');
  const [act, setAct] = useState<{ item: QueueItem; action: Action } | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['moderation', type],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<{ items: QueueItem[]; nextCursor: string | null }>(`/admin/moderation?status=open${type ? `&type=${type}` : ''}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Filter">
        {[['', 'All'], ['post', 'Posts'], ['comment', 'Comments'], ['user', 'Users'], ['held', 'Held']].map(([v, l]) => (
          <Button key={v} variant={type === v ? 'primary' : 'secondary'} onClick={() => setType(v!)}>
            {l}
          </Button>
        ))}
      </div>
      {q.isPending && <ListSkeleton />}
      {q.isError && <ErrorState onRetry={() => void q.refetch()} />}
      {q.isSuccess && items.length === 0 && <EmptyState title="Nothing to review" hint="Reports and held posts appear here." />}
      {items.map((i) => (
        <Card key={i.key} className="flex flex-col gap-2" data-testid="queue-item">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={i.kind === 'held' ? 'amber' : 'red'}>{i.kind === 'held' ? 'Held (banned word)' : `${i.reporterCount} ${i.reporterCount === 1 ? 'report' : 'reports'}`}</Badge>
            <Badge>{i.targetType}</Badge>
            {i.removed && <Badge tone="slate">Already removed</Badge>}
          </div>
          <p className="break-words text-base">{i.preview}</p>
          {i.author && (
            <p className="text-sm text-slate-600">
              By{' '}
              {i.author.id ? (
                <Link className="underline" href={i.author.role === 'student' ? `/admin/students/${i.author.id}` : `/u/${i.author.id}`}>
                  {i.author.name}
                </Link>
              ) : (
                i.author.name
              )}{' '}
              · {timeAgo(i.createdAt)}
            </p>
          )}
          {i.kind === 'report' && <p className="text-sm text-slate-600">Reasons: {[...new Set(i.reasons)].join(', ')}</p>}
          <div className="flex flex-wrap gap-2">
            {(i.kind === 'held' ? (['approve', 'delete'] as Action[]) : i.targetType === 'user' ? (['dismiss', 'mute'] as Action[]) : (['dismiss', 'delete', 'delete_warn', 'mute'] as Action[])).map((a) => (
              <Button key={a} variant={a === 'delete' || a === 'delete_warn' ? 'danger' : 'secondary'} onClick={() => setAct({ item: i, action: a })}>
                {LABEL[a]}
              </Button>
            ))}
            {i.targetType === 'post' && (
              <Link href={`/feed/posts/${i.targetId}`} className="flex min-h-11 items-center px-3 text-base text-indigo-700 underline">
                Open
              </Link>
            )}
          </div>
        </Card>
      ))}
      {q.hasNextPage && (
        <Button variant="secondary" onClick={() => void q.fetchNextPage()}>
          Load more
        </Button>
      )}
      {act && <ActionSheet item={act.item} action={act.action} onClose={() => setAct(null)} />}
    </div>
  );
}

function Muted() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sanctions'], queryFn: () => api<{ items: { id: string; user: Author; reason: string; endsAt: string }[] }>('/admin/sanctions') });
  const lift = useMutation({ mutationFn: (id: string) => api(`/admin/sanctions/${id}/lift`, { method: 'POST' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['sanctions'] }) });
  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (q.data.items.length === 0) return <EmptyState title="Nobody is muted" />;
  return (
    <div className="flex flex-col gap-3">
      {q.data.items.map((s) => (
        <Card key={s.id} className="flex flex-col gap-2">
          <p className="text-lg font-semibold">{s.user.name}</p>
          <p className="text-base text-slate-700">Until {timeAgo(s.endsAt)} · {s.reason}</p>
          <Button variant="secondary" disabled={lift.isPending} onClick={() => lift.mutate(s.id)}>
            End mute now
          </Button>
        </Card>
      ))}
    </div>
  );
}

function Words() {
  const qc = useQueryClient();
  const [word, setWord] = useState('');
  const q = useQuery({ queryKey: ['banned'], queryFn: () => api<{ enabled: boolean; items: { id: string; word: string }[] }>('/admin/banned-words') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['banned'] });
  const add = useMutation({ mutationFn: () => api('/admin/banned-words', { method: 'POST', json: { word: word.trim() } }), onSuccess: () => (setWord(''), refresh()) });
  const del = useMutation({ mutationFn: (id: string) => api(`/admin/banned-words/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const toggle = useMutation({ mutationFn: (enabled: boolean) => api('/admin/banned-words-enabled', { method: 'PUT', json: { enabled } }), onSuccess: refresh });
  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <div className="flex flex-col gap-4">
      <label className="flex min-h-11 items-center gap-3 text-base font-medium">
        <input type="checkbox" className="size-6" checked={q.data.enabled} disabled={toggle.isPending} onChange={(e) => toggle.mutate(e.target.checked)} />
        Hold posts and comments that contain a banned word
      </label>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (word.trim()) add.mutate();
        }}
      >
        <Input aria-label="New banned word" value={word} maxLength={60} onChange={(e) => setWord(e.target.value)} placeholder="Add a word" />
        <Button type="submit" disabled={add.isPending || !word.trim()}>
          Add
        </Button>
      </form>
      {add.isError && (
        <p role="alert" className="text-base text-red-700">
          {errMsg(add.error)}
        </p>
      )}
      {q.data.items.length === 0 && <EmptyState title="No banned words yet" />}
      <ul className="flex flex-col gap-2">
        {q.data.items.map((w) => (
          <li key={w.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3">
            <span className="text-base">{w.word}</span>
            <Button variant="ghost" onClick={() => del.mutate(w.id)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ModerationPage() {
  const [tab, setTab] = useState<'queue' | 'muted' | 'words'>('queue');
  return (
    <>
      <PageTitle>Moderation</PageTitle>
      <div className="mb-4 grid grid-cols-3 gap-2" role="tablist">
        {([['queue', 'Queue'], ['muted', 'Muted'], ['words', 'Banned words']] as const).map(([v, l]) => (
          <Button key={v} role="tab" aria-selected={tab === v} variant={tab === v ? 'primary' : 'secondary'} onClick={() => setTab(v)}>
            {l}
          </Button>
        ))}
      </div>
      {tab === 'queue' && <Queue />}
      {tab === 'muted' && <Muted />}
      {tab === 'words' && <Words />}
    </>
  );
}
