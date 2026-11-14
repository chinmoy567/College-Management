import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import argon2 from 'argon2';

/** Random token, base64url (32 bytes by default). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

// OWASP baseline argon2id; light enough for the free CPU.
const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
export const hashPassword = (pw: string): Promise<string> => argon2.hash(pw, ARGON);
export async function verifyPassword(hash: string | null | undefined, pw: string): Promise<boolean> {
  try {
    return await argon2.verify(hash ?? (await dummyHash()), pw);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;
/** Hash verified for unknown users so unknown and wrong-password logins take equal time (AUTH-01). */
export const dummyHash = (): Promise<string> => (dummy ??= argon2.hash('dummy-password-for-timing', ARGON));

function key(): Buffer {
  const k = Buffer.from(process.env.TOTP_ENC_KEY ?? '', 'base64');
  if (k.length !== 32) throw new Error('TOTP_ENC_KEY must be 32 bytes, base64.');
  return k;
}

/** AES-256-GCM; output "iv.tag.cipher" (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}
export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key(), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(enc!), d.final()]).toString('utf8');
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** One backup code: xxxxx-xxxxx (10 chars). */
export function generateBackupCode(): string {
  const part = () => Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${part()}-${part()}`;
}
