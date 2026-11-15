import type { LoginSession, Prisma, User } from '@prisma/client';
import { defer } from '../../lib/afterCommit';
import { prisma } from '../../db';
import { randomToken, sha256 } from '../../lib/crypto';

export const TOUCH_INTERVAL_MS = 10 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export type SessionWithUser = LoginSession & { user: User };

/** Hook so sockets can be told to leave (07 §1); set by the socket server. */
type RevokeListener = (userId: string, exceptSessionId?: string) => void;
let onRevoke: RevokeListener = () => {};
export const setRevokeListener = (fn: RevokeListener): void => {
  onRevoke = fn;
};

export function sessionExpiry(role: User['role'], now = new Date()): Date {
  // Admin: 12 hours, not sliding. Others: 30 days sliding.
  return new Date(now.getTime() + (role === 'admin' ? 12 * 60 * 60 * 1000 : 30 * DAY));
}

export async function createSession(
  user: User,
  opts: { ip?: string; userAgent?: string } = {},
): Promise<{ token: string; session: LoginSession }> {
  const token = randomToken(32);
  const session = await prisma.loginSession.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: sessionExpiry(user.role),
      ip: opts.ip,
      userAgent: opts.userAgent?.slice(0, 300),
    },
  });
  return { token, session };
}

export async function lookup(token: string): Promise<SessionWithUser | null> {
  return prisma.loginSession.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
}

/** Valid = not revoked, not expired, user active. */
export function isLive(s: SessionWithUser, now = new Date()): boolean {
  return !s.revokedAt && s.expiresAt > now && s.user.status === 'active';
}

/** Sliding refresh for non-Admin sessions, at most once per 10 minutes. */
export async function touch(s: SessionWithUser, now = new Date()): Promise<void> {
  if (s.user.role === 'admin') return;
  if (now.getTime() - s.lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return;
  await prisma.loginSession.update({
    where: { id: s.id },
    data: { lastSeenAt: now, expiresAt: sessionExpiry(s.user.role, now) },
  });
}

export async function revoke(id: string): Promise<void> {
  await prisma.loginSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** The single choke point for ending sessions (02 §1). */
export async function revokeAllSessions(userId: string, exceptSessionId?: string, db: Prisma.TransactionClient = prisma): Promise<void> {
  await db.loginSession.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
  defer(() => onRevoke(userId, exceptSessionId));
}

/** Bulk `revokeAllSessions`: one query for all users; live sockets are told per user after commit. */
export async function revokeSessionsForMany(userIds: string[], db: Prisma.TransactionClient = prisma): Promise<void> {
  if (!userIds.length) return;
  await db.loginSession.updateMany({ where: { userId: { in: userIds }, revokedAt: null }, data: { revokedAt: new Date() } });
  for (const id of userIds) defer(() => onRevoke(id));
}
