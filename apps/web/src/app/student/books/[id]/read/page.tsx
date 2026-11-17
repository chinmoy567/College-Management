'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { Reader } from '@/components/books/Reader';
import { ErrorState, ListSkeleton, PageTitle } from '@/components/ui';

/** The full book: the API issues a 5-minute signed URL only when this student has unlocked it. */
export default function Read() {
  const { id } = useParams<{ id: string }>();
  const book = useQuery({ queryKey: ['book', id], queryFn: () => api<{ title: string }>(`/books/${id}`) });
  const url = useQuery({ queryKey: ['book-pdf', id], queryFn: () => api<{ url: string }>(`/books/${id}/pdf`), staleTime: 4 * 60_000 });
  const download = async () => {
    const d = await api<{ url: string }>(`/books/${id}/pdf?download=1`);
    window.location.assign(d.url);
  };
  if (url.isPending || book.isPending) return <ListSkeleton />;
  if (url.isError && url.error instanceof Error && /not been uploaded/i.test(url.error.message))
    return (<><PageTitle>{book.data?.title ?? 'Book'}</PageTitle><p className="text-base text-slate-700">This book is yours. The PDF has not been uploaded yet; it will appear here as soon as it is added.</p><Link href="/student/my-books" className="mt-4 inline-flex min-h-11 items-center text-base font-medium text-indigo-700">Back to My books</Link></>);
  if (url.isError) return <ErrorState message={errMsg(url.error)} onRetry={() => void url.refetch()} />;
  const title = book.data?.title ?? 'Book';
  return (
    <>
      <PageTitle action={<button type="button" onClick={() => void download()} className="min-h-11 px-2 text-base font-medium text-indigo-700">Download</button>}>{title}</PageTitle>
      <Reader url={url.data.url} title={title} />
      <Link href="/student/my-books" className="mt-4 inline-flex min-h-11 items-center text-base font-medium text-indigo-700">Back to My books</Link>
    </>
  );
}
