import type { Request, RequestHandler } from 'express';
import multer from 'multer';
import type { Prisma } from '@prisma/client';
import { MAX_IMAGES, UPLOAD_LIMITS } from '@cms/shared';
import { prisma } from '../../db';
import { AppError } from '../../lib/http';
import { loadAuthors, authorOf, mentorLabel, type AuthorLine } from '../../lib/authorLine';
import { signMany, softDeleteObjects, storeUpload, type UploadedFile } from '../../lib/files';
import type { Actor } from '../../lib/permissions';
import { now } from '../../lib/clock';
import type { AuthedRequest } from '../../middleware/session';

export const actorOf = (req: Request): Actor => (req as AuthedRequest).actor;
export const NOT_FOUND = () => new AppError('NOT_FOUND', 404, 'Not found.');

// ───── uploads: up to 10 images (5 MB each, checked by processUpload) and one PDF (20 MB) ─────
const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_LIMITS.documentBytes, files: MAX_IMAGES + 1, fields: 20, fieldSize: 20_000 },
}).fields([
  { name: 'images', maxCount: MAX_IMAGES },
  { name: 'pdf', maxCount: 1 },
]);
export const mediaUpload: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  parser(req, res, (e: unknown) => {
    if (!e) return next();
    const code = (e as { code?: string }).code;
    const msg =
      code === 'LIMIT_UNEXPECTED_FILE' || code === 'LIMIT_FILE_COUNT'
        ? `You can add at most ${MAX_IMAGES} images and one PDF.`
        : code === 'LIMIT_FILE_SIZE'
          ? 'A file is too large.'
          : 'Upload failed.';
    next(new AppError('VALIDATION_ERROR', 400, msg, { images: code ?? 'upload' }));
  });
};
export interface Uploads {
  images: UploadedFile[];
  pdf: UploadedFile | null;
}
export const uploadsOf = (req: Request): Uploads => {
  const f = (req.files ?? {}) as Record<string, UploadedFile[] | undefined>;
  return { images: f.images ?? [], pdf: f.pdf?.[0] ?? null };
};

/** Stores every file; if any fails, the ones already stored are marked deleted. */
export async function storeAll(
  userId: string,
  u: Uploads,
  purpose: 'post_image' | 'comment_image',
): Promise<{ imageIds: string[]; pdfId: string | null }> {
  if (u.pdf && u.pdf.buffer.subarray(0, 5).toString() !== '%PDF-')
    throw new AppError('VALIDATION_ERROR', 400, 'The attachment must be a PDF.', { pdf: 'type' });
  const stored: string[] = [];
  try {
    const imageIds: string[] = [];
    for (const img of u.images) {
      const id = await storeUpload(userId, purpose, 'image', img);
      stored.push(id);
      imageIds.push(id);
    }
    const pdfId = u.pdf ? await storeUpload(userId, purpose, 'document', u.pdf) : null;
    return { imageIds, pdfId };
  } catch (e) {
    await softDeleteObjects(stored);
    throw e;
  }
}

// ───── visibility ─────
/** Published for everyone; held also for its author. Removed never (the Admin sees removed items only in moderation). */
export const visibleWhere = (actor: Actor) => ({
  OR: [{ status: 'published' as const }, { status: 'held' as const, authorId: actor.id }],
});
export const canSeeContent = (actor: Actor, c: { status: string; authorId: string }): boolean =>
  c.status === 'published' || (c.status === 'held' && (c.authorId === actor.id || actor.role === 'admin'));

// ───── serialisation ─────
const postInclude = {
  media: { orderBy: { order: 'asc' as const }, select: { id: true, fileId: true } },
  pinSection: { select: { name: true, group: { select: { type: true, session: { select: { name: true } } } } } },
} satisfies Prisma.PostInclude;
export const postSelect = { include: postInclude } as const;
export type PostRow = Prisma.PostGetPayload<{ include: typeof postInclude }>;

type Counts = Record<string, number>;
async function reactionInfo(actor: Actor, key: 'postId' | 'commentId', ids: string[]) {
  const counts = new Map<string, Counts>();
  const mine = new Map<string, string>();
  if (ids.length === 0) return { counts, mine };
  const [grouped, my] = await Promise.all([
    prisma.reaction.groupBy({ by: [key, 'type'], where: { [key]: { in: ids } }, _count: { _all: true } }),
    prisma.reaction.findMany({ where: { userId: actor.id, [key]: { in: ids } }, select: { postId: true, commentId: true, type: true } }),
  ]);
  for (const g of grouped) {
    const k = g[key]!;
    counts.set(k, { ...(counts.get(k) ?? {}), [g.type]: g._count._all });
  }
  for (const r of my) mine.set((key === 'postId' ? r.postId : r.commentId)!, r.type);
  return { counts, mine };
}

/** Batch serialiser: authors, media URLs, reaction counts and comment counts in a fixed number of queries. */
export async function serializePosts(actor: Actor, rows: PostRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((p) => p.id);
  const pdfIds = rows.map((p) => p.pdfId).filter((x): x is string => !!x);
  const [authors, react, commentGroups, urls, pdfUrls, pdfObjs] = await Promise.all([
    loadAuthors(rows.map((p) => p.authorId)),
    reactionInfo(actor, 'postId', ids),
    prisma.comment.groupBy({ by: ['postId'], where: { postId: { in: ids }, status: 'published' }, _count: { _all: true } }),
    signMany(rows.flatMap((p) => p.media.map((m) => m.fileId))),
    signMany(pdfIds, { download: true }),
    prisma.storageObject.findMany({ where: { id: { in: pdfIds } }, select: { id: true, originalName: true, size: true } }),
  ]);
  const pdfMeta = new Map(pdfObjs.map((o) => [o.id, o]));
  const cc = new Map(commentGroups.map((g) => [g.postId, g._count._all]));
  const t = now();
  return rows.map((p) => ({
    id: p.id,
    author: authorOf(authors, p.authorId),
    text: p.text,
    tag: p.tag,
    link: p.linkUrl,
    status: p.status,
    media: p.media.map((m) => ({ id: m.id, signedUrl: urls.get(m.fileId) ?? null })),
    pdf: p.pdfId
      ? { signedUrl: pdfUrls.get(p.pdfId) ?? null, name: pdfMeta.get(p.pdfId)?.originalName ?? 'document.pdf', size: pdfMeta.get(p.pdfId)?.size ?? 0 }
      : null,
    reactionCounts: react.counts.get(p.id) ?? {},
    myReaction: react.mine.get(p.id) ?? null,
    commentCount: cc.get(p.id) ?? 0,
    editedAt: p.editedAt,
    createdAt: p.createdAt,
    pin:
      p.pinnedUntil && p.pinnedUntil > t && p.pinAudience
        ? {
            badge: p.pinAudience === 'all' ? '📌 Admin' : `📌 Section Mentor${p.pinSection ? ` · ${mentorLabel(p.pinSection)}` : ''}`,
            until: p.pinnedUntil,
            audience: p.pinAudience,
          }
        : undefined,
  }));
}
export type PostView = Awaited<ReturnType<typeof serializePosts>>[number];

export const commentSelect = {
  // The schema has no pdf column on Comment: a comment's PDF is stored as a CommentMedia row whose file is a PDF.
  include: { media: { orderBy: { order: 'asc' as const }, select: { id: true, fileId: true, file: { select: { mime: true, originalName: true, size: true } } } } },
} satisfies { include: Prisma.CommentInclude };
export type CommentRow = Prisma.CommentGetPayload<typeof commentSelect>;

export async function serializeComments(actor: Actor, rows: CommentRow[], replyCounts?: Map<string, number>) {
  if (rows.length === 0) return [];
  const files = rows.flatMap((c) => c.media);
  const [authors, react, urls, pdfUrls] = await Promise.all([
    loadAuthors(rows.map((c) => c.authorId)),
    reactionInfo(actor, 'commentId', rows.map((c) => c.id)),
    signMany(files.filter((m) => m.file.mime.startsWith('image/')).map((m) => m.fileId)),
    signMany(files.filter((m) => !m.file.mime.startsWith('image/')).map((m) => m.fileId), { download: true }),
  ]);
  return rows.map((c) => ({
    id: c.id,
    postId: c.postId,
    parentCommentId: c.parentCommentId,
    author: authorOf(authors, c.authorId) as AuthorLine,
    text: c.text,
    link: c.linkUrl,
    status: c.status,
    media: c.media.filter((m) => m.file.mime.startsWith('image/')).map((m) => ({ id: m.id, signedUrl: urls.get(m.fileId) ?? null })),
    pdf: ((m) => (m ? { id: m.id, signedUrl: pdfUrls.get(m.fileId) ?? null, name: m.file.originalName ?? 'document.pdf', size: m.file.size } : null))(
      c.media.find((x) => !x.file.mime.startsWith('image/')),
    ),
    reactionCounts: react.counts.get(c.id) ?? {},
    myReaction: react.mine.get(c.id) ?? null,
    replyCount: replyCounts?.get(c.id) ?? 0,
    editedAt: c.editedAt,
    createdAt: c.createdAt,
  }));
}
