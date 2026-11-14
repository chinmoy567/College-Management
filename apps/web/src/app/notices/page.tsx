'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge, Button, Card, EmptyState, ErrorState, ListSkeleton, PageTitle } from '@/components/ui';
import { CommunityShell } from '@/components/community/CommunityShell';
import type { Me } from '@/lib/community';

interface Notice {
  id: string;
  scope: 'central' | 'class';
  title: string;
  bodyHtml: string;
  priority: 'normal' | 'important' | 'urgent';
  publishedAt: string | null;
  author: { name: string; line: string | null };
  read: boolean;
  attachments: { id: string; name: string | null; mime: string; url: string | null }[];
}
interface Page {
  items: Notice[];
  nextCursor: string | null;
}
const FILTERS = [
  { v: '', label: 'All' },
  { v: 'central', label: 'Central' },
  { v: 'class', label: 'My Classes' },
] as const;

function NoticeList({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'' | 'central' | 'class'>('');
  const q = useInfiniteQuery({
    queryKey: ['notices', filter],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      if (pageParam) p.set('cursor', pageParam);
      if (filter) p.set('filter', filter);
      return api<Page>(`/notices?${p.toString()}`);
    },
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const read = async (id: string) => {
    await api(`/notices/${id}/read`, { method: 'POST' });
    void qc.invalidateQueries({ queryKey: ['notices'] });
    void qc.invalidateQueries({ queryKey: ['urgent-unread'] });
  };
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageTitle action={me.role !== 'student' ? <Link href="/notices/new" className="inline-flex min-h-11 items-center rounded-lg bg-indigo-600 px-4 text-base font-medium text-white">New notice</Link> : undefined}>Notices</PageTitle>
      <div role="tablist" aria-label="Filter notices" className="mb-3 flex gap-2">
        {FILTERS.map((f) => (
          <Button key={f.v} role="tab" aria-selected={filter === f.v} variant={filter === f.v ? 'primary' : 'secondary'} onClick={() => setFilter(f.v)}>{f.label}</Button>
        ))}
      </div>
      {q.isPending && <ListSkeleton />}
      {q.isError && <ErrorState onRetry={() => void q.refetch()} />}
      {q.isSuccess && items.length === 0 && <EmptyState title="No notices" hint="Notices from the college and your teachers appear here." />}
      <div className="flex flex-col gap-3">
        {items.map((n) => (
          <Card key={n.id} data-testid="notice" className={n.read ? '' : 'border-indigo-300'}>
            <div className="flex flex-wrap items-center gap-2">
              {!n.read && <span data-testid="unread-dot" aria-label="Unread" className="size-3 rounded-full bg-indigo-600" />}
              <h2 className="text-lg font-semibold">{n.title}</h2>
              {n.priority !== 'normal' && <Badge tone={n.priority === 'urgent' ? 'red' : 'amber'}>{n.priority === 'urgent' ? 'Urgent' : 'Important'}</Badge>}
              <Badge>{n.scope === 'central' ? 'Central' : 'Class'}</Badge>
            </div>
            <p className="text-sm text-slate-600">{n.author.name}{n.author.line ? ` · ${n.author.line}` : ''} · {n.publishedAt ? new Date(n.publishedAt).toLocaleDateString() : ''}</p>
            {/* bodyHtml is sanitised on the server with an allow-list (07 §3.2). */}
            <div className="prose-sm mt-2 text-base [&_a]:text-indigo-700 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: n.bodyHtml }} />
            {n.attachments.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {n.attachments.map((a) => (
                  <li key={a.id}>{a.url ? <a className="text-base text-indigo-700 underline" href={a.url} target="_blank" rel="noreferrer">{a.name ?? 'Attachment'}</a> : (a.name ?? 'Attachment')}</li>
                ))}
              </ul>
            )}
            {!n.read && <Button variant="secondary" className="mt-3" onClick={() => void read(n.id)}>Mark as read</Button>}
          </Card>
        ))}
      </div>
      {q.hasNextPage && <Button variant="secondary" className="mt-3 w-full" onClick={() => void q.fetchNextPage()}>Load more</Button>}
    </>
  );
}

export default function NoticesPage() {
  return <CommunityShell>{(me) => <NoticeList me={me} />}</CommunityShell>;
}
