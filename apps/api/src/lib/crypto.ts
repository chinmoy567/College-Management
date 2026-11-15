import { createHash, randomBytes } from 'node:crypto';
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
