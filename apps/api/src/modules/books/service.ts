import type { Prisma } from '@prisma/client';
import { type BookCreateBody, type BookUpdateBody, parsePreviewPages } from '@cms/shared';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { readObject, signMany, softDeleteObjects, storeUpload, type UploadedFile } from '../../lib/files';
import { AppError } from '../../lib/http';
import type { Actor } from '../../lib/permissions';
import { clampLimit, decodeCursor, paginate } from '../../lib/pagination';
import { enqueue, jobsRunning } from '../../jobs';
import { logger } from '../../lib/logger';
import { buildPreviewPdf, PreviewPagesError } from './preview';
import { unlock } from './payment';

const NOT_FOUND = () => new AppError('NOT_FOUND', 404, 'Not found.');
const bad = (field: string, message: string) => new AppError('VALIDATION_ERROR', 400, message, { [field]: message });
const pagesOf = (s: string | undefined): number[] => parsePreviewPages(s ?? '') ?? [];

async function checkCourse(courseId: string | null | undefined): Promise<void> {
  if (courseId && !(await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } }))) throw bad('courseId', 'Unknown course.');
}

type BookRow = Prisma.BookGetPayload<{ include: { course: { select: { name: true } } } }>;
const card = (b: BookRow, covers: Map<string, string>, unlocked: boolean) => ({
  id: b.id, title: b.title, author: b.author, publisher: b.publisher, price: Number(b.price), course: b.course?.name ?? null, courseId: b.courseId,
  groupType: b.groupType, classLevel: b.classLevel, coverUrl: b.coverId ? (covers.get(b.coverId) ?? null) : null, unlocked,
});

// ───── Admin catalog ─────
export async function createBook(actor: Actor, b: BookCreateBody, cover: UploadedFile | undefined, pdf: UploadedFile | undefined): Promise<{ id: string }> {
  if (!pdf) throw bad('pdf', 'Upload the book PDF.');
  await checkCourse(b.courseId);
  const pages = pagesOf(b.previewPages);
  const stored: string[] = [];
  try {
    const pdfId = await storeUpload(actor.id, 'book_pdf', 'book_pdf', pdf);
    stored.push(pdfId);
    const coverId = cover ? await storeUpload(actor.id, 'book_cover', 'image', cover) : null;
    if (coverId) stored.push(coverId);
    const book = await prisma.$transaction(async (tx) => {
      const created = await tx.book.create({
        data: {
          title: b.title, author: b.author, publisher: b.publisher ?? null, courseId: b.courseId ?? null, groupType: b.groupType ?? null,
          classLevel: b.classLevel ?? null, description: b.description ?? null, price: b.price, coverId, pdfId, previewPages: pages,
          publishedAt: pages.length ? null : new Date(),
        },
      });
      await audit(actor.id, 'book.create', 'book', created.id, { price: b.price, previewPages: pages.length }, undefined, tx);
      return created;
    });
    if (pages.length) await queuePreview(book.id);
    return { id: book.id };
  } catch (e) {
    await softDeleteObjects(stored);
    throw e;
  }
}

async function queuePreview(bookId: string): Promise<void> {
  if (jobsRunning()) await enqueue('book.make_preview', { bookId }, { retryLimit: 2 });
}

/** The `book.make_preview` job: builds the preview PDF; the book becomes visible only once it exists (or no pages were chosen). */
export async function makePreview(bookId: string): Promise<void> {
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book || book.archivedAt) return;
  if (!book.previewPages.length) {
    if (!book.publishedAt) await prisma.book.update({ where: { id: bookId }, data: { publishedAt: new Date() } });
    return;
  }
  try {
    const preview = await buildPreviewPdf(await readObject(book.pdfId), book.previewPages);
    const previewId = await storeUpload('system', 'book_preview', 'book_pdf', { buffer: preview, originalname: 'preview.pdf' });
    await prisma.book.update({ where: { id: bookId }, data: { previewPdfId: previewId, publishedAt: new Date() } });
    if (book.previewPdfId) await softDeleteObjects([book.previewPdfId]);
  } catch (e) {
    // Wrong page numbers cannot be fixed by retrying: the book stays hidden ("processing") until the Admin corrects them.
    if (e instanceof PreviewPagesError) logger.warn({ bookId }, 'book preview pages out of range');
    else throw e;
  }
}

export async function updateBook(actor: Actor, id: string, b: BookUpdateBody, cover: UploadedFile | undefined, pdf: UploadedFile | undefined): Promise<void> {
  const book = await prisma.book.findUnique({ where: { id } });
  if (!book) throw NOT_FOUND();
  if (b.courseId) await checkCourse(b.courseId);
  const { previewPages, price, ...rest } = b;
  const data: Prisma.BookUncheckedUpdateInput = { ...rest };
  if (price !== undefined) data.price = price;
  const stored: string[] = [];
  try {
    if (cover) {
      const coverId = await storeUpload(actor.id, 'book_cover', 'image', cover);
      stored.push(coverId);
      data.coverId = coverId;
    }
    if (pdf) {
      const pdfId = await storeUpload(actor.id, 'book_pdf', 'book_pdf', pdf);
      stored.push(pdfId);
      data.pdfId = pdfId;
    }
    const pages = previewPages !== undefined ? pagesOf(previewPages) : book.previewPages;
    const rebuild = !!pdf || (previewPages !== undefined && pages.join() !== book.previewPages.join());
    if (previewPages !== undefined) data.previewPages = pages;
    if (rebuild) {
      data.previewPdfId = null;
      data.publishedAt = pages.length ? null : (book.publishedAt ?? new Date());
    }
    await prisma.$transaction(async (tx) => {
      await tx.book.update({ where: { id }, data });
      await audit(actor.id, 'book.update', 'book', id, { fields: Object.keys(b), pdfReplaced: !!pdf }, undefined, tx);
    });
    // Old objects are removed by the purge job after 30 days; owners already read the new file through book.pdfId.
    if (pdf) await softDeleteObjects([book.pdfId]);
    if (rebuild && book.previewPdfId) await softDeleteObjects([book.previewPdfId]);
    if (cover && book.coverId) await softDeleteObjects([book.coverId]);
    if (rebuild && pages.length) await queuePreview(id);
  } catch (e) {
    await softDeleteObjects(stored);
    throw e;
  }
}

export async function archiveBook(actor: Actor, id: string): Promise<void> {
  const book = await prisma.book.findUnique({ where: { id }, select: { id: true } });
  if (!book) throw NOT_FOUND();
  await prisma.$transaction(async (tx) => {
    await tx.book.update({ where: { id }, data: { archivedAt: new Date() } });
    await audit(actor.id, 'book.archive', 'book', id, undefined, undefined, tx);
  });
}

export async function adminListBooks() {
  const rows = await prisma.book.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { course: { select: { name: true } }, _count: { select: { purchases: true } } } });
  const covers = await signMany(rows.flatMap((r) => (r.coverId ? [r.coverId] : [])));
  return {
    items: rows.map((r) => ({
      ...card(r, covers, false), previewPages: r.previewPages, purchases: r._count.purchases,
      status: r.archivedAt ? 'archived' : r.publishedAt ? 'published' : 'processing',
    })),
  };
}

type PurchaseFilter = { bookId?: string; studentId?: string; from?: string; to?: string };
const purchaseWhere = (q: PurchaseFilter): Prisma.BookPurchaseWhereInput => ({
  ...(q.bookId && { bookId: q.bookId }),
  ...(q.studentId && { studentId: q.studentId }),
  ...((q.from || q.to) && {
    purchasedAt: {
      ...(q.from && { gte: new Date(`${q.from}T00:00:00+06:00`) }),
      ...(q.to && { lt: new Date(new Date(`${q.to}T00:00:00+06:00`).getTime() + 86_400_000) }),
    },
  }),
});
const purchaseInclude = { book: { select: { title: true } }, student: { select: { name: true, user: { select: { loginId: true } } } } } as const;

export async function listPurchases(q: PurchaseFilter & { cursor?: string; limit?: number }) {
  const limit = clampLimit(q.limit);
  const cur = decodeCursor(q.cursor);
  const and: Prisma.BookPurchaseWhereInput[] = [purchaseWhere(q)];
  if (cur) and.push({ OR: [{ purchasedAt: { lt: new Date(cur.createdAt) } }, { purchasedAt: new Date(cur.createdAt), id: { lt: cur.id } }] });
  const rows = await prisma.bookPurchase.findMany({ where: { AND: and }, orderBy: [{ purchasedAt: 'desc' }, { id: 'desc' }], take: limit + 1, include: purchaseInclude });
  const page = paginate(rows.map((r) => ({ ...r, createdAt: r.purchasedAt })), limit);
  return {
    items: page.items.map((r) => ({ id: r.id, bookId: r.bookId, book: r.book.title, studentId: r.studentId, student: r.student.name, loginId: r.student.user.loginId, price: Number(r.price), purchasedAt: r.purchasedAt })),
    nextCursor: page.nextCursor,
  };
}

/** All matching purchases for the CSV (bounded). */
export async function purchaseRows(q: PurchaseFilter): Promise<(string | number)[][]> {
  const rows = await prisma.bookPurchase.findMany({ where: purchaseWhere(q), orderBy: { purchasedAt: 'desc' }, take: 20_000, include: purchaseInclude });
  return [['Book', 'Student', 'Student ID', 'Price', 'Purchased at (UTC)'], ...rows.map((r) => [r.book.title, r.student.name, r.student.user.loginId ?? '', Number(r.price), r.purchasedAt.toISOString()])];
}

export async function topBooks() {
  const g = await prisma.bookPurchase.groupBy({ by: ['bookId'], _count: { _all: true }, orderBy: { _count: { bookId: 'desc' } }, take: 20 });
  const books = await prisma.book.findMany({ where: { id: { in: g.map((x) => x.bookId) } }, select: { id: true, title: true } });
  const title = new Map(books.map((b) => [b.id, b.title]));
  return { items: g.map((x) => ({ bookId: x.bookId, title: title.get(x.bookId) ?? '', unlocks: x._count._all })) };
}

// ───── Student ─────
const visible = (): Prisma.BookWhereInput => ({ publishedAt: { not: null }, archivedAt: null });

export async function listBooks(studentId: string, q: { q?: string; groupType?: 'science' | 'commerce' | 'arts' | 'common'; courseId?: string; cursor?: string; limit?: number }) {
  const limit = clampLimit(q.limit);
  const cur = decodeCursor(q.cursor);
  const and: Prisma.BookWhereInput[] = [visible()];
  if (q.q) and.push({ OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { author: { contains: q.q, mode: 'insensitive' } }] });
  if (q.groupType) and.push({ groupType: q.groupType });
  if (q.courseId) and.push({ courseId: q.courseId });
  if (cur) and.push({ OR: [{ createdAt: { lt: new Date(cur.createdAt) } }, { createdAt: new Date(cur.createdAt), id: { lt: cur.id } }] });
  const rows = await prisma.book.findMany({ where: { AND: and }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, include: { course: { select: { name: true } } } });
  const page = paginate(rows, limit);
  const owned = new Set((await prisma.bookPurchase.findMany({ where: { studentId, bookId: { in: page.items.map((r) => r.id) } }, select: { bookId: true } })).map((p) => p.bookId));
  const covers = await signMany(page.items.flatMap((r) => (r.coverId ? [r.coverId] : [])));
  return { items: page.items.map((r) => card(r, covers, owned.has(r.id))), nextCursor: page.nextCursor };
}

/** Public landing: 8 newest covers and titles, public bucket URLs only. */
export async function publicPreview() {
  const rows = await prisma.book.findMany({ where: { ...visible(), coverId: { not: null } }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, title: true, coverId: true } });
  const covers = await signMany(rows.map((r) => r.coverId!));
  return { items: rows.map((r) => ({ id: r.id, title: r.title, coverUrl: covers.get(r.coverId!) ?? null })) };
}

async function loadFor(studentId: string, id: string) {
  const book = await prisma.book.findUnique({ where: { id }, include: { course: { select: { name: true } } } });
  if (!book) throw NOT_FOUND();
  const owned = !!(await prisma.bookPurchase.findUnique({ where: { studentId_bookId: { studentId, bookId: id } }, select: { id: true } }));
  // Archived or unpublished books are visible only to students who unlocked them.
  if (!owned && (book.archivedAt || !book.publishedAt)) throw NOT_FOUND();
  return { book, owned };
}

export async function bookDetails(studentId: string, id: string) {
  const { book, owned } = await loadFor(studentId, id);
  const urls = await signMany([book.coverId, book.previewPdfId].filter((x): x is string => !!x));
  return { ...card(book, urls, owned), description: book.description, previewUrl: book.previewPdfId ? (urls.get(book.previewPdfId) ?? null) : null };
}

export async function payForBook(studentId: string, id: string) {
  await loadFor(studentId, id);
  const p = await unlock(studentId, id);
  return { id: p.id, bookId: id, price: p.price, purchasedAt: p.purchasedAt, unlocked: true };
}

export async function myBooks(studentId: string) {
  const rows = await prisma.bookPurchase.findMany({ where: { studentId }, orderBy: { purchasedAt: 'desc' }, take: 200, include: { book: { include: { course: { select: { name: true } } } } } });
  const covers = await signMany(rows.flatMap((r) => (r.book.coverId ? [r.book.coverId] : [])));
  return { items: rows.map((r) => ({ ...card(r.book, covers, true), purchasedAt: r.purchasedAt, paidPrice: Number(r.price), archived: !!r.book.archivedAt })) };
}

/** The full PDF: only with a purchase (BOOK-01). Archived books stay readable for owners (BOOK-04). */
export async function bookPdfUrl(studentId: string, id: string, download: boolean): Promise<string> {
  const book = await prisma.book.findUnique({ where: { id }, select: { id: true, pdfId: true } });
  if (!book) throw NOT_FOUND();
  const owned = await prisma.bookPurchase.findUnique({ where: { studentId_bookId: { studentId, bookId: id } }, select: { id: true } });
  if (!owned) throw new AppError('FORBIDDEN', 403, 'Unlock this book to read it.');
  const url = (await signMany([book.pdfId], { download })).get(book.pdfId);
  if (!url) throw NOT_FOUND();
  return url;
}
