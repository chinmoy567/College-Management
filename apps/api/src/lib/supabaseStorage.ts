import { createClient } from '@supabase/supabase-js';
import type { Bucket, StorageBackend } from './storage';

/** Supabase Storage backend. The service_role key stays on the server only. */
export function createSupabaseBackend(opts: {
  url: string;
  serviceRoleKey: string;
  buckets: Record<Bucket, string>;
}): StorageBackend {
  const client = createClient(opts.url, opts.serviceRoleKey, { auth: { persistSession: false } });
  const from = (b: Bucket) => client.storage.from(opts.buckets[b]);
  return {
    async put(bucket, key, body, contentType) {
      const { error } = await from(bucket).upload(key, body, { contentType, upsert: false });
      if (error) throw new Error(`storage upload failed: ${error.message}`);
    },
    async remove(bucket, key) {
      const { error } = await from(bucket).remove([key]);
      if (error) throw new Error(`storage remove failed: ${error.message}`);
    },
    async get(bucket, key) {
      const { data, error } = await from(bucket).download(key);
      if (error || !data) throw new Error(`storage download failed: ${error?.message ?? 'unknown'}`);
      return Buffer.from(await data.arrayBuffer());
    },
    async signedUrl(bucket, key, expiresIn, downloadName) {
      const { data, error } = await from(bucket).createSignedUrl(key, expiresIn, {
        ...(downloadName ? { download: downloadName } : {}),
      });
      if (error || !data) throw new Error(`signed url failed: ${error?.message ?? 'unknown'}`);
      return data.signedUrl;
    },
    publicUrl(bucket, key) {
      return from(bucket).getPublicUrl(key).data.publicUrl;
    },
  };
}
