'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { REACTIONS, errorText, profileHref, timeAgo, type Author, type Me, type PostData } from '@/lib/community';
import { Badge, Button, Card, Field, Select, Sheet } from '@/components/ui';
import { watchPinned } from './seenTracker';

export function AuthorHeader({ author, viewer, when, edited }: { author: Author; viewer?: Me; when: string; edited?: boolean }) {
  const href = profileHref(author, viewer);
  const inner = (
    <>
      {author.avatarUrl ? (
        <img src={author.avatarUrl} alt="" className="size-11 shrink-0 rounded-full object-cover" loading="lazy" />
      ) : (
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-lg font-semibold text-indigo-700">
          {author.name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-base font-semibold text-slate-900">{author.name}</span>
        {author.line && <span className="block truncate text-sm text-slate-600">{author.line}</span>}
      </span>
    </>
  );
  return (
    <div className="flex items-center gap-3">
      {href ? (
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-3" data-testid="author-link">
          {inner}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{inner}</div>
      )}
      <span className="shrink-0 text-right text-sm text-slate-500">
        {timeAgo(when)}
        {edited && <span className="block">edited</span>}
      </span>
    </div>
  );
}

export function ImageGrid({ media }: { media: { id: string; signedUrl: string | null }[] }) {
  const shown = media.filter((m) => m.signedUrl);
  if (shown.length === 0) return null;
  return (
    <div className={`grid gap-1 ${shown.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
      {shown.map((m) => (
        <img key={m.id} src={m.signedUrl!} alt="Attached picture" loading="lazy" className="aspect-[4/3] w-full rounded-lg bg-slate-100 object-cover" />
      ))}
    </div>
  );
}

/** Links in plain text are rendered as safe anchors; everything else stays escaped text. */
export function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p className="whitespace-pre-wrap break-words text-base text-slate-900">
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" className="text-indigo-700 underline">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </p>
  );
}

export function ReactionBar({ kind, id, counts, mine, onChange }: { kind: 'posts' | 'comments'; id: string; counts: Record<string, number>; mine: string | null; onChange: (counts: Record<string, number>, mine: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const m = useMutation({
    mutationFn: (type: string | null) => (type ? api(`/feed/${kind}/${id}/reaction`, { method: 'PUT', json: { type } }) : api(`/feed/${kind}/${id}/reaction`, { method: 'DELETE' })),
  });
  const pick = (type: string) => {
    const next = { ...counts };
    if (mine) next[mine] = Math.max(0, (next[mine] ?? 1) - 1);
    const removing = mine === type;
    if (!removing) next[type] = (next[type] ?? 0) + 1;
    onChange(next, removing ? null : type);
    m.mutate(removing ? null : type);
    setOpen(false);
  };
  const top = REACTIONS.filter((r) => (counts[r.type] ?? 0) > 0).sort((a, b) => (counts[b.type] ?? 0) - (counts[a.type] ?? 0));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant={mine ? 'primary' : 'secondary'} aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="react-btn">
        {mine ? REACTIONS.find((r) => r.type === mine)?.emoji : '👍'} {mine ? 'Reacted' : 'React'}
      </Button>
      {total > 0 && (
        <span className="text-base text-slate-700" aria-label={`${total} reactions`}>
          {top.slice(0, 3).map((r) => r.emoji).join('')} {total}
        </span>
      )}
      {open && (
        <div role="group" aria-label="Choose a reaction" className="flex w-full gap-1">
          {REACTIONS.map((r) => (
            <button key={r.type} type="button" aria-label={r.label} aria-pressed={mine === r.type} onClick={() => pick(r.type)} className={`flex min-h-11 flex-1 items-center justify-center rounded-lg text-xl ${mine === r.type ? 'bg-indigo-100' : 'bg-slate-100'}`}>
              {r.emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReportButton({ targetType, targetId }: { targetType: 'post' | 'comment' | 'user'; targetId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('spam');
  const [text, setText] = useState('');
  const [done, setDone] = useState('');
  const m = useMutation({
    mutationFn: () => api('/reports', { method: 'POST', json: { targetType, targetId, reason, ...(text.trim() ? { text: text.trim() } : {}) } }),
    onSuccess: () => {
      setDone('Thank you. The Admin will review it.');
      setOpen(false);
    },
    onError: (e) => setDone(e instanceof Error && 'status' in e && (e as { status: number }).status === 409 ? 'You already reported this.' : errorText(e)),
  });
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Report
      </Button>
      {done && (
        <span role="status" className="text-sm text-slate-600">
          {done}
        </span>
      )}
      <Sheet open={open} title="Report" onClose={() => setOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <Field label="Reason">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="spam">Spam</option>
              <option value="harassment">Harassment</option>
              <option value="inappropriate">Inappropriate</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Details (optional)">
            <textarea value={text} maxLength={500} onChange={(e) => setText(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 p-3 text-base" />
          </Field>
          <Button type="submit" disabled={m.isPending}>
            Send report
          </Button>
        </form>
      </Sheet>
    </>
  );
}

export function PostCard({ post, viewer, seen, detail }: { post: PostData; viewer?: Me; /** watch this card for the 50% / 1 s rule (pinned cards only) */ seen?: boolean; detail?: boolean }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);
  const [counts, setCounts] = useState(post.reactionCounts);
  const [mine, setMine] = useState(post.myReaction);
  const [gone, setGone] = useState(false);
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!seen || !ref.current) return;
    return watchPinned(ref.current, post.id);
  }, [seen, post.id]);
  const del = useMutation({
    mutationFn: () => api(`/feed/posts/${post.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setGone(true);
      void qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });
  if (gone) return null;
  const own = viewer?.id === post.author.id;
  const canDelete = own || viewer?.role === 'admin';
  const canUnpin = viewer?.role === 'admin' && !!post.pin;
  return (
    <Card className="flex flex-col gap-3" data-testid={seen ? 'pinned-card' : 'post-card'} data-post-id={post.id}>
      <div ref={ref} className="flex flex-col gap-3" data-post-body={post.id}>
        {post.pin && (
          <div>
            <Badge tone="amber">{post.pin.badge}</Badge>
          </div>
        )}
        <AuthorHeader author={post.author} viewer={viewer} when={post.createdAt} edited={!!post.editedAt} />
        {post.status === 'held' && <Badge tone="amber">Waiting for review</Badge>}
        {post.tag !== 'general' && (
          <div>
            <Badge tone="slate">{post.tag === 'problem' ? 'Problem / Need Help' : post.tag.charAt(0).toUpperCase() + post.tag.slice(1)}</Badge>
          </div>
        )}
        <Linkified text={post.text} />
        {post.link && (
          <a href={post.link} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-base text-indigo-700 underline">
            {post.link}
          </a>
        )}
        <ImageGrid media={post.media} />
        {post.pdf?.signedUrl && (
          <a href={post.pdf.signedUrl} className="flex min-h-11 items-center rounded-lg bg-slate-100 px-3 text-base text-slate-900" download>
            📄 {post.pdf.name}
          </a>
        )}
      </div>
      <ReactionBar kind="posts" id={post.id} counts={counts} mine={mine} onChange={(c, m) => (setCounts(c), setMine(m))} />
      <div className="flex flex-wrap items-center gap-1">
        {!detail && (
          <Link href={`/feed/posts/${post.id}`} className="flex min-h-11 items-center rounded-lg px-3 text-base font-medium text-indigo-700 hover:bg-indigo-50">
            💬 {post.commentCount} {post.commentCount === 1 ? 'comment' : 'comments'}
          </Link>
        )}
        {!own && <ReportButton targetType="post" targetId={post.id} />}
        {canUnpin && (
          <Button variant="ghost" onClick={() => void api(`/feed/posts/${post.id}/unpin`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['feed'] }))}>
            Unpin
          </Button>
        )}
        {canDelete && (
          <Button variant="ghost" className="text-red-700" disabled={del.isPending} onClick={() => (sure ? del.mutate() : setSure(true))}>
            {sure ? 'Tap again to delete' : 'Delete'}
          </Button>
        )}
      </div>
    </Card>
  );
}
