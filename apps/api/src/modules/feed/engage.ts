import { Router } from 'express';
import { z } from 'zod';
import { commentCreateBody, commentPatchBody, cursorQuery, id, reactionBody } from '@cms/shared';
import { prisma } from '../../db';
import { containsBanned } from '../../lib/bannedWords';
import { now } from '../../lib/clock';
import { softDeleteObjects } from '../../lib/files';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { assertNotMuted } from '../../lib/mute';
import { notify } from '../../lib/notify';
import { decodeCursor, encodeCursor } from '../../lib/pagination';
import type { Actor } from '../../lib/permissions';
import { NOT_FOUND, actorOf, canSeeContent, commentSelect, mediaUpload, serializeComments, storeAll, uploadsOf, visibleWhere } from './common';
import { removeContent } from './moderation';
import { notifyComment } from './notices';

export const engageRouter = Router();
const idParam = z.object({ id });
const REACTION_NOTICE_GAP_MS = 10 * 60_000;

// ───── reactions (06 §4) ─────
async function notifyReaction(actor: Actor, post: { id: string; authorId: string }): Promise<void> {
  if (post.authorId === actor.id) return;
  const since = new Date(now().getTime() - REACTION_NOTICE_GAP_MS);
  // At most one reaction notification per post per 10 minutes.
  const recent = await prisma.notification.findFirst({
    where: { userId: post.authorId, type: 'reaction', refType: 'post', refId: post.id, createdAt: { gt: since } },
    select: { id: true },
  });
  if (!recent) await notify([post.authorId], 'reaction', { type: 'post', id: post.id }, 'Someone reacted to your post.');
}

engageRouter.put(
  '/posts/:id/reaction',
  validate({ params: idParam, body: reactionBody }),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const pid = (req.params as { id: string }).id;
    const { type } = req.body as { type: 'like' };
    const post = await prisma.post.findFirst({ where: { id: pid, status: 'published' }, select: { id: true, authorId: true } });
    if (!post) throw NOT_FOUND();
    await prisma.reaction.upsert({
      where: { userId_postId: { userId: actor.id, postId: pid } },
      create: { userId: actor.id, postId: pid, type },
      update: { type },
    });
    await notifyReaction(actor, post);
    res.json({ ok: true, type });
  }),
);
engageRouter.delete(
  '/posts/:id/reaction',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await prisma.reaction.deleteMany({ where: { userId: actorOf(req).id, postId: (req.params as { id: string }).id } });
    res.json({ ok: true });
  }),
);
engageRouter.put(
  '/comments/:id/reaction',
  validate({ params: idParam, body: reactionBody }),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const cid = (req.params as { id: string }).id;
    const { type } = req.body as { type: 'like' };
    if (!(await prisma.comment.findFirst({ where: { id: cid, status: 'published', post: { status: 'published' } }, select: { id: true } }))) throw NOT_FOUND();
    await prisma.reaction.upsert({
      where: { userId_commentId: { userId: actor.id, commentId: cid } },
      create: { userId: actor.id, commentId: cid, type },
      update: { type },
    });
    res.json({ ok: true, type });
  }),
);
engageRouter.delete(
  '/comments/:id/reaction',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await prisma.reaction.deleteMany({ where: { userId: actorOf(req).id, commentId: (req.params as { id: string }).id } });
    res.json({ ok: true });
  }),
);

// ───── comments ─────
/** Top-level comments oldest first, each with its first 3 replies. */
export async function listComments(actor: Actor, postId: string, o: { cursor?: string; limit: number }) {
  const cur = decodeCursor(o.cursor);
  const rows = await prisma.comment.findMany({
    where: {
      postId,
      parentCommentId: null,
      AND: [
        visibleWhere(actor),
        ...(cur ? [{ OR: [{ createdAt: { gt: new Date(cur.createdAt) } }, { createdAt: new Date(cur.createdAt), id: { gt: cur.id } }] }] : []),
      ],
    },
    ...commentSelect,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: o.limit + 1,
  });
  const page = rows.slice(0, o.limit);
  const ids = page.map((c) => c.id);
  const [replyRows, replyCountGroups] = await Promise.all([
    prisma.comment.findMany({
      where: { parentCommentId: { in: ids }, ...visibleWhere(actor) },
      ...commentSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: Math.min(ids.length * 3 * 4, 400),
    }),
    prisma.comment.groupBy({ by: ['parentCommentId'], where: { parentCommentId: { in: ids }, status: 'published' }, _count: { _all: true } }),
  ]);
  const counts = new Map(replyCountGroups.map((g) => [g.parentCommentId!, g._count._all]));
  const firstThree = new Map<string, typeof replyRows>();
  for (const r of replyRows) {
    const l = firstThree.get(r.parentCommentId!) ?? [];
    if (l.length < 3) firstThree.set(r.parentCommentId!, [...l, r]);
  }
  const all = await serializeComments(actor, [...page, ...[...firstThree.values()].flat()], counts);
  const byId = new Map(all.map((c) => [c.id, c]));
  const last = page[page.length - 1];
  return {
    items: page.map((c) => ({ ...byId.get(c.id)!, replies: (firstThree.get(c.id) ?? []).map((r) => byId.get(r.id)!) })),
    nextCursor: rows.length > o.limit && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
  };
}

engageRouter.get(
  '/posts/:id/comments',
  validate({ params: idParam, query: cursorQuery }),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const pid = (req.params as { id: string }).id;
    const post = await prisma.post.findUnique({ where: { id: pid }, select: { status: true, authorId: true } });
    if (!post || !canSeeContent(actor, post)) throw NOT_FOUND();
    const q = req.query as unknown as { cursor?: string; limit: number };
    res.json(await listComments(actor, pid, q));
  }),
);

engageRouter.get(
  '/comments/:id/replies',
  validate({ params: idParam, query: cursorQuery }),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const cid = (req.params as { id: string }).id;
    const q = req.query as unknown as { cursor?: string; limit: number };
    const parent = await prisma.comment.findFirst({ where: { id: cid, parentCommentId: null, status: 'published', post: { status: 'published' } }, select: { id: true } });
    if (!parent) throw NOT_FOUND();
    const cur = decodeCursor(q.cursor);
    const rows = await prisma.comment.findMany({
      where: {
        parentCommentId: cid,
        AND: [visibleWhere(actor), ...(cur ? [{ OR: [{ createdAt: { gt: new Date(cur.createdAt) } }, { createdAt: new Date(cur.createdAt), id: { gt: cur.id } }] }] : [])],
      },
      ...commentSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    res.json({
      items: await serializeComments(actor, page),
      nextCursor: rows.length > q.limit && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
    });
  }),
);

engageRouter.post(
  '/posts/:id/comments',
  mediaUpload,
  validate({ params: idParam, body: commentCreateBody }),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const pid = (req.params as { id: string }).id;
    const b = req.body as z.infer<typeof commentCreateBody>;
    const up = uploadsOf(req);
    const post = await prisma.post.findFirst({ where: { id: pid, status: 'published' }, select: { id: true } });
    if (!post) throw NOT_FOUND();
    if (b.parentCommentId) {
      // One level of replies: the parent must be a published top-level comment of this post (COMM-07).
      const parent = await prisma.comment.findFirst({ where: { id: b.parentCommentId, postId: pid, parentCommentId: null, status: 'published' }, select: { id: true } });
      if (!parent) throw new AppError('VALIDATION_ERROR', 400, 'You can reply only to a top-level comment of this post.', { parentCommentId: 'Invalid' });
    }
    await assertNotMuted(actor.id);
    const held = await containsBanned(b.text, b.linkUrl);
    const files = await storeAll(actor.id, up, 'comment_image');
    const fileIds = [...files.imageIds, ...(files.pdfId ? [files.pdfId] : [])];
    const c = await prisma.comment
      .create({
        data: {
          postId: pid, authorId: actor.id, text: b.text, linkUrl: b.linkUrl ?? null, parentCommentId: b.parentCommentId ?? null,
          status: held ? 'held' : 'published', createdAt: now(),
          media: { create: fileIds.map((fileId, order) => ({ fileId, order })) },
        },
        ...commentSelect,
      })
      .catch(async (e: unknown) => {
        await softDeleteObjects(fileIds);
        throw e;
      });
    if (!held) await notifyComment(c);
    res.status(201).json((await serializeComments(actor, [c]))[0]);
  }),
);

engageRouter.patch(
  '/comments/:id',
  validate({ params: idParam, body: commentPatchBody }),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const cid = (req.params as { id: string }).id;
    const b = req.body as z.infer<typeof commentPatchBody>;
    const c = await prisma.comment.findFirst({ where: { id: cid, authorId: actor.id, status: { not: 'removed' } }, include: { media: true } });
    if (!c) throw NOT_FOUND();
    await assertNotMuted(actor.id);
    if (b.removeMediaIds.some((x) => !c.media.some((m) => m.id === x)))
      throw new AppError('VALIDATION_ERROR', 400, 'Attachment not found on this comment.', { removeMediaIds: 'Unknown' });
    const text = b.text ?? c.text;
    const linkUrl = b.linkUrl === undefined ? c.linkUrl : b.linkUrl;
    const held = c.status === 'held' || (await containsBanned(text, linkUrl));
    const drop = c.media.filter((m) => b.removeMediaIds.includes(m.id));
    const updated = await prisma.$transaction(async (tx) => {
      if (drop.length) await tx.commentMedia.deleteMany({ where: { id: { in: drop.map((m) => m.id) } } });
      await softDeleteObjects(drop.map((m) => m.fileId), tx);
      return tx.comment.update({ where: { id: cid }, data: { text, linkUrl, editedAt: now(), status: held ? 'held' : 'published' }, ...commentSelect });
    });
    res.json((await serializeComments(actor, [updated]))[0]);
  }),
);

engageRouter.delete(
  '/comments/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const cid = (req.params as { id: string }).id;
    const c = await prisma.comment.findUnique({ where: { id: cid }, select: { authorId: true, status: true } });
    if (!c || c.status === 'removed' || (!canSeeContent(actor, c) && actor.role !== 'admin')) throw NOT_FOUND();
    if (c.authorId !== actor.id && actor.role !== 'admin') throw new AppError('FORBIDDEN', 403, 'You can only delete your own comments.');
    await removeContent({ kind: 'comment', id: cid, byId: actor.id, byAdmin: actor.role === 'admin' && c.authorId !== actor.id });
    res.json({ ok: true });
  }),
);
