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

const peopleQuery = z.object({
  q: z.string().trim().max(60).optional(),
  role: z.enum(['all', 'student', 'teacher']).default('all'),
  sessionId: z.string().min(1).max(40).optional(),
  group: z.enum(['science', 'commerce', 'arts']).optional(),
  sectionId: z.string().min(1).max(40).optional(),
  page: z.coerce.number().int().min(0).max(500).default(0),
});
const PEOPLE_PAGE = 20;

/**
 * People search (PRD §5.8a): every active student and teacher, by name, session, group and section,
 * each result can start a direct chat. Needs a name of 2+ letters or at least one filter, so the whole
 * college cannot be dumped. Names, photo and class line only; people blocked either way are hidden.
 */
chatRouter.get(
  '/people',
  validate({ query: peopleQuery }),
  asyncHandler(async (req, res) => {
    const f = req.query as unknown as z.infer<typeof peopleQuery>;
    const q = f.q && f.q.length >= 2 ? f.q : undefined;
    if (f.q && !q && !f.sessionId && !f.group && !f.sectionId) {
      throw new AppError('VALIDATION_ERROR', 400, 'Type at least 2 letters or pick a filter.', { q: 'Too short' });
    }
    const filtered = Boolean(f.sessionId || f.group || f.sectionId);
    if (!q && !filtered) throw new AppError('VALIDATION_ERROR', 400, 'Type a name or pick a filter.', { q: 'Required' });
    const me = actorOf(req).id;
    const sectionWhere = {
      deletedAt: null,
      ...(f.sectionId ? { id: f.sectionId } : {}),
      ...((f.sessionId || f.group) ? { group: { ...(f.sessionId ? { sessionId: f.sessionId } : {}), ...(f.group ? { type: f.group } : {}) } } : {}),
    };
    const nameFilter = q ? { contains: q, mode: 'insensitive' as const } : undefined;
    const studentCond = { student: { is: { ...(nameFilter ? { name: nameFilter } : {}), ...(filtered ? { section: { is: sectionWhere } } : {}) } } };
    // Teachers have no class, so a class filter matches only the Section Mentor of that class.
    const teacherCond = { teacher: { is: { ...(nameFilter ? { name: nameFilter } : {}), ...(filtered ? { mentoredSection: { is: sectionWhere } } : {}) } } };
    const or = f.role === 'student' ? [studentCond] : f.role === 'teacher' ? [teacherCond] : [studentCond, teacherCond];
    const blocks = await prisma.block.findMany({ where: { OR: [{ blockerId: me }, { blockedId: me }] }, select: { blockerId: true, blockedId: true } });
    const hidden = blocks.map((b) => (b.blockerId === me ? b.blockedId : b.blockerId));
    const rows = await prisma.user.findMany({
      where: { status: 'active', id: { notIn: [me, ...hidden] }, OR: or },
      select: { id: true, student: { select: { name: true } }, teacher: { select: { name: true } } },
      orderBy: [{ id: 'asc' }],
      skip: f.page * PEOPLE_PAGE,
      take: PEOPLE_PAGE + 1,
    });
    const pageRows = rows.slice(0, PEOPLE_PAGE);
    const authors = await loadAuthors(pageRows.map((r) => r.id));
    const items = pageRows.map((r) => authorOf(authors, r.id)).sort((x, y) => x.name.localeCompare(y.name));
    res.json({ items, hasMore: rows.length > PEOPLE_PAGE });
  }),
);

/** Filter choices for the people search: open sessions with their groups and sections (names only). */
chatRouter.get(
  '/people/filters',
  asyncHandler(async (_req, res) => {
    const sessions = await prisma.session.findMany({
      where: { status: 'active' },
      orderBy: { name: 'desc' },
      select: { id: true, name: true, groups: { select: { id: true, type: true, sections: { where: { deletedAt: null }, orderBy: [{ classLevel: 'asc' }, { name: 'asc' }], select: { id: true, name: true, classLevel: true } } } } },
    });
    res.json({ sessions });
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
