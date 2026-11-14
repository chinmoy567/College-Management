import { prisma } from '../db';
import { now } from './clock';
import { AppError } from './http';

/** The active mute of a user, or null (06 §6.2). */
export async function activeMute(userId: string): Promise<{ endsAt: Date } | null> {
  const t = now();
  const m = await prisma.userSanction.findFirst({
    where: { userId, type: 'mute', liftedAt: null, startsAt: { lte: t }, endsAt: { gt: t } },
    orderBy: { endsAt: 'desc' },
    select: { endsAt: true },
  });
  return m?.endsAt ? { endsAt: m.endsAt } : null;
}

/** Throws 403 MUTED with the end time. Call before every post, comment and chat message. */
export async function assertNotMuted(userId: string): Promise<void> {
  const m = await activeMute(userId);
  if (m) throw new AppError('MUTED', 403, 'You are muted and cannot post right now.', { endsAt: m.endsAt.toISOString() });
}
