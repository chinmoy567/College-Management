'use client';

import Link from 'next/link';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, Card, EmptyState, ErrorState, ListSkeleton, PageTitle } from '@/components/ui';
import { CommunityShell } from '@/components/community/CommunityShell';

interface Item {
  id: string;
  type: string;
  refType: string | null;
  refId: string | null;
  text: string;
  read: boolean;
  createdAt: string;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}

const hrefOf = (n: Item) => (n.refType === 'conversation' && n.refId ? `/messages/${n.refId}` : n.refType === 'notice' ? '/notices' : n.refType === 'post' ? '/feed' : '/notifications');

function List() {
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['notifications'],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<Page>(`/notifications${pageParam ? `?cursor=${pageParam}` : ''}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const done = (unread: number) => {
    qc.setQueryData(['unread-count'], { unread });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const markAll = async () => done((await api<{ unread: number }>('/notifications/read', { method: 'POST', json: { all: true } })).unread);
  const markOne = async (id: string) => done((await api<{ unread: number }>('/notifications/read', { method: 'POST', json: { ids: [id] } })).unread);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageTitle action={<Button variant="secondary" onClick={() => void markAll()}>Mark all read</Button>}>Notifications</PageTitle>
      <p className="mb-3"><Link href="/notifications/settings" className="text-base font-medium text-indigo-700 underline">Notification settings</Link></p>
      {q.isPending && <ListSkeleton />}
      {q.isError && <ErrorState onRetry={() => void q.refetch()} />}
      {q.isSuccess && items.length === 0 && <EmptyState title="Nothing yet" hint="New notices, messages and updates show up here." />}
      <div className="flex flex-col gap-2">
        {items.map((n) => (
          <Link key={n.id} href={hrefOf(n)} onClick={() => !n.read && void markOne(n.id)}>
            <Card className={`min-h-11 ${n.read ? '' : 'border-indigo-300 bg-indigo-50'}`} data-testid="notification">
              <p className={`text-base ${n.read ? '' : 'font-semibold'}`}>{n.text}</p>
              <p className="text-sm text-slate-500">{new Date(n.createdAt).toLocaleString()}</p>
            </Card>
          </Link>
        ))}
      </div>
      {q.hasNextPage && <Button variant="secondary" className="mt-3 w-full" onClick={() => void q.fetchNextPage()}>Load more</Button>}
    </>
  );
}

export default function NotificationsPage() {
  return <CommunityShell>{() => <List />}</CommunityShell>;
}
