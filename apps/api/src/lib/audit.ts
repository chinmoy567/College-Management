import type { Prisma } from '@prisma/client';
import { prisma } from '../db';

/** Keys that must never appear in `changes` (personal data, PRD §6 AuditLog / 00 §2). Lower-case. */
export const AUDIT_DENY_KEYS = [
  'email', 'mobile', 'name', 'password', 'passwordhash', 'dob', 'address', 'guardianname', 'guardiancontact',
  'bio', 'loginid', 'confirmloginid', 'token',
] as const;

export function assertNoPersonalKeys(v: unknown, path = 'changes'): void {
  if (Array.isArray(v)) return v.forEach((x) => assertNoPersonalKeys(x, path));
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) {
      if ((AUDIT_DENY_KEYS as readonly string[]).includes(k.toLowerCase())) {
        throw new Error(`audit: personal-data key "${k}" is not allowed in ${path}`);
      }
      assertNoPersonalKeys(val, `${path}.${k}`);
    }
  }
}

/**
 * Records an Admin action. `changes` holds field names and non-personal values only (enforced by a deny-list).
 * Pass `db` (a transaction client) to write the row in the same transaction as the change.
 */
export async function audit(
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  changes?: Prisma.InputJsonValue,
  ip?: string,
  db: Prisma.TransactionClient = prisma,
): Promise<void> {
  assertNoPersonalKeys(changes);
  await db.auditLog.create({ data: { actorId, action, targetType, targetId, changes, ip } });
}
