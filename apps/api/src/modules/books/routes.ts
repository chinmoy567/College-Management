import { Router, type Request, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { UPLOAD_LIMITS, bookCreateBody, bookListQuery, bookPayBody, bookPdfQuery, bookUpdateBody, id, purchaseListQuery } from '@cms/shared';
import { AppError, asyncHandler, validate } from '../../lib/http';
import type { UploadedFile } from '../../lib/files';
import { HOUR, consume } from '../../lib/rateLimit';
import { csvFile } from '../exams/pdf';
import { requireRole } from '../../middleware/session';
import { actorOf } from '../feed/common';
import { adminListBooks, archiveBook, bookDetails, bookPdfUrl, createBook, listBooks, listPurchases, myBooks, payForBook, publicPreview, purchaseRows, topBooks, updateBook } from './service';

const params = z.object({ id });

// Cover (5 MB, checked by processUpload) + PDF (50 MB), memory storage, bounded by the content-length check.
const upload: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  if (Number(req.headers['content-length'] ?? 0) > UPLOAD_LIMITS.bookPdfBytes + UPLOAD_LIMITS.imageBytes + 1_000_000)
    return next(new AppError('VALIDATION_ERROR', 400, 'The upload is too large (PDF up to 50 MB, cover up to 5 MB).', { pdf: 'size' }));
  multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_LIMITS.bookPdfBytes, files: 2, fields: 20, fieldSize: 10_000 } })
    .fields([{ name: 'cover', maxCount: 1 }, { name: 'pdf', maxCount: 1 }])(req, res, (e: unknown) => {
      if (!e) return next();
      const code = (e as { code?: string }).code;
      next(new AppError('VALIDATION_ERROR', 400, code === 'LIMIT_FILE_SIZE' ? 'A file is too large (PDF up to 50 MB, cover up to 5 MB).' : 'Upload failed.', { files: code ?? 'upload' }));
    });
};
const fileOf = (req: Request, name: string): UploadedFile | undefined => ((req.files ?? {}) as Record<string, UploadedFile[] | undefined>)[name]?.[0];
const uploadLimit: RequestHandler = (req, _res, next) => {
  consume(`upload:${actorOf(req).id}`, 60, HOUR).then(() => next(), next);
};

// ───── student + catalog writes: /api/books ─────
export const booksRouter = Router();
booksRouter.post('/', requireRole('admin'), uploadLimit, upload, validate({ body: bookCreateBody }), asyncHandler(async (req, res) => {
  res.status(201).json(await createBook(actorOf(req), req.body, fileOf(req, 'cover'), fileOf(req, 'pdf')));
}));
booksRouter.get('/', requireRole('student'), validate({ query: bookListQuery }), asyncHandler(async (req, res) => void res.json(await listBooks(actorOf(req).id, req.query as never))));
booksRouter.get('/mine', requireRole('student'), asyncHandler(async (req, res) => void res.json(await myBooks(actorOf(req).id))));
booksRouter.get('/:id', requireRole('student'), validate({ params }), asyncHandler(async (req, res) => void res.json(await bookDetails(actorOf(req).id, req.params.id as string))));
booksRouter.post('/:id/pay', requireRole('student'), validate({ params, body: bookPayBody }), asyncHandler(async (req, res) => void res.json(await payForBook(actorOf(req).id, req.params.id as string))));
booksRouter.get('/:id/pdf', requireRole('student'), validate({ params, query: bookPdfQuery }), asyncHandler(async (req, res) => {
  res.json({ url: await bookPdfUrl(actorOf(req).id, req.params.id as string, (req.query as { download: string }).download === '1') });
}));
booksRouter.patch('/:id', requireRole('admin'), uploadLimit, upload, validate({ params, body: bookUpdateBody }), asyncHandler(async (req, res) => {
  await updateBook(actorOf(req), req.params.id as string, req.body, fileOf(req, 'cover'), fileOf(req, 'pdf'));
  res.json({ ok: true });
}));
booksRouter.delete('/:id', requireRole('admin'), validate({ params }), asyncHandler(async (req, res) => {
  await archiveBook(actorOf(req), req.params.id as string);
  res.json({ ok: true });
}));

// ───── Admin: /api/admin/books ─────
export const adminBooksRouter = Router();
adminBooksRouter.use(requireRole('admin'));
adminBooksRouter.get('/', asyncHandler(async (_req, res) => void res.json(await adminListBooks())));
adminBooksRouter.get('/purchases', validate({ query: purchaseListQuery }), asyncHandler(async (req, res) => {
  const q = req.query as unknown as z.infer<typeof purchaseListQuery>;
  if (q.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="book-purchases.csv"');
    return void res.send(csvFile(await purchaseRows(q)));
  }
  res.json(await listPurchases(q));
}));
adminBooksRouter.get('/reports/top', asyncHandler(async (_req, res) => void res.json(await topBooks())));

// ───── public landing: /api/public/books ─────
export const publicBooksRouter = Router();
publicBooksRouter.get('/preview', asyncHandler(async (_req, res) => void res.json(await publicPreview())));
