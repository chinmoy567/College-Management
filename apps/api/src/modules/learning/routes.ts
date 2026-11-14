import { Router, type Request, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  MATERIAL_MAX_FILES, PREV_EXAM_TYPES, UPLOAD_LIMITS, id, materialCreateBody, materialFileQuery, materialListQuery, materialUpdateBody,
  onlineClassCreateBody, onlineClassListQuery, onlineClassUpdateBody, prevQuestionCreateBody, prevQuestionListQuery,
  recordingCreateBody, recordingListQuery, recordingUpdateBody,
} from '@cms/shared';
import { AppError, asyncHandler, validate } from '../../lib/http';
import type { UploadedFile } from '../../lib/files';
import { HOUR, consume } from '../../lib/rateLimit';
import { requireRole } from '../../middleware/session';
import { actorOf } from '../feed/common';
import { cancelOnlineClass, createOnlineClass, joinOnlineClass, listJoins, listOnlineClasses, updateOnlineClass } from './online';
import { createRecording, deleteRecording, listRecordings, markOpened, updateRecording } from './recordings';
import { createMaterial, deleteMaterial, listMaterials, materialFileUrl, materialStats, updateMaterial } from './materials';
import { createPrevious, deletePrevious, listPrevious, previousFileUrl, updatePrevious } from './previous';

const params = z.object({ id });
const fileParams = z.object({ id, fileId: id });
const fileAction = (req: Request) => (req.query as { action: 'view' | 'download' }).action;

// ───── online classes ─────
export const onlineClassesRouter = Router();
onlineClassesRouter.post('/', requireRole('teacher'), validate({ body: onlineClassCreateBody }), asyncHandler(async (req, res) => void res.status(201).json(await createOnlineClass(actorOf(req), req.body))));
onlineClassesRouter.get('/', validate({ query: onlineClassListQuery }), asyncHandler(async (req, res) => void res.json(await listOnlineClasses(actorOf(req), req.query as never))));
onlineClassesRouter.patch('/:id', requireRole('teacher'), validate({ params, body: onlineClassUpdateBody }), asyncHandler(async (req, res) => {
  await updateOnlineClass(actorOf(req), req.params.id as string, req.body);
  res.json({ ok: true });
}));
onlineClassesRouter.post('/:id/cancel', requireRole('teacher'), validate({ params }), asyncHandler(async (req, res) => {
  await cancelOnlineClass(actorOf(req), req.params.id as string);
  res.json({ ok: true });
}));
onlineClassesRouter.post('/:id/join', requireRole('student'), validate({ params }), asyncHandler(async (req, res) => void res.json(await joinOnlineClass(actorOf(req), req.params.id as string))));
onlineClassesRouter.get('/:id/joins', validate({ params }), asyncHandler(async (req, res) => void res.json(await listJoins(actorOf(req), req.params.id as string))));

// ───── uploads (memory storage, bounded per request) ─────
const multipart = (fields: multer.Field[], maxBytes: number): RequestHandler => {
  const parser = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: UPLOAD_LIMITS.documentBytes, files: MATERIAL_MAX_FILES + 1, fields: 20, fieldSize: 10_000 },
  }).fields(fields);
  return (req, res, next) => {
    if (!req.is('multipart/form-data')) return next();
    if (Number(req.headers['content-length'] ?? 0) > maxBytes) return next(new AppError('VALIDATION_ERROR', 400, 'The upload is too large.', { files: 'size' }));
    parser(req, res, (e: unknown) => {
      if (!e) return next();
      const code = (e as { code?: string }).code;
      const msg =
        code === 'LIMIT_FILE_SIZE'
          ? 'A file is too large (20 MB for documents, 5 MB for images).'
          : code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE'
            ? `At most ${MATERIAL_MAX_FILES} files.`
            : 'Upload failed.';
      next(new AppError('VALIDATION_ERROR', 400, msg, { files: code ?? 'upload' }));
    });
  };
};
const filesOf = (req: Request, name: string): UploadedFile[] => ((req.files ?? {}) as Record<string, UploadedFile[] | undefined>)[name] ?? [];
const uploadLimit: RequestHandler = (req, _res, next) => {
  consume(`upload:${actorOf(req).id}`, 60, HOUR).then(() => next(), next);
};

// ───── recordings ─────
export const recordingsRouter = Router();
recordingsRouter.post('/', requireRole('admin', 'teacher'), validate({ body: recordingCreateBody }), asyncHandler(async (req, res) => void res.status(201).json(await createRecording(actorOf(req), req.body))));
recordingsRouter.get('/', validate({ query: recordingListQuery }), asyncHandler(async (req, res) => void res.json(await listRecordings(actorOf(req), req.query as never))));
recordingsRouter.post('/:id/opened', requireRole('student'), validate({ params }), asyncHandler(async (req, res) => {
  await markOpened(actorOf(req), req.params.id as string);
  res.json({ ok: true });
}));
recordingsRouter.patch('/:id', requireRole('admin', 'teacher'), validate({ params, body: recordingUpdateBody }), asyncHandler(async (req, res) => {
  await updateRecording(actorOf(req), req.params.id as string, req.body);
  res.json({ ok: true });
}));
recordingsRouter.delete('/:id', requireRole('admin', 'teacher'), validate({ params }), asyncHandler(async (req, res) => {
  await deleteRecording(actorOf(req), req.params.id as string);
  res.json({ ok: true });
}));

// ───── previous questions ─────
export const previousRouter = Router();
const prevUpload = multipart([{ name: 'files', maxCount: MATERIAL_MAX_FILES }, { name: 'solution', maxCount: 1 }], (MATERIAL_MAX_FILES + 1) * UPLOAD_LIMITS.documentBytes + 1_000_000);
previousRouter.post('/', requireRole('admin', 'teacher'), uploadLimit, prevUpload, validate({ body: prevQuestionCreateBody }), asyncHandler(async (req, res) => {
  res.status(201).json(await createPrevious(actorOf(req), req.body, filesOf(req, 'files'), filesOf(req, 'solution')[0] ?? null));
}));
previousRouter.get('/', validate({ query: prevQuestionListQuery }), asyncHandler(async (req, res) => void res.json(await listPrevious(actorOf(req), req.query as never))));
previousRouter.get('/:id/files/:fileId', validate({ params: fileParams, query: materialFileQuery }), asyncHandler(async (req, res) => {
  res.redirect(302, await previousFileUrl(actorOf(req), req.params.id as string, req.params.fileId as string, fileAction(req)));
}));
const prevPatch = z.object({ year: z.number().int().min(1990).max(2100), examType: z.enum(PREV_EXAM_TYPES), board: z.string().trim().max(100).nullable() }).partial();
previousRouter.patch('/:id', requireRole('admin', 'teacher'), validate({ params, body: prevPatch }), asyncHandler(async (req, res) => {
  await updatePrevious(actorOf(req), req.params.id as string, req.body);
  res.json({ ok: true });
}));
previousRouter.delete('/:id', requireRole('admin', 'teacher'), validate({ params }), asyncHandler(async (req, res) => {
  await deletePrevious(actorOf(req), req.params.id as string);
  res.json({ ok: true });
}));

// ───── materials (recordings and previous questions first: fixed paths before /:id) ─────
export const materialsRouter = Router();
materialsRouter.use('/recordings', recordingsRouter);
materialsRouter.use('/previous-questions', previousRouter);
const matUpload = multipart([{ name: 'files', maxCount: MATERIAL_MAX_FILES }], MATERIAL_MAX_FILES * UPLOAD_LIMITS.documentBytes + 1_000_000);
materialsRouter.post('/', requireRole('admin', 'teacher'), uploadLimit, matUpload, validate({ body: materialCreateBody }), asyncHandler(async (req, res) => {
  res.status(201).json(await createMaterial(actorOf(req), req.body, filesOf(req, 'files')));
}));
materialsRouter.get('/', validate({ query: materialListQuery }), asyncHandler(async (req, res) => void res.json(await listMaterials(actorOf(req), req.query as never))));
materialsRouter.get('/:id/files/:fileId', validate({ params: fileParams, query: materialFileQuery }), asyncHandler(async (req, res) => {
  res.redirect(302, await materialFileUrl(actorOf(req), req.params.id as string, req.params.fileId as string, fileAction(req)));
}));
materialsRouter.get('/:id/stats', requireRole('admin', 'teacher'), validate({ params }), asyncHandler(async (req, res) => void res.json(await materialStats(actorOf(req), req.params.id as string))));
materialsRouter.patch('/:id', requireRole('admin', 'teacher'), validate({ params, body: materialUpdateBody }), asyncHandler(async (req, res) => {
  await updateMaterial(actorOf(req), req.params.id as string, req.body);
  res.json({ ok: true });
}));
materialsRouter.delete('/:id', requireRole('admin', 'teacher'), validate({ params }), asyncHandler(async (req, res) => {
  await deleteMaterial(actorOf(req), req.params.id as string);
  res.json({ ok: true });
}));
