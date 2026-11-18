'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';
import { Badge, Button, Card, EmptyState, ErrorState, Input, ListSkeleton, PageTitle, Sheet } from '@/components/ui';
import { CommunityShell } from '@/components/community/CommunityShell';
import type { Author } from '@/lib/community';

interface Conv {
  id: string;
  type: 'direct' | 'group' | 'section';
  title: string;
  unread: number;
  lastMessage: { text: string | null; deleted: boolean; hasAttachment: boolean; createdAt: string } | null;
}
interface Page {
  items: Conv[];
  nextCursor: string | null;
}

function NewChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const people = useQuery({
    queryKey: ['people', q],
    queryFn: () => api<{ items: Author[] }>(`/chat/people?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });
  const start = async (userId: string) => {
    try {
      const r = await api<{ id: string }>('/chat/direct', { method: 'POST', json: { userId } });
      router.push(`/messages/${r.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not start the chat.');
    }
  };
  return (
    <Sheet open={open} title="New chat" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Input autoFocus placeholder="Search by name" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
        {err && <p role="alert" className="text-base text-red-700">{err}</p>}
        {people.isFetching && <ListSkeleton rows={2} />}
        {people.data?.items.length === 0 && <p className="text-base text-slate-600">No one found.</p>}
        {people.data?.items.map((p) => (
          <Button key={p.id} variant="secondary" className="justify-start text-left" onClick={() => p.id && void start(p.id)}>
            <span className="flex flex-col"><span>{p.name}</span><span className="text-sm font-normal text-slate-600">{p.line}</span></span>
          </Button>
        ))}
      </div>
    </Sheet>
  );
}

function Inbox() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useInfiniteQuery({
    queryKey: ['conversations'],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<Page>(`/chat/conversations${pageParam ? `?cursor=${pageParam}` : ''}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['conversations'] });
  useSocketEvent('msg:new', refresh);
  useSocketEvent('msg:deleted', refresh);
  useSocketEvent('conv:joined', refresh);
  useSocketEvent('conv:left', refresh);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageTitle action={<span className="flex gap-2"><Link href="/people" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-3 text-base font-medium">Find people</Link><Button onClick={() => setOpen(true)}>New chat</Button></span>}>Messages</PageTitle>
      <NewChat open={open} onClose={() => setOpen(false)} />
      {q.isPending && <ListSkeleton />}
      {q.isError && <ErrorState onRetry={() => void q.refetch()} />}
      {q.isSuccess && items.length === 0 && <EmptyState title="No chats yet" hint="Start one with New chat." />}
      <div className="flex flex-col gap-2">
        {items.map((c) => (
          <Link key={c.id} href={`/messages/${c.id}`}>
            <Card className="flex min-h-11 items-center justify-between gap-3" data-testid="conversation">
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">{c.title}</p>
                <p className="truncate text-base text-slate-600">
                  {c.lastMessage ? (c.lastMessage.deleted ? 'Message deleted' : (c.lastMessage.text ?? 'Attachment')) : 'No messages yet'}
                </p>
              </div>
              {c.unread > 0 && <Badge tone="red">{c.unread}</Badge>}
            </Card>
          </Link>
        ))}
      </div>
      {q.hasNextPage && <Button variant="secondary" className="mt-3 w-full" onClick={() => void q.fetchNextPage()}>Load more</Button>}
    </>
  );
}

export default function MessagesPage() {
  return <CommunityShell>{() => <Inbox />}</CommunityShell>;
}
