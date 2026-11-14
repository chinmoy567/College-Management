'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AI_DISCLAIMER } from '@cms/shared';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import type { AiConversation } from '@/lib/books';
import { fmtDateTime } from '@/lib/exams';
import { Button, Card, EmptyState, ErrorState, ListSkeleton, PageTitle, Sheet } from '@/components/ui';

export default function AiHome() {
  const router = useRouter();
  const qc = useQueryClient();
  const [del, setDel] = useState<AiConversation | null>(null);
  const list = useQuery({ queryKey: ['ai-conversations'], queryFn: () => api<{ items: AiConversation[] }>('/ai/conversations') });
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: () => api<{ usedToday: number; limit: number }>('/ai/usage/me') });
  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/ai/conversations', { method: 'POST', json: {} }),
    onSuccess: (c) => router.push(`/student/ai/${c.id}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/ai/conversations/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setDel(null);
      await qc.invalidateQueries({ queryKey: ['ai-conversations'] });
    },
  });
  return (
    <>
      <PageTitle>AI study helper</PageTitle>
      <p data-testid="ai-disclaimer" className="mb-3 rounded-lg bg-amber-50 p-3 text-base text-amber-900">{AI_DISCLAIMER}</p>
      <div className="mb-4 flex items-center justify-between gap-3">
        {usage.data && <span className="text-base text-slate-600">{usage.data.usedToday} of {usage.data.limit} messages used today</span>}
        <Button disabled={create.isPending} onClick={() => create.mutate()}>New chat</Button>
      </div>
      {create.isError && <p role="alert" className="mb-2 text-base text-red-700">{errMsg(create.error)}</p>}
      {list.isPending && <ListSkeleton />}
      {list.isError && <ErrorState message={errMsg(list.error)} onRetry={() => void list.refetch()} />}
      {list.data && list.data.items.length === 0 && <EmptyState title="No chats yet" hint="Ask a question about your lessons, math or writing." />}
      <div className="flex flex-col gap-3">
        {list.data?.items.map((c) => (
          <Card key={c.id} data-testid={`chat-${c.id}`} className="flex items-center justify-between gap-2">
            <Link href={`/student/ai/${c.id}`} className="min-w-0 flex-1 py-1">
              <p className="truncate text-lg font-semibold">{c.title}</p>
              <p className="text-sm text-slate-500">{fmtDateTime(c.updatedAt)}</p>
            </Link>
            <Button variant="ghost" aria-label={`Delete chat ${c.title}`} onClick={() => setDel(c)}>Delete</Button>
          </Card>
        ))}
      </div>
      <Sheet open={!!del} title="Delete this chat?" onClose={() => setDel(null)}>
        <div className="flex flex-col gap-3">
          <p className="text-base">This removes the chat and its messages for good.</p>
          {remove.isError && <p role="alert" className="text-base text-red-700">{errMsg(remove.error)}</p>}
          <Button variant="danger" disabled={remove.isPending} onClick={() => del && remove.mutate(del.id)}>Delete</Button>
          <Button variant="secondary" onClick={() => setDel(null)}>Cancel</Button>
        </div>
      </Sheet>
    </>
  );
}
