'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import { taka, type BookDetails } from '@/lib/books';
import { Reader } from '@/components/books/Reader';
import { Badge, Button, Card, ErrorState, ListSkeleton, PageTitle, Sheet } from '@/components/ui';

export default function Book() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState(false);
  const q = useQuery({ queryKey: ['book', id], queryFn: () => api<BookDetails>(`/books/${id}`) });
  const pay = useMutation({
    mutationFn: () => api(`/books/${id}/pay`, { method: 'POST', json: { confirm: true } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['books'] });
      await qc.invalidateQueries({ queryKey: ['book', id] });
      await qc.invalidateQueries({ queryKey: ['my-books'] });
      router.push(`/student/books/${id}/read`);
    },
  });
  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />;
  const b = q.data;
  return (
    <>
      <PageTitle>{b.title}</PageTitle>
      <Card className="flex flex-col gap-3">
        <div className="flex gap-3">
          {b.coverUrl ? <img src={b.coverUrl} alt={`Cover of ${b.title}`} className="h-40 w-28 shrink-0 rounded-md object-cover" /> : <div aria-hidden className="h-40 w-28 shrink-0 rounded-md bg-slate-200" />}
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-base text-slate-700">by {b.author}</p>
            {b.publisher && <p className="text-base text-slate-600">{b.publisher}</p>}
            {b.course && <p className="text-base text-slate-600">{b.course}</p>}
            <p className="mt-auto text-xl font-semibold">{b.unlocked ? <Badge tone="green">Unlocked</Badge> : taka(b.price)}</p>
          </div>
        </div>
        {b.description && <p className="whitespace-pre-wrap text-base text-slate-800">{b.description}</p>}
        <div className="flex flex-col gap-2">
          {b.unlocked ? (
            <Link href={`/student/books/${id}/read`} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-indigo-600 px-4 text-base font-medium text-white">Read the book</Link>
          ) : (
            <Button onClick={() => setConfirm(true)}>Pay {taka(b.price)} to unlock</Button>
          )}
          {!b.unlocked && b.previewUrl && <Button variant="secondary" onClick={() => setPreview((v) => !v)}>{preview ? 'Hide preview' : 'Read a free preview'}</Button>}
        </div>
      </Card>
      {preview && b.previewUrl && <div className="mt-4"><Reader url={b.previewUrl} title={`${b.title} preview`} /></div>}
      <Sheet open={confirm} title="Unlock this book" onClose={() => setConfirm(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-base">You are unlocking <strong>{b.title}</strong> for {taka(b.price)}.</p>
          <p className="text-base text-slate-600">No money is taken in this version of the app. The book is added to My Books.</p>
          {pay.isError && <p role="alert" className="text-base text-red-700">{errMsg(pay.error)}</p>}
          <Button disabled={pay.isPending} onClick={() => pay.mutate()}>{pay.isPending ? 'Unlocking…' : 'Confirm'}</Button>
          <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
        </div>
      </Sheet>
    </>
  );
}
