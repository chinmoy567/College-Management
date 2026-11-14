import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  PURGE_AFTER_DAYS, PURPOSES, SIGNED_URL_TTL_SECONDS, createStorage,
  type Bucket, type ObjectStore, type StorageBackend, type StorageObjectRow,
} from './storage';
import { processUpload } from './upload';
import type { Actor } from './permissions';

function fakes(start = new Date('2026-01-01T00:00:00Z')) {
  const files = new Map<string, Buffer>();
  const rows = new Map<string, StorageObjectRow>();
  const signed: { key: string; expiresIn: number; download?: string }[] = [];
  let n = 0;
  let clock = start;
  const backend: StorageBackend = {
    async put(b, k, body) {
      if (files.has(`${b}/${k}`)) throw new Error('exists');
      files.set(`${b}/${k}`, body);
    },
    async remove(b, k) { files.delete(`${b}/${k}`); },
    async signedUrl(b: Bucket, k, expiresIn, download) {
      signed.push({ key: k, expiresIn, ...(download ? { download } : {}) });
      return `https://signed.example/${b}/${k}?t=1`;
    },
    publicUrl: (b, k) => `https://public.example/${b}/${k}`,
  };
  const objects: ObjectStore = {
    async create(r) { const row = { ...r, id: `obj${++n}`, deletedAt: null }; rows.set(row.id, row); return row; },
    async get(id) { return rows.get(id) ?? null; },
    async markDeleted(id, at) { rows.get(id)!.deletedAt = at; },
    async listDeletedBefore(cutoff) { return [...rows.values()].filter((r) => r.deletedAt && r.deletedAt <= cutoff); },
    async hardDelete(id) { rows.delete(id); },
  };
  const storage = createStorage({ backend, objects, now: () => clock });
  return { storage, files, rows, signed, setNow: (d: Date) => { clock = d; } };
}

const owner: Actor = { id: 'u1', role: 'student' };
const other: Actor = { id: 'u2', role: 'student' };
const ownerOnly = (a: Actor) => a.id === 'u1';
const png = () => sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#f00' } }).png().toBuffer();

describe('storage', () => {
  it('[CONV-04] private file only via signed URL after check', async () => {
    const f = fakes();
    const obj = await f.storage.save({ purpose: 'material', body: Buffer.from('x'), ext: 'pdf', contentType: 'application/pdf' });
    expect(obj.bucket).toBe('private');

    const url = await f.storage.urlFor(owner, obj.id, ownerOnly, { download: 'notes.pdf' });
    expect(url).toContain('signed.example');
    expect(f.signed[0]).toMatchObject({ expiresIn: SIGNED_URL_TTL_SECONDS, download: 'notes.pdf' });
    expect(SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(300);

    await expect(f.storage.urlFor(other, obj.id, ownerOnly)).rejects.toMatchObject({ status: 404 });
    await expect(f.storage.urlFor(owner, 'missing', ownerOnly)).rejects.toMatchObject({ status: 404 });
    expect(f.signed).toHaveLength(1); // the denied attempt never signed anything
  });

  it('[CONV-04] public bucket holds only logo, banner, landing-notice files and book covers', () => {
    const pub = Object.entries(PURPOSES).filter(([, b]) => b === 'public').map(([p]) => p).sort();
    expect(pub).toEqual(['banner', 'book_cover', 'landing_notice', 'logo']);
    for (const p of ['avatar', 'post_image', 'comment_image', 'chat_file', 'material', 'previous_question', 'book_pdf', 'book_preview'] as const) {
      expect(PURPOSES[p]).toBe('private');
    }
  });

  it('[CONV-04] public objects return a plain public URL, no check needed', async () => {
    const f = fakes();
    const obj = await f.storage.save({ purpose: 'logo', body: Buffer.from('x'), ext: 'webp', contentType: 'image/webp' });
    const url = await f.storage.urlFor(other, obj.id, () => false);
    expect(url).toContain('public.example');
  });

  it('[CONV-05] random keys, never the user filename, no overwrite', async () => {
    const f = fakes();
    const a = await f.storage.save({ purpose: 'post_image', body: Buffer.from('1'), ext: 'webp', contentType: 'image/webp', filename: 'my secret.jpg' });
    const b = await f.storage.save({ purpose: 'post_image', body: Buffer.from('2'), ext: 'webp', contentType: 'image/webp', filename: 'my secret.jpg' });
    expect(a.key).toMatch(/^post_image\/2026\/01\/[0-9a-f-]{36}\.webp$/);
    expect(a.key).not.toBe(b.key);
    expect(a.key).not.toContain('secret');
    expect(f.files.size).toBe(2);
  });

  it('[CONV-05] purge removes objects only 30 days after delete, never before', async () => {
    const f = fakes(new Date('2026-01-01T00:00:00Z'));
    const obj = await f.storage.save({ purpose: 'material', body: Buffer.from('x'), ext: 'pdf', contentType: 'application/pdf' });
    const keep = await f.storage.save({ purpose: 'material', body: Buffer.from('y'), ext: 'pdf', contentType: 'application/pdf' });
    await f.storage.softDelete(obj.id); // deleted 2026-01-01

    f.setNow(new Date(Date.UTC(2026, 0, 1 + PURGE_AFTER_DAYS) - 1000)); // 1 s before day 30
    expect(await f.storage.purge()).toBe(0);
    expect(f.files.size).toBe(2);
    await expect(f.storage.urlFor(owner, obj.id, () => true)).rejects.toMatchObject({ status: 404 }); // soft-deleted is unreachable

    f.setNow(new Date(Date.UTC(2026, 0, 1 + PURGE_AFTER_DAYS)));
    expect(await f.storage.purge()).toBe(1);
    expect(f.files.size).toBe(1);
    expect(f.rows.has(keep.id)).toBe(true);
    expect(await f.storage.purge()).toBe(0); // idempotent
  });
});

describe('upload processing (00 §7)', () => {
  it('[CONV-05] images are rotated/resized to max 1600 px, WebP, metadata stripped', async () => {
    const out = await processUpload('image', await png(), 'photo.png');
    expect(out.ext).toBe('webp');
    const meta = await sharp(out.body).metadata();
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width!, meta.height!)).toBe(1600);
    expect(meta.exif).toBeUndefined();
  });

  it('[CONV-05] type is checked by content, not by name or claimed type', async () => {
    await expect(processUpload('image', Buffer.from('<?php echo 1;'), 'evil.jpg')).rejects.toMatchObject({ status: 400 });
    await expect(processUpload('document', await png(), 'fake.pdf')).rejects.toMatchObject({ status: 400 });
    await expect(processUpload('book_pdf', Buffer.alloc(0), 'x.pdf')).rejects.toMatchObject({ status: 400 });
    const pdf = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    expect((await processUpload('document', pdf, 'a.pdf')).contentType).toBe('application/pdf');
  });

  it('[CONV-05] size limits per kind', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
    await expect(processUpload('image', big, 'a.jpg')).rejects.toMatchObject({ status: 400 });
  });
});
