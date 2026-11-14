import type { Prisma } from '@prisma/client';
import { prisma } from '../db';

/** Records an Admin action. `changes` holds field names and non-personal values only. */
export async function audit(
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  changes?: Prisma.InputJsonValue,
  ip?: string,
): Promise<void> {
  await prisma.auditLog.create({ data: { actorId, action, targetType, targetId, changes, ip } });
}
