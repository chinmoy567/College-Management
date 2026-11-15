import { Prisma } from '@prisma/client';
import { transaction } from '../../lib/afterCommit';
import { audit } from '../../lib/audit';
import { chatMembership } from '../../lib/chatMembership';
import { AppError } from '../../lib/http';
import { finaliseAttempt } from '../exams/finalise';
import { revokeSessionsForMany } from '../auth/sessions';

type Tx = Prisma.TransactionClient;

/** Auto-submits running attempts, then marks the students passed out and leaves their chats. */
async function passOutInTx(tx: Tx, studentIds: string[]): Promise<void> {
  if (!studentIds.length) return;
  const running = await tx.examAttempt.findMany({ where: { studentId: { in: studentIds }, status: 'in_progress' }, select: { id: true } });
  for (const a of running) await finaliseAttempt(a.id, 'passed_out', tx);
  const now = new Date();
  await tx.user.updateMany({ where: { id: { in: studentIds } }, data: { status: 'passed_out' } });
  await tx.studentProfile.updateMany({ where: { userId: { in: studentIds } }, data: { passedOutAt: now } });
  await chatMembership.leaveAll(studentIds, tx);
}
/** Closes a session: every active student passes out, sessions end, chats are left (PRD §4.5). Admin-triggered only. */
export async function closeSession(actorId: string, sessionId: string, ip?: string): Promise<{ closedAt: Date; passedOut: number }> {
  const out = await transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; status: string }[]>(Prisma.sql`SELECT id, status FROM sessions WHERE id = ${sessionId} FOR UPDATE`);
      if (!rows[0]) throw new AppError('NOT_FOUND', 404, 'Session not found.');
      if (rows[0].status === 'closed') throw new AppError('SESSION_CLOSED', 409, 'This session is already closed.');
      const students = await tx.studentProfile.findMany({
        where: { section: { group: { sessionId } }, user: { status: 'active' } },
        select: { userId: true },
      });
      const ids = students.map((s) => s.userId);
      await passOutInTx(tx, ids);
      const closedAt = new Date();
      await tx.session.update({ where: { id: sessionId }, data: { status: 'closed', closedAt } });
      // Teachers and mentors of a closed session leave its chats too.
      const staff = await tx.courseOffering.findMany({ where: { section: { group: { sessionId } }, endedAt: null }, select: { teacherId: true } });
      const mentors = await tx.section.findMany({ where: { group: { sessionId }, mentorTeacherId: { not: null } }, select: { mentorTeacherId: true } });
      await chatMembership.syncMany([...staff.map((s) => s.teacherId), ...mentors.map((m) => m.mentorTeacherId!)], tx);
      await revokeSessionsForMany(ids, tx);
      await audit(actorId, 'session.close', 'session', sessionId, { passedOut: ids.length }, ip, tx);
      return { closedAt, ids };
    },
    { timeout: 60_000 },
  );
  return { closedAt: out.closedAt, passedOut: out.ids.length };
}

/** Individual pass-out (PRD §4.5). Only active students; a closed session already passed everyone out. */
export async function passOutStudents(actorId: string, studentIds: string[], ip?: string): Promise<{ passedOut: number }> {
  const ids = [...new Set(studentIds)];
  await transaction(
    async (tx) => {
      const found = await tx.user.findMany({ where: { id: { in: ids }, role: 'student', status: 'active' }, select: { id: true } });
      if (found.length !== ids.length) throw new AppError('VALIDATION_ERROR', 400, 'Only active students can be passed out.', { studentIds: 'invalid' });
      await passOutInTx(tx, ids);
      await revokeSessionsForMany(ids, tx);
      await audit(actorId, 'student.pass_out', 'user', ids[0]!, { count: ids.length, studentIds: ids }, ip, tx);
    },
    { timeout: 60_000 },
  );
  return { passedOut: ids.length };
}
