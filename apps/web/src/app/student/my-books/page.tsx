'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import type { MyBookRow } from '@/lib/books';
import { BookCard } from '@/components/books/BookCard';
import { EmptyState, ErrorState, ListSkeleton, PageTitle } from '@/components/ui';

export default function MyBooks() {
  const q = useQuery({ queryKey: ['my-books'], queryFn: () => api<{ items: MyBookRow[] }>('/books/mine') });
  return (
    <>
      <PageTitle>My books</PageTitle>
      {q.isPending && <ListSkeleton />}
      {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && q.data.items.length === 0 && <EmptyState title="No books yet" hint="Unlock a book in the shop and it will appear here." action={<Link href="/student/books" className="min-h-11 py-2 text-base font-medium text-indigo-700">Go to the book shop</Link>} />}
      <div className="flex flex-col gap-3">
        {q.data?.items.map((b) => <BookCard key={b.id} book={b} href={`/student/books/${b.id}/read`} />)}
      </div>
    </>
  );
}
