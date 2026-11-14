import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { feedQuery, id, seenBody } from '@cms/shared';
import { prisma } from '../../db';
import { now } from '../../lib/clock';
import { asyncHandler, validate } from '../../lib/http';
import { decodeCursor, encodeCursor } from '../../lib/pagination';
import type { Actor } from '../../lib/permissions';
import { NOT_FOUND, actorOf, canSeeContent, postSelect, serializePosts, visibleWhere, type PostRow } from './common';
import { listComments } from './engage';

export const feedRouter = Router();

/**
 * Posts pinned at the top for this user (06 §3.3): published, pin still running, audience matches,
 * not seen yet. Admin pins first, then mentor pins, newest first in each group.
 */
export async function pinnedForMe(actor: Actor, db: Pick<typeof prisma, 'post' | 'studentProfile'> = prisma): Promise<PostRow[]> {
  const sectionId =
    actor.role === 'student' ? ((await db.studentProfile.findUnique({ where: { userId: actor.id }, select: { sectionId: true } }))?.sectionId ?? null) : null;
  const rows = await db.post.findMany({
    where: {
      status: 'published',
      pinnedUntil: { gt: now() },
      views: { none: { userId: actor.id } },
      OR: [{ pinAudience: 'all' }, ...(sectionId ? [{ pinAudience: 'section' as const, pinSectionId: sectionId }] : [])],
    },
    ...postSelect,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const rank = (p: PostRow) => (p.pinAudience === 'all' ? 0 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
}

feedRouter.get(
  '/',
  validate({ query: feedQuery }),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const q = req.query as unknown as z.infer<typeof feedQuery>;
    const cur = decodeCursor(q.cursor);
    const pinned = await pinnedForMe(actor);
    const where: Prisma.PostWhereInput = {
      AND: [
        visibleWhere(actor),
        ...(q.tag ? [{ tag: q.tag }] : []),
        // Posts shown on top (this request's pinned set) are not repeated in the timeline.
        ...(pinned.length ? [{ id: { notIn: pinned.map((p) => p.id) } }] : []),
        ...(cur
          ? [{ OR: [{ createdAt: { lt: new Date(cur.createdAt) } }, { createdAt: new Date(cur.createdAt), id: { lt: cur.id } }] }]
          : []),
      ],
    };
    const rows = await prisma.post.findMany({ where, ...postSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const [items, pinnedOut] = await Promise.all([serializePosts(actor, page), cur ? [] : serializePosts(actor, pinned)]);
    res.json({
      ...(cur ? {} : { pinned: pinnedOut }),
      items,
      nextCursor: rows.length > q.limit && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
    });
  }),
);

/** Dashboard widget: the same query as the feed's `pinned` list. */
feedRouter.get(
  '/pinned',
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    res.json({ items: await serializePosts(actor, await pinnedForMe(actor)) });
  }),
);

// ───── seen (06 §3.4): insert-if-absent, so repeated calls change nothing ─────
async function markSeen(userId: string, postIds: string[]): Promise<void> {
  const posts = await prisma.post.findMany({ where: { id: { in: postIds }, status: 'published' }, select: { id: true } });
  await prisma.postView.createMany({ data: posts.map((p) => ({ postId: p.id, userId })), skipDuplicates: true });
}
feedRouter.post(
  '/seen',
  validate({ body: seenBody }),
  asyncHandler(async (req, res) => {
    await markSeen(actorOf(req).id, (req.body as { postIds: string[] }).postIds);
    res.json({ ok: true });
  }),
);
feedRouter.post(
  '/posts/:id/seen',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => {
    await markSeen(actorOf(req).id, [(req.params as { id: string }).id]);
    res.json({ ok: true });
  }),
);

// ───── single post and a user's posts ─────
feedRouter.get(
  '/posts/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const post = await prisma.post.findUnique({ where: { id: (req.params as { id: string }).id }, ...postSelect });
    if (!post || !canSeeContent(actor, post)) throw NOT_FOUND();
    const [view] = await serializePosts(actor, [post]);
    res.json({ ...view, comments: await listComments(actor, post.id, { limit: 20 }) });
  }),
);

feedRouter.get(
  '/users/:id/posts',
  validate({ params: z.object({ id }), query: feedQuery }),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const uid = (req.params as { id: string }).id;
    const q = req.query as unknown as z.infer<typeof feedQuery>;
    // Inactive, passed-out and deleted users have no posts list (PRD §5.7.1).
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { status: true } });
    if (!u || u.status !== 'active') throw NOT_FOUND();
    const cur = decodeCursor(q.cursor);
    const rows = await prisma.post.findMany({
      where: {
        authorId: uid,
        AND: [
          // Held posts show only to their author on their own profile.
          { OR: [{ status: 'published' }, ...(uid === actor.id ? [{ status: 'held' as const }] : [])] },
          ...(cur ? [{ OR: [{ createdAt: { lt: new Date(cur.createdAt) } }, { createdAt: new Date(cur.createdAt), id: { lt: cur.id } }] }] : []),
        ],
      },
      ...postSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    res.json({
      items: await serializePosts(actor, page),
      nextCursor: rows.length > q.limit && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
    });
  }),
);
