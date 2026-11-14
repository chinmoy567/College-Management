import { randomUUID } from 'node:crypto';
import { AppError } from './http';
import type { Actor } from './permissions';

export type Bucket = 'public' | 'private';

/** PRD §8 / 00 §7: only these purposes may live in the public bucket; everything else is private. */
export const PURPOSES = {
  logo: 'public',
  banner: 'public',
  landing_notice: 'public',
  book_cover: 'public',
  avatar: 'private',
  post_image: 'private',
  comment_image: 'private',
  chat_file: 'private',
  material: 'private',
  previous_question: 'private',
  book_pdf: 'private',
  book_preview: 'private',
} as const satisfies Record<string, Bucket>;
export type Purpose = keyof typeof PURPOSES;

export const SIGNED_URL_TTL_SECONDS = 300;
export const PURGE_AFTER_DAYS = 30;

export interface StorageObjectRow {
  id: string;
  bucket: Bucket;
  key: string;
  purpose: Purpose;
  contentType: string;
  sizeBytes: number;
  filename: string | null;
  deletedAt: Date | null;
}

/** Supabase Storage in production; an in-memory fake in tests. */
export interface StorageBackend {
  /** Must fail if the key already exists (never overwrite). */
  put(bucket: Bucket, key: string, body: Buffer, contentType: string): Promise<void>;
  remove(bucket: Bucket, key: string): Promise<void>;
  signedUrl(bucket: Bucket, key: string, expiresIn: number, downloadName?: string): Promise<string>;
  publicUrl(bucket: Bucket, key: string): string;
}

/** StorageObject table access; the Prisma version is wired in M1. */
export interface ObjectStore {
  create(row: Omit<StorageObjectRow, 'id' | 'deletedAt'>): Promise<StorageObjectRow>;
  get(id: string): Promise<StorageObjectRow | null>;
  markDeleted(id: string, at: Date): Promise<void>;
  /** Rows with deletedAt <= cutoff. */
  listDeletedBefore(cutoff: Date): Promise<StorageObjectRow[]>;
  hardDelete(id: string): Promise<void>;
}

export function buildKey(purpose: Purpose, ext: string, now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  // Random key; the user's filename is never part of it.
  return `${purpose}/${yyyy}/${mm}/${randomUUID()}.${ext.replace(/[^a-z0-9]/gi, '').toLowerCase()}`;
}

export function createStorage(deps: { backend: StorageBackend; objects: ObjectStore; now?: () => Date }) {
  const { backend, objects } = deps;
  const now = deps.now ?? (() => new Date());

  /** Stores an already validated/processed buffer. */
  async function save(input: {
    purpose: Purpose;
    body: Buffer;
    ext: string;
    contentType: string;
    filename?: string | null;
  }): Promise<StorageObjectRow> {
    const bucket: Bucket = PURPOSES[input.purpose];
    const key = buildKey(input.purpose, input.ext, now());
    await backend.put(bucket, key, input.body, input.contentType);
    return objects.create({
      bucket,
      key,
      purpose: input.purpose,
      contentType: input.contentType,
      sizeBytes: input.body.length,
      filename: input.filename ?? null,
    });
  }

  /**
   * Signed URL for a private object, only after the owning resource's permission check.
   * `authorize` is the caller's check for the resource that owns the file. Failure → 404.
   */
  async function urlFor(
    actor: Actor,
    objectId: string,
    authorize: (actor: Actor, obj: StorageObjectRow) => boolean | Promise<boolean>,
    opts: { download?: string } = {},
  ): Promise<string> {
    const obj = await objects.get(objectId);
    if (!obj || obj.deletedAt) throw new AppError('NOT_FOUND', 404, 'Not found.');
    if (obj.bucket === 'public') return backend.publicUrl(obj.bucket, obj.key);
    if (!(await authorize(actor, obj))) throw new AppError('NOT_FOUND', 404, 'Not found.');
    return backend.signedUrl(obj.bucket, obj.key, SIGNED_URL_TTL_SECONDS, opts.download);
  }

  async function softDelete(objectId: string): Promise<void> {
    await objects.markDeleted(objectId, now());
  }

  /** Nightly job: removes objects deleted at least 30 days ago, never earlier. Idempotent. */
  async function purge(): Promise<number> {
    const cutoff = new Date(now().getTime() - PURGE_AFTER_DAYS * 24 * 3600 * 1000);
    const rows = await objects.listDeletedBefore(cutoff);
    for (const r of rows) {
      await backend.remove(r.bucket, r.key);
      await objects.hardDelete(r.id);
    }
    return rows.length;
  }

  return { save, urlFor, softDelete, purge };
}
