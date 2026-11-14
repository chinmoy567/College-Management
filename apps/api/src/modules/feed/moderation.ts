import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { bannedWordBody, bannedWordsToggleBody, id, moderationActionBody, moderationQuery, reportBody, type ModerationActionBody, type ReportBody } from '@cms/shared';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { loadAuthors, authorOf } from '../../lib/authorLine';
import { now } from '../../lib/clock';
import { invalidateBannedWords, normaliseWord } from '../../lib/bannedWords';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { decodeCursor, encodeCursor } from '../../lib/pagination';
import { notify } from '../../lib/notify';
import { markDeleted, reportedContext } from '../chat/service';
import { requireRole } from '../../middleware/session';
import { NOT_FOUND, actorOf } from './common';
import { notifyComment, notifyPinAudience } from './notices';

type Tx = Prisma.TransactionClient;
type Kind = 'post' | 'comment';
const DAY = 86_400_000;

// ───── removal (soft delete, kept 30 days; the nightly purge hard-deletes it) ─────
/** Sets status=removed, closes open reports as actioned and, for a removal by someone else, tells the author (06 §6.1). */
export async function removeContent(o: { kind: Kind; id: string; byId: string; byAdmin: boolean; tx?: Tx }): Promise<string | null> {
  const run = async (tx: Tx) => {
    const t = now();
    let authorId: string | null = null;
    if (o.kind === 'post') {
      const p = await tx.post.findUnique({ where: { id: o.id }, select: { authorId: true, status: true } });
      if (!p) throw NOT_FOUND();
      authorId = p.authorId;
      if (p.status !== 'removed') await tx.post.update({ where: { id: o.id }, data: { status: 'removed', removedAt: t, removedBy: o.byId } });
    } else {
      const c = await tx.comment.findUnique({ where: { id: o.id }, select: { authorId: true, status: true } });
      if (!c) throw NOT_FOUND();
      authorId = c.authorId;
      if (c.status !== 'removed') await tx.comment.update({ where: { id: o.id }, data: { status: 'removed', removedAt: t } });
    }
    await tx.report.updateMany({
      where: { targetType: o.kind, targetId: o.id, status: 'open' },
      data: { status: 'actioned', resolvedBy: o.byId, resolvedAt: t },
    });
    if (o.byAdmin) {
      await audit(o.byId, `${o.kind}.remove`, o.kind, o.id, undefined, undefined, tx);
      if (authorId !== o.byId) await notify([authorId], 'content_removed', { type: o.kind, id: o.id }, `Your ${o.kind} was removed by the Admin.`, tx);
    }
    return authorId;
  };
  return o.tx ? run(o.tx) : prisma.$transaction(run);
}

/** Nightly job body (11): removed content older than 30 days is deleted for good and its files are marked for purge. */
export async function purgeRemovedContent(): Promise<{ posts: number; comments: number }> {
  const cutoff = new Date(now().getTime() - 30 * DAY);
  return prisma.$transaction(async (tx) => {
    const posts = await tx.post.findMany({ where: { status: 'removed', removedAt: { lte: cutoff } }, select: { id: true, pdfId: true, media: { select: { fileId: true } }, comments: { select: { id: true, media: { select: { fileId: true } } } } } });
    const comments = await tx.comment.findMany({ where: { status: 'removed', removedAt: { lte: cutoff }, postId: { notIn: posts.map((p) => p.id) } }, select: { id: true, media: { select: { fileId: true } } } });
    const cIds = [...comments.map((c) => c.id), ...posts.flatMap((p) => p.comments.map((c) => c.id))];
    const files = [
      ...posts.flatMap((p) => [...p.media.map((m) => m.fileId), ...(p.pdfId ? [p.pdfId] : [])]),
      ...[...comments, ...posts.flatMap((p) => p.comments)].flatMap((c) => c.media.map((m) => m.fileId)),
    ];
    const pIds = posts.map((p) => p.id);
    // Replies before parents (self-reference is Restrict).
    await tx.reaction.deleteMany({ where: { OR: [{ postId: { in: pIds } }, { commentId: { in: cIds } }] } });
    await tx.comment.deleteMany({ where: { id: { in: cIds }, parentCommentId: { not: null } } });
    await tx.comment.deleteMany({ where: { id: { in: cIds } } });
    await tx.postView.deleteMany({ where: { postId: { in: pIds } } });
    await tx.post.deleteMany({ where: { id: { in: pIds } } });
    await tx.storageObject.updateMany({ where: { id: { in: files }, deletedAt: null }, data: { deletedAt: now() } });
    return { posts: pIds.length, comments: cIds.length };
  });
}

// ───── reports (any user) ─────
export const reportsRouter = Router();
reportsRouter.post(
  '/',
  validate({ body: reportBody }),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const b = req.body as ReportBody;
    if (b.targetType === 'post' || b.targetType === 'comment') {
      const c = b.targetType === 'post'
        ? await prisma.post.findUnique({ where: { id: b.targetId }, select: { status: true } })
        : await prisma.comment.findUnique({ where: { id: b.targetId }, select: { status: true } });
      if (!c || c.status !== 'published') throw NOT_FOUND();
    } else if (b.targetType === 'user') {
      if (b.targetId === actor.id) throw new AppError('VALIDATION_ERROR', 400, 'You cannot report yourself.', { targetId: 'Not allowed' });
      const u = await prisma.user.findUnique({ where: { id: b.targetId }, select: { status: true } });
      if (!u || u.status === 'deleted') throw NOT_FOUND();
    } else {
      // The reporter must be a member of the conversation (07 §2.2); nobody reports their own message.
      const msg = await prisma.message.findUnique({ where: { id: b.targetId }, select: { conversationId: true, senderId: true, deletedAt: true } });
      if (!msg || msg.deletedAt) throw NOT_FOUND();
      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: msg.conversationId, userId: actor.id } },
        select: { userId: true },
      });
      if (!member) throw NOT_FOUND();
      if (msg.senderId === actor.id) throw new AppError('VALIDATION_ERROR', 400, 'You cannot report your own message.', { targetId: 'Not allowed' });
    }
    const reason = b.text ? `${b.reason}: ${b.text}` : b.reason;
    await prisma.report.create({ data: { reporterId: actor.id, targetType: b.targetType, targetId: b.targetId, reason } });
    res.status(201).json({ ok: true });
  }),
);

// ───── Admin moderation ─────
export const moderationRouter = Router();
moderationRouter.use(requireRole('admin'));

interface QueueItem {
  key: string;
  kind: 'report' | 'held';
  targetType: 'post' | 'comment' | 'message' | 'user';
  targetId: string;
  preview: string;
  authorId: string | null;
  reasons: string[];
  reporterCount: number;
  removed: boolean;
  createdAt: Date;
}
const clip = (s: string) => (s.length > 200 ? `${s.slice(0, 200)}…` : s);

moderationRouter.get(
  '/moderation',
  validate({ query: moderationQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof moderationQuery>;
    const items: QueueItem[] = [];

    if (q.type !== 'held') {
      const reports = await prisma.report.findMany({
        where: { status: q.status, ...(q.type ? { targetType: q.type } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 1000,
        select: { targetType: true, targetId: true, reason: true, reporterId: true, createdAt: true },
      });
      const groups = new Map<string, typeof reports>();
      for (const r of reports) groups.set(`${r.targetType}:${r.targetId}`, [...(groups.get(`${r.targetType}:${r.targetId}`) ?? []), r]);
      const ids = (t: string) => [...groups.values()].filter((g) => g[0]!.targetType === t).map((g) => g[0]!.targetId);
      const [posts, comments, users, messages] = await Promise.all([
        prisma.post.findMany({ where: { id: { in: ids('post') } }, select: { id: true, text: true, authorId: true, status: true } }),
        prisma.comment.findMany({ where: { id: { in: ids('comment') } }, select: { id: true, text: true, authorId: true, status: true } }),
        prisma.user.findMany({ where: { id: { in: ids('user') } }, select: { id: true, role: true } }),
        prisma.message.findMany({ where: { id: { in: ids('message') } }, select: { id: true, senderId: true, deletedAt: true } }),
      ]);
      const mm = new Map(messages.map((m) => [m.id, m]));
      const pm = new Map(posts.map((p) => [p.id, p]));
      const cm = new Map(comments.map((c) => [c.id, c]));
      const um = new Map(users.map((u) => [u.id, u]));
      for (const [key, g] of groups) {
        const f = g[0]!;
        const c = f.targetType === 'post' ? pm.get(f.targetId) : f.targetType === 'comment' ? cm.get(f.targetId) : undefined;
        const msg = f.targetType === 'message' ? mm.get(f.targetId) : undefined;
        const gone = f.targetType === 'user' ? !um.has(f.targetId) : f.targetType === 'message' ? !msg : !c;
        if (gone) continue;
        items.push({
          key, kind: 'report', targetType: f.targetType, targetId: f.targetId,
          preview: c ? clip(c.text) : f.targetType === 'user' ? 'User account' : 'Reported message (open to see it with the messages around it)',
          authorId: c ? c.authorId : f.targetType === 'user' ? f.targetId : (msg?.senderId ?? null),
          reasons: g.map((r) => r.reason), reporterCount: new Set(g.map((r) => r.reporterId)).size,
          removed: c ? c.status === 'removed' : msg ? !!msg.deletedAt : false, createdAt: f.createdAt,
        });
      }
    }
    if ((q.type === undefined || q.type === 'held') && q.status === 'open') {
      const [hp, hc] = await Promise.all([
        prisma.post.findMany({ where: { status: 'held' }, select: { id: true, text: true, authorId: true, createdAt: true }, take: 500 }),
        prisma.comment.findMany({ where: { status: 'held' }, select: { id: true, text: true, authorId: true, createdAt: true }, take: 500 }),
      ]);
      for (const [t, rows] of [['post', hp], ['comment', hc]] as const)
        for (const r of rows)
          items.push({ key: `held:${t}:${r.id}`, kind: 'held', targetType: t, targetId: r.id, preview: clip(r.text), authorId: r.authorId, reasons: ['banned_word'], reporterCount: 0, removed: false, createdAt: r.createdAt });
    }

    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.key < b.key ? 1 : -1));
    const cur = decodeCursor(q.cursor);
    const start = cur ? items.findIndex((i) => i.key === cur.id) + 1 : 0;
    const page = items.slice(start, start + q.limit);
    const authors = await loadAuthors(page.map((i) => i.authorId));
    const last = page[page.length - 1];
    res.json({
      items: page.map((i) => ({ ...i, author: i.authorId ? authorOf(authors, i.authorId) : null })),
      nextCursor: last && start + q.limit < items.length ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.key }) : null,
    });
  }),
);

moderationRouter.post(
  '/moderation/:targetType/:targetId',
  validate({ params: z.object({ targetType: z.enum(['post', 'comment', 'user', 'message']), targetId: id }), body: moderationActionBody }),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const { targetType, targetId } = req.params as { targetType: 'post' | 'comment' | 'user' | 'message'; targetId: string };
    let deletedMessageId: string | null = null;
    const b = req.body as ModerationActionBody;
    /** Pins to announce after the approving transaction commits. */
    const pendingPinNotice: Parameters<typeof notifyPinAudience>[0][] = [];
    const pendingComment: Parameters<typeof notifyComment>[0][] = [];
    await prisma.$transaction(async (tx) => {
      const t = now();
      let authorId: string;
      let status: string | null = null;
      if (targetType === 'user') {
        const u = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, status: true } });
        if (!u || u.status === 'deleted') throw NOT_FOUND();
        authorId = u.id;
      } else if (targetType === 'message') {
        const mg = await tx.message.findUnique({ where: { id: targetId }, select: { senderId: true, deletedAt: true } });
        if (!mg) throw NOT_FOUND();
        authorId = mg.senderId;
        status = mg.deletedAt ? 'removed' : 'published';
      } else {
        const c = targetType === 'post'
          ? await tx.post.findUnique({ where: { id: targetId }, select: { authorId: true, status: true } })
          : await tx.comment.findUnique({ where: { id: targetId }, select: { authorId: true, status: true } });
        if (!c) throw NOT_FOUND();
        authorId = c.authorId;
        status = c.status;
      }
      const closeReports = (to: 'dismissed' | 'actioned') =>
        tx.report.updateMany({ where: { targetType, targetId, status: 'open' }, data: { status: to, resolvedBy: actor.id, resolvedAt: t } });
      const firstReport = () => tx.report.findFirst({ where: { targetType, targetId, status: 'open' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      const changes = { action: b.action, ...(b.days ? { days: b.days } : {}), reason: b.reason };

      if (b.action === 'approve') {
        if (targetType === 'user' || status !== 'held') throw new AppError('CONFLICT', 409, 'This item is not waiting for review.');
        if (targetType === 'post') {
          const p = await tx.post.update({ where: { id: targetId }, data: { status: 'published' }, select: { id: true, authorId: true, pinAudience: true, pinSectionId: true, pinnedUntil: true } });
          // The pin timer still runs from createdAt; announce only if it has not already run out.
          if (p.pinAudience && p.pinnedUntil && p.pinnedUntil > t) pendingPinNotice.push(p);
        } else {
          const c = await tx.comment.update({ where: { id: targetId }, data: { status: 'published' }, select: { id: true, postId: true, authorId: true, parentCommentId: true } });
          pendingComment.push(c);
        }
      } else if (b.action === 'dismiss') {
        if (status === 'held') throw new AppError('VALIDATION_ERROR', 400, 'Approve or delete a held item.', { action: 'Not allowed' });
        await closeReports('dismissed');
      } else if (b.action === 'delete' || b.action === 'delete_warn') {
        if (targetType === 'user') throw new AppError('VALIDATION_ERROR', 400, 'A user cannot be deleted here.', { action: 'Not allowed' });
        const rid = (await firstReport())?.id;
        if (targetType === 'message') {
          if (status !== 'removed') await tx.message.update({ where: { id: targetId }, data: { deletedAt: t } });
          await closeReports('actioned');
          await notify([authorId], 'content_removed', { type: 'message', id: targetId }, 'Your message was removed by the Admin.', tx);
          deletedMessageId = targetId;
        } else await removeContent({ kind: targetType, id: targetId, byId: actor.id, byAdmin: true, tx });
        if (b.action === 'delete_warn') {
          await tx.userSanction.create({ data: { userId: authorId, type: 'warn', reason: b.reason, relatedReportId: rid, createdBy: actor.id } });
          await notify([authorId], 'warning', { type: targetType, id: targetId }, 'You have received a warning from the Admin.', tx);
        }
      } else {
        const rid = (await firstReport())?.id;
        const endsAt = new Date(t.getTime() + (b.days ?? 1) * DAY);
        await tx.userSanction.create({ data: { userId: authorId, type: 'mute', reason: b.reason, relatedReportId: rid, startsAt: t, endsAt, createdBy: actor.id } });
        await closeReports('actioned');
        await notify([authorId], 'muted', null, `You are muted until ${endsAt.toISOString().slice(0, 10)}. You can still read.`, tx);
      }
      await audit(actor.id, `moderation.${b.action}`, targetType, targetId, changes, req.ip, tx);
    });
    if (deletedMessageId) await markDeleted(deletedMessageId); // tells the room (idempotent re-set of deletedAt)
    for (const p of pendingPinNotice) await notifyPinAudience(p);
    for (const c of pendingComment) await notifyComment(c);
    res.json({ ok: true });
  }),
);

/** The reported message with 10 before and 10 after, only while a report is open (07 §2.4). No other chat browsing. */
moderationRouter.get(
  '/moderation/message/:messageId/context',
  validate({ params: z.object({ messageId: id }) }),
  asyncHandler(async (req, res) => {
    res.json(await reportedContext(req.params.messageId as string));
  }),
);

moderationRouter.get(
  '/sanctions',
  asyncHandler(async (_req, res) => {
    const t = now();
    const rows = await prisma.userSanction.findMany({
      where: { type: 'mute', liftedAt: null, endsAt: { gt: t } },
      orderBy: { endsAt: 'asc' },
      take: 200,
    });
    const authors = await loadAuthors(rows.map((r) => r.userId));
    res.json({ items: rows.map((r) => ({ id: r.id, user: authorOf(authors, r.userId), reason: r.reason, startsAt: r.startsAt, endsAt: r.endsAt })), nextCursor: null });
  }),
);

moderationRouter.post(
  '/sanctions/:id/lift',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => {
    const sid = (req.params as { id: string }).id;
    await prisma.$transaction(async (tx) => {
      const s = await tx.userSanction.findFirst({ where: { id: sid, type: 'mute', liftedAt: null } });
      if (!s) throw NOT_FOUND();
      await tx.userSanction.update({ where: { id: sid }, data: { liftedAt: now() } });
      await audit(actorOf(req).id, 'sanction.lift', 'sanction', sid, undefined, req.ip, tx);
    });
    res.json({ ok: true });
  }),
);

// ───── banned words ─────
moderationRouter.get(
  '/banned-words',
  asyncHandler(async (_req, res) => {
    const [words, flag] = await Promise.all([
      prisma.bannedWord.findMany({ orderBy: { word: 'asc' }, take: 1000, select: { id: true, word: true } }),
      prisma.setting.findUnique({ where: { key: 'banned_words_enabled' } }),
    ]);
    res.json({ enabled: flag?.value === true, items: words, nextCursor: null });
  }),
);
moderationRouter.post(
  '/banned-words',
  validate({ body: bannedWordBody }),
  asyncHandler(async (req, res) => {
    const word = normaliseWord((req.body as { word: string }).word);
    const w = await prisma.$transaction(async (tx) => {
      const row = await tx.bannedWord.create({ data: { word, createdBy: actorOf(req).id } });
      await audit(actorOf(req).id, 'banned_word.add', 'banned_word', row.id, undefined, req.ip, tx);
      return row;
    });
    invalidateBannedWords();
    res.status(201).json({ id: w.id, word: w.word });
  }),
);
moderationRouter.delete(
  '/banned-words/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => {
    const wid = (req.params as { id: string }).id;
    await prisma.$transaction(async (tx) => {
      if (!(await tx.bannedWord.findUnique({ where: { id: wid } }))) throw NOT_FOUND();
      await tx.bannedWord.delete({ where: { id: wid } });
      await audit(actorOf(req).id, 'banned_word.remove', 'banned_word', wid, undefined, req.ip, tx);
    });
    invalidateBannedWords();
    res.json({ ok: true });
  }),
);
moderationRouter.put(
  '/banned-words-enabled',
  validate({ body: bannedWordsToggleBody }),
  asyncHandler(async (req, res) => {
    const { enabled } = req.body as { enabled: boolean };
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({ where: { key: 'banned_words_enabled' }, create: { key: 'banned_words_enabled', value: enabled, updatedBy: actorOf(req).id }, update: { value: enabled, updatedBy: actorOf(req).id } });
      await audit(actorOf(req).id, 'banned_words.toggle', 'setting', 'banned_words_enabled', { enabled }, req.ip, tx);
    });
    invalidateBannedWords();
    res.json({ ok: true, enabled });
  }),
);
