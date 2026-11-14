import { Router } from 'express';
import { z } from 'zod';
import { MAX_IMAGES, pinExtendBody, id, postCreateBody, postPatchBody, type PostCreateBody, type PostPatchBody } from '@cms/shared';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { now } from '../../lib/clock';
import { softDeleteObjects } from '../../lib/files';
import { containsBanned } from '../../lib/bannedWords';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { assertNotMuted } from '../../lib/mute';
import { type Actor } from '../../lib/permissions';
import { requireRole } from '../../middleware/session';
import { NOT_FOUND, actorOf, canSeeContent, mediaUpload, postSelect, serializePosts, storeAll, uploadsOf } from './common';
import { removeContent } from './moderation';
import { notifyPinAudience, pinDays } from './notices';

export const postsRouter = Router();
const idParam = z.object({ id });
const DAY = 86_400_000;

/** The pin a new post gets: Admin → everyone, Section Mentor → their section (snapshot), anyone else → 400 (COMM-06). */
async function pinFor(actor: Actor, wantPin: boolean | undefined) {
  if (!wantPin) return null;
  if (actor.role === 'admin') return { pinAudience: 'all' as const, pinSectionId: null };
  if (actor.role === 'teacher') {
    const s = await prisma.section.findFirst({ where: { mentorTeacherId: actor.id, deletedAt: null }, select: { id: true } });
    if (s) return { pinAudience: 'section' as const, pinSectionId: s.id };
  }
  throw new AppError('VALIDATION_ERROR', 400, 'Only the Admin and Section Mentors can pin a post.', { pin: 'Not allowed' });
}

postsRouter.post(
  '/posts',
  mediaUpload,
  validate({ body: postCreateBody }),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const b = req.body as PostCreateBody;
    const up = uploadsOf(req);
    await assertNotMuted(actor.id);
    const pin = await pinFor(actor, b.pin);
    const held = await containsBanned(b.text, b.linkUrl);
    const files = await storeAll(actor.id, up, 'post_image');
    const createdAt = now();
    const days = pin ? await pinDays() : 0;
    const post = await prisma.post
      .create({
        data: {
          authorId: actor.id,
          text: b.text,
          tag: b.tag,
          linkUrl: b.linkUrl ?? null,
          pdfId: files.pdfId,
          status: held ? 'held' : 'published',
          createdAt,
          ...(pin ? { ...pin, pinnedUntil: new Date(createdAt.getTime() + days * DAY) } : {}),
          media: { create: files.imageIds.map((fileId, order) => ({ fileId, order })) },
        },
        ...postSelect,
      })
      .catch(async (e: unknown) => {
        await softDeleteObjects([...files.imageIds, ...(files.pdfId ? [files.pdfId] : [])]);
        throw e;
      });
    // A held pinned post is announced when the Admin approves it (the timer still runs from createdAt).
    if (pin && !held) await notifyPinAudience(post);
    res.status(201).json((await serializePosts(actor, [post]))[0]);
  }),
);

postsRouter.patch(
  '/posts/:id',
  mediaUpload,
  validate({ params: idParam, body: postPatchBody }),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const { id: pid } = req.params as { id: string };
    const b = req.body as PostPatchBody;
    const up = uploadsOf(req);
    const post = await prisma.post.findFirst({ where: { id: pid, authorId: actor.id, status: { not: 'removed' } }, include: { media: true } });
    if (!post) throw NOT_FOUND();
    await assertNotMuted(actor.id);

    const removeMedia = post.media.filter((m) => b.removeMediaIds.includes(m.id));
    if (b.removeMediaIds.some((x) => !post.media.some((m) => m.id === x)))
      throw new AppError('VALIDATION_ERROR', 400, 'Image not found on this post.', { removeMediaIds: 'Unknown image' });
    if (post.media.length - removeMedia.length + up.images.length > MAX_IMAGES)
      throw new AppError('VALIDATION_ERROR', 400, `A post can have at most ${MAX_IMAGES} images.`, { images: 'Too many' });

    const text = b.text ?? post.text;
    const linkUrl = b.linkUrl === undefined ? post.linkUrl : b.linkUrl;
    // The text may now contain a banned word; a published post goes back to review, a held one stays held.
    const held = post.status === 'held' || (await containsBanned(text, linkUrl));
    const files = await storeAll(actor.id, up, 'post_image');
    const dropPdf = !!post.pdfId && (b.removePdf === true || !!files.pdfId);
    const maxOrder = Math.max(-1, ...post.media.map((m) => m.order));

    await prisma.$transaction(async (tx) => {
      if (removeMedia.length) await tx.postMedia.deleteMany({ where: { id: { in: removeMedia.map((m) => m.id) } } });
      // Pin fields are deliberately absent: an edit never changes or re-pins (COMM-04).
      await tx.post.update({
        where: { id: pid },
        data: {
          text, linkUrl, tag: b.tag ?? post.tag, editedAt: now(), status: held ? 'held' : 'published',
          ...(dropPdf ? { pdfId: files.pdfId } : files.pdfId ? { pdfId: files.pdfId } : {}),
          media: { create: files.imageIds.map((fileId, i) => ({ fileId, order: maxOrder + 1 + i })) },
        },
      });
      await softDeleteObjects([...removeMedia.map((m) => m.fileId), ...(dropPdf && post.pdfId ? [post.pdfId] : [])], tx);
    });
    const fresh = await prisma.post.findUniqueOrThrow({ where: { id: pid }, ...postSelect });
    res.json((await serializePosts(actor, [fresh]))[0]);
  }),
);

postsRouter.delete(
  '/posts/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const { id: pid } = req.params as { id: string };
    const post = await prisma.post.findUnique({ where: { id: pid }, select: { id: true, authorId: true, status: true } });
    if (!post || post.status === 'removed' || (!canSeeContent(actor, post) && actor.role !== 'admin')) throw NOT_FOUND();
    if (post.authorId !== actor.id && actor.role !== 'admin') throw new AppError('FORBIDDEN', 403, 'You can only delete your own posts.');
    await removeContent({ kind: 'post', id: pid, byId: actor.id, byAdmin: actor.role === 'admin' && post.authorId !== actor.id });
    res.json({ ok: true });
  }),
);

// ───── Admin pin controls (06 §3.2) ─────
postsRouter.post(
  '/posts/:id/unpin',
  requireRole('admin'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id: pid } = req.params as { id: string };
    const post = await prisma.post.findFirst({ where: { id: pid, pinAudience: { not: null }, status: { not: 'removed' } }, select: { id: true } });
    if (!post) throw NOT_FOUND();
    await prisma.$transaction(async (tx) => {
      await tx.post.update({ where: { id: pid }, data: { pinnedUntil: now() } });
      await audit(actorOf(req).id, 'post.unpin', 'post', pid, undefined, req.ip, tx);
    });
    res.json({ ok: true });
  }),
);

postsRouter.post(
  '/posts/:id/extend',
  requireRole('admin'),
  validate({ params: idParam, body: pinExtendBody }),
  asyncHandler(async (req, res) => {
    const { id: pid } = req.params as { id: string };
    const { days } = req.body as { days: number };
    const post = await prisma.post.findFirst({ where: { id: pid, pinAudience: { not: null }, status: { not: 'removed' } }, select: { pinnedUntil: true } });
    if (!post) throw NOT_FOUND();
    const t = now().getTime();
    const until = new Date(Math.max(post.pinnedUntil?.getTime() ?? 0, t) + days * DAY);
    await prisma.$transaction(async (tx) => {
      await tx.post.update({ where: { id: pid }, data: { pinnedUntil: until } });
      await audit(actorOf(req).id, 'post.extend', 'post', pid, { days }, req.ip, tx);
    });
    res.json({ ok: true, pinnedUntil: until });
  }),
);
