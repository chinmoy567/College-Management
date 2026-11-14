'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { GROUPS, type BookCardRow } from '@/lib/books';
import { BookCard } from '@/components/books/BookCard';
import { Button, EmptyState, ErrorState, Input, ListSkeleton, PageTitle, Select } from '@/components/ui';

export default function Books() {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const list = useInfiniteQuery({
    queryKey: ['books', q, group],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: '20' });
      if (q.trim()) p.set('q', q.trim());
      if (group) p.set('groupType', group);
      if (pageParam) p.set('cursor', pageParam);
      return api<{ items: BookCardRow[]; nextCursor: string | null }>(`/books?${p}`);
    },
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageTitle action={<Link href="/student/my-books" className="min-h-11 py-2 text-base font-medium text-indigo-700">My books</Link>}>Book shop</PageTitle>
      <div className="mb-4 flex flex-col gap-2">
        <Input type="search" placeholder="Search title or author" aria-label="Search books" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Group" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">All groups</option>
          {GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </div>
      {list.isPending && <ListSkeleton />}
      {list.isError && <ErrorState message={errMsg(list.error)} onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && <EmptyState title="No books found" hint="Try a different search." />}
      <div className="flex flex-col gap-3">
        {items.map((b) => <BookCard key={b.id} book={b} href={`/student/books/${b.id}`} />)}
      </div>
      {list.hasNextPage && <Button variant="secondary" className="mt-4 w-full" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{list.isFetchingNextPage ? 'Loading…' : 'Show more'}</Button>}
    </>
  );
}
