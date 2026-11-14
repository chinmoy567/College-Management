import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from './http';

type Db = Prisma.TransactionClient;
export type SessionTarget =
  | { sessionId: string }
  | { groupId: string }
  | { sectionId: string }
  | { offeringId: string }
  | { studentId: string };

const viaSection = { select: { group: { select: { sessionId: true } } } } as const;

/** Resolves the Session id a write targets; null when the target does not exist. */
export async function sessionIdOf(db: Db, t: SessionTarget): Promise<string | null> {
  if ('sessionId' in t) return t.sessionId;
  if ('groupId' in t) return (await db.group.findUnique({ where: { id: t.groupId }, select: { sessionId: true } }))?.sessionId ?? null;
  if ('sectionId' in t) return (await db.section.findUnique({ where: { id: t.sectionId }, ...viaSection }))?.group.sessionId ?? null;
  if ('offeringId' in t)
    return (await db.courseOffering.findUnique({ where: { id: t.offeringId }, select: { section: viaSection } }))?.section.group.sessionId ?? null;
  return (await db.studentProfile.findUnique({ where: { userId: t.studentId }, select: { section: viaSection } }))?.section.group.sessionId ?? null;
}

/** 409 SESSION_CLOSED when the target belongs to a closed session (ACAD-11). Every write service calls this. */
export async function closedSessionGuard(t: SessionTarget, db: Db = prisma): Promise<void> {
  const sid = await sessionIdOf(db, t);
  if (!sid) return; // the caller's own lookup reports NOT_FOUND
  // Inside a transaction, FOR SHARE makes a concurrent close-session (FOR UPDATE) wait for us, or us for it.
  const rows =
    db === prisma
      ? await db.session.findMany({ where: { id: sid }, select: { status: true } })
      : await db.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text AS status FROM sessions WHERE id = ${sid} FOR SHARE`);
  if (rows[0]?.status === 'closed') throw new AppError('SESSION_CLOSED', 409, 'This session is closed. Its data is read-only.');
}
