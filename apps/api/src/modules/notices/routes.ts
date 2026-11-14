import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { UPLOAD_LIMITS, id, noticeCreateBody, noticeListQuery, noticeUpdateBody, type NoticeCreateBody } from '@cms/shared';
import { AppError, asyncHandler, validate } from '../../lib/http';
import type { UploadedFile } from '../../lib/files';
import { requireRole } from '../../middleware/session';
import { actorOf } from '../feed/common';
import { audienceOptions, createNotice, deleteNotice, listNotices, markNoticeRead, publicNotices, updateNotice, urgentUnread } from './service';

const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_LIMITS.documentBytes, files: 5, fields: 20, fieldSize: 60_000 } }).array('attachments', 5);
const upload: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  if (Number(req.headers['content-length'] ?? 0) > 5 * UPLOAD_LIMITS.documentBytes + 1_000_000)
    return next(new AppError('VALIDATION_ERROR', 400, 'The upload is too large.', { attachments: 'size' }));
  parser(req, res, (e: unknown) => (e ? next(new AppError('VALIDATION_ERROR', 400, 'At most 5 files, 20 MB each.', { attachments: 'upload' })) : next()));
};

export const noticesRouter = Router();

noticesRouter.post(
  '/',
  requireRole('admin', 'teacher'),
  upload,
  validate({ body: noticeCreateBody }),
  asyncHandler(async (req, res) => {
    const files = (req.files as UploadedFile[] | undefined) ?? [];
    res.status(201).json(await createNotice(actorOf(req), req.body as NoticeCreateBody, files));
  }),
);

noticesRouter.get(
  '/',
  validate({ query: noticeListQuery }),
  asyncHandler(async (req, res) => {
    res.json(await listNotices(actorOf(req), req.query as unknown as z.infer<typeof noticeListQuery>));
  }),
);
// Fixed path before the :id routes.
noticesRouter.get('/audience-options', requireRole('admin', 'teacher'), asyncHandler(async (req, res) => void res.json(await audienceOptions(actorOf(req)))));
noticesRouter.get('/urgent-unread', asyncHandler(async (req, res) => void res.json(await urgentUnread(actorOf(req)))));

noticesRouter.post(
  '/:id/read',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => {
    await markNoticeRead(actorOf(req), req.params.id as string);
    res.json({ ok: true });
  }),
);
noticesRouter.patch(
  '/:id',
  requireRole('admin', 'teacher'),
  validate({ params: z.object({ id }), body: noticeUpdateBody }),
  asyncHandler(async (req, res) => {
    await updateNotice(actorOf(req), req.params.id as string, req.body as z.infer<typeof noticeUpdateBody>);
    res.json({ ok: true });
  }),
);
noticesRouter.delete(
  '/:id',
  requireRole('admin', 'teacher'),
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => {
    await deleteNotice(actorOf(req), req.params.id as string);
    res.json({ ok: true });
  }),
);

/** No session: the landing page (07 §3.2). */
export const publicNoticesRouter = Router();
publicNoticesRouter.get('/', asyncHandler(async (_req, res) => void res.json(await publicNotices())));
