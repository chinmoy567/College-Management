import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { UPLOAD_LIMITS, blockBody, cursorQuery, directBody, id, messageBody, messagesQuery } from '@cms/shared';
import { prisma } from '../../db';
import { loadAuthors, authorOf } from '../../lib/authorLine';
import { storeUpload } from '../../lib/files';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { consume, HOUR } from '../../lib/rateLimit';
import { actorOf } from '../feed/common';
import { addBlock, deleteMessage, getOrCreateDirect, history, listConversations, removeBlock, sendMessage, memberOf } from './service';

/** /api/chat (07 §2.2). Admin is allowed: Admin ↔ anyone is a direct chat (PRD §5.8). */
export const chatRouter = Router();

chatRouter.get(
  '/conversations',
  validate({ query: cursorQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof cursorQuery>;
    let cur: { t: string; id: string } | undefined;
    if (q.cursor) {
      try {
        cur = JSON.parse(Buffer.from(q.cursor, 'base64url').toString()) as { t: string; id: string };
        if (typeof cur.t !== 'string' || typeof cur.id !== 'string' || Number.isNaN(Date.parse(cur.t))) throw new Error('bad');
      } catch {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid cursor.', { cursor: 'Invalid cursor' });
      }
    }
    res.json(await listConversations(actorOf(req), q.limit, cur));
  }),
);

/** People to start a direct chat with (07 §2.1: every pair is allowed). Names only, active accounts. */
chatRouter.get(
  '/people',
  validate({ query: z.object({ q: z.string().trim().min(2).max(60) }) }),
  asyncHandler(async (req, res) => {
    const { q } = req.query as { q: string };
    const me = actorOf(req).id;
    const rows = await prisma.user.findMany({
      where: {
        status: 'active', id: { not: me },
        OR: [{ student: { is: { name: { contains: q, mode: 'insensitive' } } } }, { teacher: { is: { name: { contains: q, mode: 'insensitive' } } } }],
      },
      select: { id: true }, take: 20,
    });
    const authors = await loadAuthors(rows.map((r) => r.id));
    res.json({ items: rows.map((r) => authorOf(authors, r.id)) });
  }),
);

chatRouter.post(
  '/direct',
  validate({ body: directBody }),
  asyncHandler(async (req, res) => {
    const r = await getOrCreateDirect(actorOf(req), (req.body as { userId: string }).userId);
    res.status(r.created ? 201 : 200).json({ id: r.id });
  }),
);

chatRouter.get(
  '/conversations/:id/messages',
  validate({ params: z.object({ id }), query: messagesQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof messagesQuery>;
    res.json(await history(actorOf(req), req.params.id as string, q));
  }),
);

chatRouter.post(
  '/conversations/:id/messages',
  validate({ params: z.object({ id }), body: messageBody }),
  asyncHandler(async (req, res) => {
    const msg = await sendMessage(actorOf(req), req.params.id as string, req.body as z.infer<typeof messageBody>);
    res.status(201).json(msg);
  }),
);

chatRouter.delete(
  '/messages/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => {
    await deleteMessage(actorOf(req), req.params.id as string);
    res.json({ ok: true });
  }),
);

chatRouter.post(
  '/blocks',
  validate({ body: blockBody }),
  asyncHandler(async (req, res) => {
    await addBlock(actorOf(req), (req.body as { userId: string }).userId);
    res.status(201).json({ ok: true });
  }),
);
chatRouter.delete(
  '/blocks/:userId',
  validate({ params: z.object({ userId: id }) }),
  asyncHandler(async (req, res) => {
    await removeBlock(actorOf(req), req.params.userId as string);
    res.json({ ok: true });
  }),
);

// ───── attachment upload: image 5 MB / PDF 20 MB, bound to a message on send ─────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_LIMITS.documentBytes, files: 1, fields: 5 } }).single('file');
export const chatFilesRouter = Router();
chatFilesRouter.post(
  '/chat',
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    await consume(`chat-upload:${actor.id}`, 40, HOUR);
    if (Number(req.headers['content-length'] ?? 0) > UPLOAD_LIMITS.documentBytes + 500_000)
      throw new AppError('VALIDATION_ERROR', 400, 'The file is too large.', { file: 'size' });
    await new Promise<void>((resolve, reject) => upload(req, res, (e: unknown) => (e ? reject(new AppError('VALIDATION_ERROR', 400, 'Upload failed or file too large.', { file: 'upload' })) : resolve())));
    const f = (req as unknown as { file?: { buffer: Buffer; originalname: string } }).file;
    if (!f) throw new AppError('VALIDATION_ERROR', 400, 'Choose a file.', { file: 'Required' });
    const isPdf = f.buffer.subarray(0, 5).toString() === '%PDF-';
    const fileId = await storeUpload(actor.id, 'chat_file', isPdf ? 'document' : 'image', f);
    res.status(201).json({ id: fileId });
  }),
);

export { memberOf };
