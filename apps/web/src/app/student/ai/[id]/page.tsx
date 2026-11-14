'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AI_DISCLAIMER, TEXT_LIMITS, type ApiErrorBody } from '@cms/shared';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/queries';
import type { AiMessage } from '@/lib/books';
import { LazyMarkdown } from '@/components/ai/LazyMarkdown';
import { Button, ErrorState, ListSkeleton, cn } from '@/components/ui';

/** POSTs a question and reads the text/event-stream answer (EventSource cannot POST or send the CSRF header). */
async function ask(conversationId: string, content: string, onText: (t: string) => void): Promise<void> {
  const res = await fetch(`/api/ai/conversations/${conversationId}/messages`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'cms', Accept: 'text/event-stream' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.error.message ?? 'Something went wrong. Try again.');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, end);
      buf = buf.slice(end + 2);
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      if (!data) continue;
      const parsed = JSON.parse(data) as { t?: string; message?: string };
      if (event === 'error') throw new Error(parsed.message ?? 'The AI assistant is busy, please try again later.');
      if (parsed.t) onText(parsed.t);
    }
  }
}

export default function AiChat() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [pending, setPending] = useState<{ q: string; a: string } | null>(null);
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const msgs = useQuery({ queryKey: ['ai-messages', id], queryFn: () => api<{ items: AiMessage[] }>(`/ai/conversations/${id}/messages`) });
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: () => api<{ usedToday: number; limit: number }>('/ai/usage/me') });
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [msgs.data, pending]);

  const send = async () => {
    const q = text.trim();
    if (!q || pending) return;
    setError('');
    setText('');
    setPending({ q, a: '' });
    try {
      await ask(id, q, (t) => setPending((p) => (p ? { ...p, a: p.a + t } : p)));
      await qc.invalidateQueries({ queryKey: ['ai-messages', id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : errMsg(e));
      setText(q);
    } finally {
      setPending(null);
      void qc.invalidateQueries({ queryKey: ['ai-usage'] });
      void qc.invalidateQueries({ queryKey: ['ai-conversations'] });
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Link href="/student/ai" className="inline-flex min-h-11 items-center text-base font-medium text-indigo-700">All chats</Link>
        {usage.data && <span data-testid="ai-usage" className="text-sm text-slate-600">{usage.data.usedToday} of {usage.data.limit} used today</span>}
      </div>
      <p data-testid="ai-disclaimer" className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{AI_DISCLAIMER}</p>
      {msgs.isPending && <ListSkeleton rows={2} />}
      {msgs.isError && <ErrorState message={errMsg(msgs.error)} onRetry={() => void msgs.refetch()} />}
      <div className="flex flex-1 flex-col gap-3" aria-live="polite">
        {msgs.data?.items.map((m) => <Bubble key={m.id} role={m.role} text={m.content} />)}
        {pending && (
          <>
            <Bubble role="user" text={pending.q} />
            <Bubble role="assistant" text={pending.a} streaming />
          </>
        )}
        <div ref={bottom} />
      </div>
      {error && <p role="alert" className="text-base text-red-700">{error}</p>}
      <form
        className="sticky bottom-2 flex items-end gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="Your question"
          value={text}
          maxLength={TEXT_LIMITS.aiPrompt}
          rows={2}
          placeholder="Ask a study question"
          onChange={(e) => setText(e.target.value)}
          className="min-h-11 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
        <Button type="submit" disabled={!text.trim() || !!pending}>{pending ? 'Wait…' : 'Send'}</Button>
      </form>
    </div>
  );
}

function Bubble({ role, text, streaming }: { role: 'user' | 'assistant'; text: string; streaming?: boolean }) {
  const mine = role === 'user';
  return (
    <div data-testid={mine ? 'msg-user' : 'msg-ai'} className={cn('max-w-[92%] rounded-2xl px-3 py-2', mine ? 'self-end bg-indigo-600 text-white' : 'self-start border border-slate-200 bg-white')}>
      {mine ? <p className="whitespace-pre-wrap break-words text-base">{text}</p> : text ? <LazyMarkdown>{text}</LazyMarkdown> : <p className="text-base text-slate-500">{streaming ? 'Thinking…' : ''}</p>}
    </div>
  );
}
