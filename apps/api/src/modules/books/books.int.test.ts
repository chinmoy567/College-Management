import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { prisma } from '../../db';
import { readObject } from '../../lib/files';
import { adminClient, classroom, clientFor, makeApp, uniq } from '../../../../../test/m5kit';
import { makePreview } from './service';

const app = makeApp();
let admin: Awaited<ReturnType<typeof adminClient>>;
type Room = Awaited<ReturnType<typeof classroom>>;
beforeAll(async () => {
  admin = await adminClient(prisma, app);
});
afterAll(() => prisma.$disconnect());

/** A PDF whose page n is (100 + n) points wide, so a copied page can be identified by size. */
async function samplePdf(pages = 10): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pages; i++) doc.addPage([100 + i, 200]);
  return Buffer.from(await doc.save());
}
const cover = () => sharp({ create: { width: 40, height: 60, channels: 3, background: '#336699' } }).png().toBuffer();

const addBook = async (fields: Record<string, string> = {}, pdf?: Buffer, withCover = true) => {
  const rq = admin.c.req('post', '/api/books');
  for (const [k, v] of Object.entries({ title: uniq('Physics '), author: 'A. Author', price: '120.50', previewPages: '', ...fields })) rq.field(k, v);
  rq.attach('pdf', pdf ?? (await samplePdf()), { filename: 'book.pdf' });
  if (withCover) rq.attach('cover', await cover(), { filename: 'cover.png' });
  return rq;
};
const published = async (fields: Record<string, string> = {}) => {
  const res = await addBook(fields);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await makePreview(res.body.id);
  return res.body.id as string;
};
const kid = (r: Room, i = 0) => clientFor(app, r.students[i]!);
const pageWidths = async (objectId: string) => {
  const doc = await PDFDocument.load(await readObject(objectId));
  return doc.getPages().map((p) => Math.round(p.getWidth()));
};

describe('book shop', () => {
  it('[BOOK-01] the full PDF is denied without a purchase and is a signed URL with one; the preview is a separate file', async () => {
    const r = await classroom(prisma, admin.c);
    const id = await published({ previewPages: '1-2' });
    const s = await kid(r);
    const denied = await s.get(`/api/books/${id}/pdf`);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain('http');
    const details = (await s.get(`/api/books/${id}`)).body;
    expect(details.unlocked).toBe(false);
    expect(details.previewUrl).toContain('book_preview');
    const book = await prisma.book.findUniqueOrThrow({ where: { id }, include: { pdf: true } });
    expect(JSON.stringify(details)).not.toContain(book.pdf!.key);
    expect(book.previewPdfId).not.toBe(book.pdfId);
    expect((await s.post(`/api/books/${id}/pay`, { confirm: true })).status).toBe(200);
    const ok = await s.get(`/api/books/${id}/pdf?download=1`);
    expect(ok.status).toBe(200);
    expect(ok.body.url).toContain(book.pdf!.key);
    expect(ok.body.url).toContain('exp=300');
    // another student still has no access; teachers and admin are not students
    expect((await (await kid(r, 1)).get(`/api/books/${id}/pdf`)).status).toBe(403);
    expect((await admin.c.get(`/api/books/${id}/pdf`)).status).toBe(403);
  });

  it('[BOOK-02] the preview contains only the chosen pages, and a wrong page list keeps the book hidden', async () => {
    const id = await published({ previewPages: '1-3,9' });
    const book = await prisma.book.findUniqueOrThrow({ where: { id } });
    expect(book.previewPages).toEqual([1, 2, 3, 9]);
    expect(book.publishedAt).not.toBeNull();
    expect(await pageWidths(book.previewPdfId!)).toEqual([101, 102, 103, 109]);
    const bad = await addBook({ previewPages: '1,99' });
    expect(bad.status).toBe(201);
    await makePreview(bad.body.id);
    const hidden = await prisma.book.findUniqueOrThrow({ where: { id: bad.body.id } });
    expect(hidden.publishedAt).toBeNull();
    expect((await admin.c.patch(`/api/books/${id}`, { previewPages: 'x' })).status).toBe(400);
    // without preview pages the book is visible straight away
    const plain = await addBook({});
    expect((await prisma.book.findUniqueOrThrow({ where: { id: plain.body.id } })).publishedAt).not.toBeNull();
  });

  it('[BOOK-03] pay is idempotent, keeps the price of that moment and calls no gateway', async () => {
    const r = await classroom(prisma, admin.c);
    const id = await published({ price: '99' });
    const s = await kid(r);
    expect((await s.post(`/api/books/${id}/pay`, {})).status).toBe(400); // confirm is required
    expect((await s.post(`/api/books/${id}/pay`, { confirm: false })).status).toBe(400);
    const [a, b] = await Promise.all([s.post(`/api/books/${id}/pay`, { confirm: true }), s.post(`/api/books/${id}/pay`, { confirm: true })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.id).toBe(b.body.id);
    await admin.c.patch(`/api/books/${id}`, { price: 500 });
    const again = await s.post(`/api/books/${id}/pay`, { confirm: true });
    expect(again.body.id).toBe(a.body.id);
    expect(again.body.price).toBe(99);
    const rows = await prisma.bookPurchase.findMany({ where: { bookId: id } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.price)).toBe(99);
    expect(rows[0]!.paymentStatus).toBe('unlocked_no_gateway');
    // the unlock is the only place a purchase is made and it does no network I/O
    const src = (await import('node:fs')).readFileSync(new URL('./payment.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/fetch\(|https?:\/\/|axios|stripe/i);
    // not a student: no purchase
    expect((await admin.c.post(`/api/books/${id}/pay`, { confirm: true })).status).toBe(403);
    const mine = await s.get('/api/books/mine');
    expect(mine.body.items.map((x: { id: string }) => x.id)).toContain(id);
    expect(mine.body.items[0].paidPrice).toBe(99);
  });

  it('[BOOK-04] only the admin manages the catalog; archived books stay readable for owners and vanish for others', async () => {
    const r = await classroom(prisma, admin.c);
    const id = await published();
    const owner = await kid(r, 0);
    const other = await kid(r, 1);
    await owner.post(`/api/books/${id}/pay`, { confirm: true });

    // teacher and student cannot write the catalog or read the admin routes
    const t = await clientFor(app, r.teacher);
    for (const c of [owner, t]) {
      expect((await c.patch(`/api/books/${id}`, { title: 'Hacked' })).status).toBe(403);
      expect((await c.delete(`/api/books/${id}`)).status).toBe(403);
      expect((await c.get('/api/admin/books')).status).toBe(403);
      expect((await c.get('/api/admin/books/purchases')).status).toBe(403);
      expect((await c.get('/api/admin/books/reports/top')).status).toBe(403);
    }
    expect((await t.post('/api/books', {})).status).toBe(403);

    expect((await admin.c.delete(`/api/books/${id}`)).status).toBe(200);
    expect(((await other.get('/api/books')).body.items as { id: string }[]).some((b) => b.id === id)).toBe(false);
    expect((await other.get(`/api/books/${id}`)).status).toBe(404);
    expect((await other.post(`/api/books/${id}/pay`, { confirm: true })).status).toBe(404);
    expect((await owner.get(`/api/books/${id}`)).status).toBe(200);
    expect((await owner.get(`/api/books/${id}/pdf`)).status).toBe(200);
    expect(((await owner.get('/api/books/mine')).body.items as { id: string; archived: boolean }[]).find((b) => b.id === id)?.archived).toBe(true);
    // the file is still there
    expect(await prisma.book.count({ where: { id } })).toBe(1);
  });

  it('a book can be created without a PDF; students can pay for it, and the PDF can be added later', async () => {
    const rq = admin.c.req('post', '/api/books');
    for (const [k, v] of Object.entries({ title: uniq('NoPdf '), author: 'A. Author', price: '99', previewPages: '' })) rq.field(k, v);
    const created = await rq;
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const r = await classroom(prisma, admin.c);
    const s = await kid(r);
    expect(((await s.get('/api/books')).body.items as { id: string; hasPdf: boolean }[]).find((b) => b.id === id)?.hasPdf).toBe(false);
    expect((await s.post(`/api/books/${id}/pay`, { confirm: true })).status).toBe(200);
    expect((await s.get(`/api/books/${id}/pdf`)).status).toBe(404);
    const withPages = admin.c.req('patch', `/api/books/${id}`);
    withPages.field('previewPages', '1-2');
    expect((await withPages).status).toBe(400);
    const add = admin.c.req('patch', `/api/books/${id}`);
    add.attach('pdf', await samplePdf(3), { filename: 'later.pdf' });
    expect((await add).status).toBe(200);
    expect((await s.get(`/api/books/${id}/pdf`)).status).toBe(200);
  });

  it('replacing the PDF stores a new object and rebuilds the preview; owners get the new file', async () => {
    const id = await published({ previewPages: '1' });
    const before = await prisma.book.findUniqueOrThrow({ where: { id } });
    const rq = admin.c.req('patch', `/api/books/${id}`);
    rq.field('previewPages', '2');
    rq.attach('pdf', await samplePdf(4), { filename: 'v2.pdf' });
    expect((await rq).status).toBe(200);
    const mid = await prisma.book.findUniqueOrThrow({ where: { id } });
    expect(mid.pdfId).not.toBe(before.pdfId);
    expect(mid.publishedAt).toBeNull();
    await makePreview(id);
    const after = await prisma.book.findUniqueOrThrow({ where: { id } });
    expect(after.publishedAt).not.toBeNull();
    expect(await pageWidths(after.previewPdfId!)).toEqual([102]);
    expect((await prisma.storageObject.findUniqueOrThrow({ where: { id: before.pdfId! } })).deletedAt).not.toBeNull();
  });

  it('lists with filters and an unlocked flag, paginates, serves the public landing covers and admin purchases/top/CSV', async () => {
    const r = await classroom(prisma, admin.c);
    const tag = uniq('Zq');
    const a = await published({ title: `${tag} Alpha`, groupType: 'science' });
    const b = await published({ title: `${tag} Beta`, groupType: 'arts' });
    const s = await kid(r);
    await s.post(`/api/books/${a}/pay`, { confirm: true });
    const list = await s.get(`/api/books?q=${tag}&limit=1`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.nextCursor).toBeTruthy();
    const page2 = await s.get(`/api/books?q=${tag}&limit=1&cursor=${list.body.nextCursor}`);
    const flags = new Map([...list.body.items, ...page2.body.items].map((x: { id: string; unlocked: boolean }) => [x.id, x.unlocked]));
    expect(flags.get(a)).toBe(true);
    expect(flags.get(b)).toBe(false);
    expect(((await s.get(`/api/books?q=${tag}&groupType=arts`)).body.items as { id: string }[]).map((x) => x.id)).toEqual([b]);
    expect((await s.get('/api/books?limit=51')).status).toBe(400);

    const pub = await (await import('supertest')).default(app).get('/api/public/books/preview');
    expect(pub.status).toBe(200);
    expect(pub.body.items.length).toBeLessThanOrEqual(8);
    expect(pub.body.items[0].coverUrl).toContain('/public/');
    expect(JSON.stringify(pub.body)).not.toContain('book_pdf');

    const purchases = await admin.c.get(`/api/admin/books/purchases?bookId=${a}`);
    expect(purchases.body.items).toHaveLength(1);
    expect(purchases.body.items[0].price).toBe(120.5);
    const top = await admin.c.get('/api/admin/books/reports/top');
    expect(top.body.items.find((x: { bookId: string }) => x.bookId === a).unlocks).toBe(1);
    const csv = await admin.c.get(`/api/admin/books/purchases?bookId=${a}&format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
  });
});
