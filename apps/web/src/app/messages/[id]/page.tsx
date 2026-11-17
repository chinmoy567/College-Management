'use client';

import { formatDhakaTime } from '@/lib/dhaka';
import Link from 'next/link';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getSocket, useOnConnect, useSocketEvent } from '@/lib/socket';
import { Button, Card, ErrorState, ListSkeleton } from '@/components/ui';
import { CommunityShell } from '@/components/community/CommunityShell';
import type { Me } from '@/lib/community';

interface Msg {
  id: string;
  conversationId: string;
  senderId: string;
  sender: { id: string | null; name: string };
  text: string | null;
  deleted: boolean;
  attachment: { id: string; url: string; name: string | null; mime: string } | null;
  createdAt: string;
  seenBy?: number;
  clientId?: string;
  pending?: boolean;
  failed?: boolean;
}

const time = formatDhakaTime;

function Thread({ id, me }: { id: string; me: Me }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState('');
  const [other, setOther] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  const msgsRef = useRef<Msg[]>([]);
  msgsRef.current = msgs;

  /** Newest persisted message id, for gap-filling after a reconnect. */
  const lastId = () => [...msgsRef.current].reverse().find((m) => !m.pending && !m.failed)?.id;

  const merge = useCallback((incoming: Msg[]) => {
    setMsgs((cur) => {
      const byId = new Map<string, Msg>();
      for (const m of cur) if (!m.pending || !incoming.some((i) => i.clientId && i.clientId === m.clientId)) byId.set(m.id, m);
      for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m });
      return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const after = lastId();
      const r = await api<{ items: Msg[] }>(`/chat/conversations/${id}/messages?limit=50${after ? `&after=${after}` : ''}`);
      merge(r.items);
      setState('ready');
    } catch {
      setState((s) => (s === 'ready' ? s : 'error'));
    }
  }, [id, merge]);
  useOnConnect(() => void load()); // first load and every reconnect (07 §1)

  useEffect(() => {
    api<{ items: { id: string; title: string }[] }>('/chat/conversations?limit=50').then((r) => setOther(r.items.find((c) => c.id === id)?.title ?? null)).catch(() => {});
  }, [id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [msgs.length]);

  const markRead = useCallback(() => {
    const m = [...msgsRef.current].reverse().find((x) => !x.pending && !x.failed);
    if (m) getSocket().emit('msg:read', { conversationId: id, messageId: m.id });
  }, [id]);
  useEffect(() => {
    if (state === 'ready') markRead();
  }, [state, msgs.length, markRead]);

  useSocketEvent<Msg>('msg:new', (m) => {
    if (m.conversationId !== id) return;
    merge([m]);
    setTyping(false);
  });
  useSocketEvent<{ id: string; conversationId: string }>('msg:deleted', (p) => {
    if (p.conversationId === id) setMsgs((c) => c.map((m) => (m.id === p.id ? { ...m, deleted: true, text: null, attachment: null } : m)));
  });
  useSocketEvent<{ conversationId: string; userId: string; createdAt: string }>('msg:read', (p) => {
    if (p.conversationId !== id || p.userId === me.id) return;
    // "Seen" compares createdAt, not ids: every one of my messages at or before the read one gains a viewer.
    setMsgs((c) => c.map((m) => (m.senderId === me.id && m.createdAt <= p.createdAt && !m.pending ? { ...m, seenBy: Math.max(m.seenBy ?? 0, 1) } : m)));
    void load();
  });
  useSocketEvent<{ conversationId: string; userId: string }>('msg:typing', (p) => {
    if (p.conversationId !== id) return;
    setTyping(true);
    window.setTimeout(() => setTyping(false), 3500);
  });

  const send = (clientId: string, body: string) => {
    getSocket().timeout(8000).emit('msg:send', { conversationId: id, clientId, text: body }, (err: Error | null, r: { ok: boolean; message?: Msg; code?: string; message_?: string }) => {
      if (err || !r?.ok || !r.message) {
        const code = (r as { code?: string } | undefined)?.code;
        setMsgs((c) => c.map((m) => (m.clientId === clientId ? { ...m, pending: false, failed: true } : m)));
        setError(code === 'BLOCKED_WORD' ? 'This message contains a blocked word.' : code === 'MUTED' ? 'You are muted and cannot post right now.' : code === 'BLOCKED' ? 'You cannot message this person.' : 'Message not sent.');
        return;
      }
      setError('');
      merge([r.message]);
    });
  };
  const submit = () => {
    const body = text.trim();
    if (!body) return;
    const clientId = crypto.randomUUID();
    setText('');
    setMsgs((c) => [...c, { id: `tmp-${clientId}`, conversationId: id, senderId: me.id, sender: { id: me.id, name: me.name }, text: body, deleted: false, attachment: null, createdAt: new Date().toISOString(), clientId, pending: true }]);
    send(clientId, body);
  };
  const onType = (v: string) => {
    setText(v);
    const t = Date.now();
    if (t - lastTyping.current > 3000) {
      lastTyping.current = t;
      getSocket().emit('msg:typing', { conversationId: id });
    }
  };
  const remove = async (mid: string) => {
    try {
      await api(`/chat/messages/${mid}`, { method: 'DELETE' });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete.');
    }
  };
  const report = async (mid: string) => {
    try {
      await api('/reports', { method: 'POST', json: { targetType: 'message', targetId: mid, reason: 'inappropriate' } });
      setError('Reported. The Admin will review it.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not report.');
    }
  };
  const block = async (uid: string | null) => {
    if (!uid) return;
    try {
      await api('/chat/blocks', { method: 'POST', json: { userId: uid } });
      setError('Blocked. You will not see their messages.');
      void load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not block.');
    }
  };
  const attach = async (f: File | undefined) => {
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    try {
      const up = await fetch('/api/files/chat', { method: 'POST', body: fd, headers: { 'X-Requested-With': 'cms' }, credentials: 'same-origin' });
      const j = (await up.json()) as { id?: string; error?: { message: string } };
      if (!up.ok || !j.id) throw new Error(j.error?.message ?? 'Upload failed.');
      const m = await api<Msg>(`/chat/conversations/${id}/messages`, { method: 'POST', json: { attachmentId: j.id, clientId: crypto.randomUUID() } });
      merge([m]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    }
  };

  if (state === 'loading') return <ListSkeleton />;
  if (state === 'error') return <ErrorState message="Could not open this chat." onRetry={() => void load()} />;
  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Link href="/messages" className="min-h-11 content-center text-base font-medium text-indigo-700">← Chats</Link>
        <h1 className="truncate text-lg font-semibold">{other ?? 'Chat'}</h1>
      </div>
      <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="thread">
        {msgs.length === 0 && <p className="text-center text-base text-slate-600">No messages yet. Say hello.</p>}
        {msgs.map((m, i) => {
          const mine = m.senderId === me.id;
          const lastMine = mine && i === msgs.map((x) => x.senderId === me.id).lastIndexOf(true);
          return (
            <div key={m.id} className={`mb-2 flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
              <Card className={`max-w-[85%] px-3 py-2 ${mine ? 'bg-indigo-50' : ''}`} data-testid="message">
                {!mine && <p className="text-sm font-semibold text-slate-700">{m.sender.name}</p>}
                {m.deleted ? (
                  <p className="text-base italic text-slate-500">Message deleted</p>
                ) : (
                  <>
                    {m.text && <p className="whitespace-pre-wrap break-words text-base">{m.text}</p>}
                    {m.attachment && (
                      m.attachment.mime.startsWith('image/') ? (
                        <img src={m.attachment.url} alt="Attachment" className="mt-1 max-h-60 rounded-lg" />
                      ) : (
                        <a href={m.attachment.url} className="text-base text-indigo-700 underline" target="_blank" rel="noreferrer">{m.attachment.name ?? 'PDF'}</a>
                      )
                    )}
                  </>
                )}
                <p className="mt-1 text-sm text-slate-500">
                  {time(m.createdAt)}
                  {m.pending && ' · Sending…'}
                  {m.failed && ' · Failed'}
                </p>
              </Card>
              {lastMine && !m.pending && !m.deleted && m.seenBy !== undefined && m.seenBy > 0 && (
                <span data-testid="seen" className="text-sm text-slate-500">{m.seenBy > 1 ? `Seen by ${m.seenBy}` : 'Seen'}</span>
              )}
              {!m.pending && !m.deleted && (
                <details className="text-sm text-slate-500">
                  <summary className="flex min-h-11 cursor-pointer items-center">More</summary>
                  <div className="flex gap-2 pb-1">
                    {mine ? (
                      <Button variant="ghost" onClick={() => void remove(m.id)}>Delete</Button>
                    ) : (
                      <>
                        <Button variant="ghost" onClick={() => void report(m.id)}>Report</Button>
                        <Button variant="ghost" onClick={() => void block(m.sender.id)}>Block</Button>
                      </>
                    )}
                  </div>
                </details>
              )}
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <p className="h-6 text-sm text-slate-500" data-testid="typing" aria-live="polite">{typing ? 'Typing…' : ''}</p>
      {error && <p role="alert" className="pb-1 text-base text-red-700">{error}</p>}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="flex min-h-11 cursor-pointer items-center rounded-lg bg-slate-100 px-3 text-base">
          <span aria-hidden>📎</span><span className="sr-only">Attach a file</span>
          <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => void attach(e.target.files?.[0])} />
        </label>
        <input
          aria-label="Message"
          value={text}
          maxLength={4000}
          onChange={(e) => onType(e.target.value)}
          placeholder="Write a message"
          className="min-h-11 flex-1 rounded-lg border border-slate-300 px-3 text-base"
        />
        <Button type="submit">Send</Button>
      </form>
    </div>
  );
}

export default function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CommunityShell>{(me) => <Thread id={id} me={me} />}</CommunityShell>;
}

