import type { Prisma, StorageObject } from '@prisma/client';
import { prisma } from '../db';
import { createStorage, type Bucket, type ObjectStore, type Purpose, type StorageBackend, type StorageObjectRow } from './storage';
import { createSupabaseBackend } from './supabaseStorage';
import { processUpload, type UploadKind } from './upload';

const toRow = (o: StorageObject): StorageObjectRow => ({
  id: o.id, bucket: o.bucket, key: o.key, purpose: o.key.split('/')[0] as Purpose,
  contentType: o.mime, sizeBytes: o.size, filename: o.originalName, deletedAt: o.deletedAt,
});

const objects: ObjectStore = {
  async create(r) {
    const o = await prisma.storageObject.create({
      data: { bucket: r.bucket, key: r.key, mime: r.contentType, size: r.sizeBytes, originalName: r.filename, uploadedBy: 'system' },
    });
    return toRow(o);
  },
  async get(id) {
    const o = await prisma.storageObject.findUnique({ where: { id } });
    return o ? toRow(o) : null;
  },
  async markDeleted(id, at) {
    await prisma.storageObject.update({ where: { id }, data: { deletedAt: at } });
  },
  async listDeletedBefore(cutoff) {
    return (await prisma.storageObject.findMany({ where: { deletedAt: { lte: cutoff } } })).map(toRow);
  },
  async hardDelete(id) {
    await prisma.storageObject.delete({ where: { id } });
  },
};

/** In-memory backend for tests and for a dev box without Supabase credentials. */
export function createMemoryBackend(): StorageBackend & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  const k = (b: Bucket, key: string) => `${b}/${key}`;
  return {
    files,
    async put(b, key, body) {
      if (files.has(k(b, key))) throw new Error('exists');
      files.set(k(b, key), body);
    },
    async remove(b, key) {
      files.delete(k(b, key));
    },
    async signedUrl(b, key, expiresIn, dl) {
      return `https://storage.test/sign/${k(b, key)}?exp=${expiresIn}${dl ? `&download=${encodeURIComponent(dl)}` : ''}`;
    },
    publicUrl: (b, key) => `https://storage.test/public/${k(b, key)}`,
  };
}

let backend: StorageBackend | null = null;
export const setStorageBackend = (b: StorageBackend | null): void => {
  backend = b;
  instance = null;
};
function getBackend(): StorageBackend {
  if (backend) return backend;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  backend =
    SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && process.env.NODE_ENV !== 'test'
      ? createSupabaseBackend({
          url: SUPABASE_URL,
          serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
          buckets: { public: process.env.SUPABASE_PUBLIC_BUCKET ?? 'public', private: process.env.SUPABASE_PRIVATE_BUCKET ?? 'private' },
        })
      : createMemoryBackend();
  return backend;
}
let instance: ReturnType<typeof createStorage> | null = null;
export const storage = () => (instance ??= createStorage({ backend: getBackend(), objects }));

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
}

/** Validates, processes and stores one upload; returns the StorageObject id. */
export async function storeUpload(
  uploadedBy: string,
  purpose: Purpose,
  kind: UploadKind,
  file: UploadedFile,
): Promise<string> {
  const p = await processUpload(kind, file.buffer, file.originalname);
  const row = await storage().save({
    purpose, body: p.body, ext: p.ext, contentType: p.contentType,
    filename: kind === 'image' ? null : file.originalname.slice(0, 200),
  });
  // ObjectStore.create has no actor argument; set it on the row right after, with no shared state between requests.
  await prisma.storageObject.update({ where: { id: row.id }, data: { uploadedBy } });
  return row.id;
}

/** Signed URLs for many private objects at once. Callers have already checked the actor may see the owning resource. */
export async function signMany(ids: string[], opts: { download?: boolean } = {}): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const rows = await prisma.storageObject.findMany({ where: { id: { in: [...new Set(ids)] }, deletedAt: null } });
  const b = getBackend();
  await Promise.all(
    rows.map(async (o) => {
      const url = o.bucket === 'public' ? b.publicUrl(o.bucket, o.key) : await b.signedUrl(o.bucket, o.key, 300, opts.download ? (o.originalName ?? undefined) : undefined);
      out.set(o.id, url);
    }),
  );
  return out;
}

export const softDeleteObjects = async (ids: string[], db: Prisma.TransactionClient | typeof prisma = prisma): Promise<void> => {
  if (ids.length) await db.storageObject.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date() } });
};
