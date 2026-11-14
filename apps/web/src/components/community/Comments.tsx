'use client';

import { useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MAX_IMAGES, TEXT_LIMITS, UPLOAD_LIMITS } from '@cms/shared';
import { api } from '@/lib/api';
import { errorText, type CommentData, type Me } from '@/lib/community';
import { Badge, Button, EmptyState, ErrorState, ListSkeleton } from '@/components/ui';
import { AuthorHeader, ImageGrid, Linkified, ReactionBar, ReportButton } from './PostCard';

interface Page {
  items: CommentData[];
  nextCursor: string | null;
}

function CommentRow({ c, viewer, onReply, reply }: { c: CommentData; viewer: Me; onReply?: () => void; reply?: boolean }) {
  const qc = useQueryClient();
  const [counts, setCounts] = useState(c.reactionCounts);
  const [mine, setMine] = useState(c.myReaction);
  const own = viewer.id === c.author.id;
  const del = useMutation({
    mutationFn: () => api(`/feed/comments/${c.id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['comments', c.postId] }),
  });
  return (
    <div className={`flex flex-col gap-2 ${reply ? 'ml-6 border-l-2 border-slate-200 pl-3' : ''}`} data-testid={reply ? 'reply' : 'comment'}>
      <AuthorHeader author={c.author} viewer={viewer} when={c.createdAt} edited={!!c.editedAt} />
      {c.status === 'held' && <Badge tone="amber">Waiting for review</Badge>}
      <Linkified text={c.text} />
      <ImageGrid media={c.media} />
      {c.pdf?.signedUrl && (
        <a href={c.pdf.signedUrl} download className="flex min-h-11 items-center rounded-lg bg-slate-100 px-3 text-base">
          📄 {c.pdf.name}
        </a>
      )}
      <ReactionBar
        kind="comments"
        id={c.id}
        counts={counts}
        mine={mine}
        onChange={(a, b) => {
          setCounts(a);
          setMine(b);
        }}
      />
      <div className="flex flex-wrap items-center gap-1">
        {onReply && (
          <Button variant="ghost" onClick={onReply}>
            Reply
          </Button>
        )}
        {!own && <ReportButton targetType="comment" targetId={c.id} />}
        {(own || viewer.role === 'admin') && (
          <Button variant="ghost" className="text-red-700" disabled={del.isPending} onClick={() => del.mutate()}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

function Thread({ c, viewer, onReply }: { c: CommentData; viewer: Me; onReply: () => void }) {
  const [extra, setExtra] = useState<CommentData[] | null>(null);
  const shown = extra ?? c.replies ?? [];
  const remaining = c.replyCount - shown.filter((r) => r.status === 'published').length;
  return (
    <div className="flex flex-col gap-3">
      <CommentRow c={c} viewer={viewer} onReply={onReply} />
      {shown.map((r) => (
        <CommentRow key={r.id} c={r} viewer={viewer} reply />
      ))}
      {remaining > 0 && (
        <Button variant="ghost" className="ml-6 self-start" onClick={async () => setExtra((await api<Page>(`/feed/comments/${c.id}/replies?limit=50`)).items)}>
          Show {remaining} more {remaining === 1 ? 'reply' : 'replies'}
        </Button>
      )}
    </div>
  );
}

export function Comments({ postId, viewer }: { postId: string; viewer: Me }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [parent, setParent] = useState<CommentData | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [problem, setProblem] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const q = useInfiniteQuery({
    queryKey: ['comments', postId],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<Page>(`/feed/posts/${postId}/comments${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const send = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.set('text', text.trim());
      if (parent) fd.set('parentCommentId', parent.id);
      images.forEach((f) => fd.append('images', f));
      return api(`/feed/posts/${postId}/comments`, { method: 'POST', body: fd });
    },
    onSuccess: () => {
      setText('');
      setImages([]);
      setParent(null);
      setProblem('');
      void qc.invalidateQueries({ queryKey: ['comments', postId] });
    },
    onError: (e) => setProblem(errorText(e)),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section aria-label="Comments" className="flex flex-col gap-4">
      {q.isPending && <ListSkeleton rows={2} />}
      {q.isError && <ErrorState onRetry={() => void q.refetch()} />}
      {q.isSuccess && items.length === 0 && <EmptyState title="No comments yet" hint="Be the first to write one." />}
      {items.map((c) => (
        <Thread key={c.id} c={c} viewer={viewer} onReply={() => setParent(c)} />
      ))}
      {q.hasNextPage && (
        <Button variant="secondary" onClick={() => void q.fetchNextPage()}>
          Show more comments
        </Button>
      )}
      <form
        className="sticky bottom-0 flex flex-col gap-2 border-t border-slate-200 bg-white pb-2 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send.mutate();
        }}
      >
        {parent && (
          <p className="text-sm text-slate-600">
            Replying to {parent.author.name}{' '}
            <button type="button" className="min-h-11 px-2 text-indigo-700 underline" onClick={() => setParent(null)}>
              Cancel
            </button>
          </p>
        )}
        <textarea aria-label="Write a comment" value={text} maxLength={TEXT_LIMITS.comment} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Write a comment" className="w-full rounded-lg border border-slate-300 p-3 text-base" />
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.some((f) => f.size > UPLOAD_LIMITS.imageBytes)) return setProblem('Pictures must be at most 5 MB each.');
            if (images.length + files.length > MAX_IMAGES) return setProblem(`At most ${MAX_IMAGES} pictures.`);
            setProblem('');
            setImages([...images, ...files]);
          }}
        />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            Picture ({images.length})
          </Button>
          <Button type="submit" className="flex-1" disabled={send.isPending || !text.trim()}>
            Send
          </Button>
        </div>
        {problem && (
          <p role="alert" className="text-base text-red-700">
            {problem}
          </p>
        )}
      </form>
    </section>
  );
}
