'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { TAGS, type PostData } from '@/lib/community';
import { Button, EmptyState, ErrorState, ListSkeleton, PageTitle, Select } from '@/components/ui';
import { CommunityShell } from '@/components/community/CommunityShell';
import { Composer } from '@/components/community/Composer';
import { PinnedStack } from '@/components/community/PinnedStack';
import { PostCard } from '@/components/community/PostCard';
import type { Me } from '@/lib/community';

interface Page {
  pinned?: PostData[];
  items: PostData[];
  nextCursor: string | null;
}

function Feed({ me }: { me: Me }) {
  const [tag, setTag] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['feed', tag],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      if (pageParam) p.set('cursor', pageParam);
      if (tag) p.set('tag', tag);
      return api<Page>(`/feed?${p.toString()}`);
    },
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    // A pinned post a user has just seen must not jump away (PRD §5.7.2): reload only on request.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });
  const pinned = q.data?.pages[0]?.pinned ?? [];
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageTitle action={<Button variant="secondary" onClick={() => void q.refetch()}>Refresh</Button>}>Feed</PageTitle>
      <div className="mb-4 flex flex-col gap-3">
        <Composer viewer={me} />
        <label className="flex flex-col gap-1">
          <span className="text-base font-medium">Show</span>
          <Select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
            <option value="">All posts</option>
            {TAGS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {q.isPending && <ListSkeleton rows={3} />}
      {q.isError && <ErrorState onRetry={() => void q.refetch()} />}
      {q.isSuccess && (
        <div className="flex flex-col gap-3">
          <PinnedStack posts={pinned} viewer={me} />
          {items.length === 0 && pinned.length === 0 && <EmptyState title="Nothing here yet" hint="Be the first to post." />}
          {items.map((p) => (
            <PostCard key={p.id} post={p} viewer={me} />
          ))}
          {q.hasNextPage && (
            <Button variant="secondary" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

export default function FeedPage() {
  return <CommunityShell>{(me) => <Feed me={me} />}</CommunityShell>;
}
