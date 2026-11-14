import { Prisma, type Role } from '@prisma/client';
import { SECTION_MAX } from '@cms/shared';
import { prisma } from '../../db';
import { transaction } from '../../lib/afterCommit';
import { SECTION_FULL_MESSAGE, activeStudentCount, lockSection } from '../../lib/activeStudent';
import { audit } from '../../lib/audit';
import { chatMembership } from '../../lib/chatMembership';
import { closedSessionGuard } from '../../lib/closedSession';
import { hashPassword } from '../../lib/crypto';
import { AppError } from '../../lib/http';
import { checkPassword } from '../../lib/passwordPolicy';
import { generatePassword } from '../../lib/passwordGen';
import { enrollInSection } from '../academics/offerings';
import { revokeAllSessions } from '../auth/sessions';

type Tx = Prisma.TransactionClient;

// ───── login ID + password ─────
/** Next number of a counter row in `Setting`, taken under a row lock so ids never repeat or skip (plan 03 step 7). */
async function nextSeq(tx: Tx, key: string): Promise<number> {
  await tx.$executeRaw(Prisma.sql`INSERT INTO settings ("key", value, updated_at) VALUES (${key}, to_jsonb(0), now()) ON CONFLICT ("key") DO NOTHING`);
  const rows = await tx.$queryRaw<{ value: unknown }[]>(Prisma.sql`SELECT value FROM settings WHERE "key" = ${key} FOR UPDATE`);
  const n = Number(rows[0]!.value) + 1;
  await tx.$executeRaw(Prisma.sql`UPDATE settings SET value = to_jsonb(${n}::int), updated_at = now() WHERE "key" = ${key}`);
  return n;
}

const pad = (n: number) => String(n).padStart(4, '0');

/** Students: `S-<sessionStartYear>-<4-digit seq>`; teachers: `T-<4-digit seq>`. Skips ids an Admin already typed by hand. */
export async function generateLoginId(tx: Tx, kind: { student: string } | 'teacher'): Promise<string> {
  for (;;) {
    const id =
      kind === 'teacher'
        ? `T-${pad(await nextSeq(tx, 'login_seq:T'))}`
        : `S-${kind.student}-${pad(await nextSeq(tx, `login_seq:${kind.student}`))}`;
    if (!(await tx.user.findFirst({ where: { loginId: { equals: id, mode: 'insensitive' } }, select: { id: true } }))) return id;
  }
}

export const sessionStartYear = (name: string): string => name.slice(0, 4);

/** Admin-typed password must satisfy the policy; otherwise a fresh one is generated. */
export function resolvePassword(typed: string | undefined, loginId: string | null): string {
  if (!typed) return generatePassword();
  const bad = checkPassword(typed, { loginId });
  if (bad) throw new AppError('VALIDATION_ERROR', 400, bad, { password: bad });
  return typed;
}

// ───── create ─────
export interface NewStudent {
  name: string;
  roll: string;
  email: string;
  sectionId: string;
  loginId?: string;
}

async function assertFreeIdentity(tx: Tx, email: string, loginId?: string): Promise<void> {
  if (await tx.user.findUnique({ where: { email } })) throw new AppError('CONFLICT', 409, 'This email is already used.', { email: 'duplicate' });
  if (loginId && (await tx.user.findFirst({ where: { loginId: { equals: loginId, mode: 'insensitive' } }, select: { id: true } })))
    throw new AppError('CONFLICT', 409, 'This login ID is already used.', { loginId: 'duplicate' });
}

/** Caller holds the section lock and has checked the 30-limit and the closed session. */
export async function insertStudent(tx: Tx, input: NewStudent, sessionName: string, passwordHash: string): Promise<{ id: string; loginId: string }> {
  await assertFreeIdentity(tx, input.email, input.loginId);
  if (await tx.studentProfile.findUnique({ where: { sectionId_roll: { sectionId: input.sectionId, roll: input.roll } } }))
    throw new AppError('CONFLICT', 409, 'This roll number is already used in the section.', { roll: 'duplicate' });
  const loginId = input.loginId ?? (await generateLoginId(tx, { student: sessionStartYear(sessionName) }));
  const user = await tx.user.create({
    data: {
      role: 'student', loginId, email: input.email, passwordHash, status: 'active', firstLogin: true, mustChangePassword: true,
      student: { create: { name: input.name, roll: input.roll, sectionId: input.sectionId } },
    },
    select: { id: true },
  });
  await enrollInSection(tx, user.id, input.sectionId);
  await chatMembership.sync(user.id, tx);
  return { id: user.id, loginId };
}

export async function createStudent(actorId: string, input: NewStudent & { password?: string }, ip?: string) {
  const password = resolvePassword(input.password, input.loginId ?? null);
  const passwordHash = await hashPassword(password);
  const created = await transaction(async (tx) => {
    const sec = await lockSection(tx, input.sectionId);
    if (!sec || sec.deleted) throw new AppError('NOT_FOUND', 404, 'Section not found.');
    await closedSessionGuard({ sectionId: input.sectionId }, tx);
    if ((await activeStudentCount(tx, input.sectionId)) >= SECTION_MAX)
      throw new AppError('SECTION_FULL', 409, SECTION_FULL_MESSAGE, { sectionId: input.sectionId });
    const session = await tx.section.findUniqueOrThrow({ where: { id: input.sectionId }, select: { group: { select: { session: { select: { name: true } } } } } });
    const s = await insertStudent(tx, input, session.group.session.name, passwordHash);
    await audit(actorId, 'student.create', 'user', s.id, { sectionId: input.sectionId }, ip, tx);
    return s;
  });
  return { id: created.id, loginId: created.loginId, password, sectionId: input.sectionId };
}

export interface NewTeacher {
  name: string;
  email: string;
  designation?: string;
  subjects: string[];
  loginId?: string;
}

export async function insertTeacher(tx: Tx, input: NewTeacher, passwordHash: string): Promise<{ id: string; loginId: string }> {
  await assertFreeIdentity(tx, input.email, input.loginId);
  const loginId = input.loginId ?? (await generateLoginId(tx, 'teacher'));
  const user = await tx.user.create({
    data: {
      role: 'teacher', loginId, email: input.email, passwordHash, status: 'active', firstLogin: true, mustChangePassword: true,
      teacher: { create: { name: input.name, designation: input.designation, subjects: input.subjects } },
    },
    select: { id: true },
  });
  return { id: user.id, loginId };
}

export async function createTeacher(actorId: string, input: NewTeacher & { password?: string }, ip?: string) {
  const password = resolvePassword(input.password, input.loginId ?? null);
  const passwordHash = await hashPassword(password);
  const created = await transaction(async (tx) => {
    const t = await insertTeacher(tx, input, passwordHash);
    await audit(actorId, 'teacher.create', 'user', t.id, undefined, ip, tx);
    return t;
  });
  return { id: created.id, loginId: created.loginId, password };
}

// ───── edit / reset / status ─────
async function managedUser(tx: Tx, id: string, roles: Role[] = ['student', 'teacher']) {
  const u = await tx.user.findFirst({
    where: { id, role: { in: roles }, status: { not: 'deleted' } },
    include: { student: { select: { sectionId: true } }, teacher: { select: { userId: true } } },
  });
  if (!u) throw new AppError('NOT_FOUND', 404, 'User not found.');
  return u;
}

export interface UserPatch {
  name?: string;
  loginId?: string;
  email?: string;
  designation?: string | null;
  subjects?: string[];
  nameLocked?: boolean;
  roll?: string;
}

export async function editUser(actorId: string, userId: string, patch: UserPatch, ip?: string): Promise<{ emailChanged: boolean; email: string | null }> {
  return transaction(async (tx) => {
    const u = await managedUser(tx, userId);
    const isStudent = u.role === 'student';
    if (isStudent) await closedSessionGuard({ studentId: userId }, tx);
    if (!isStudent && (patch.roll !== undefined || patch.nameLocked !== undefined))
      throw new AppError('VALIDATION_ERROR', 400, 'Roll and name lock apply to students only.');
    if (isStudent && (patch.designation !== undefined || patch.subjects !== undefined))
      throw new AppError('VALIDATION_ERROR', 400, 'Designation and subjects apply to teachers only.');
    if (patch.loginId && patch.loginId.toLowerCase() !== u.loginId?.toLowerCase() &&
      (await tx.user.findFirst({ where: { loginId: { equals: patch.loginId, mode: 'insensitive' }, id: { not: userId } }, select: { id: true } })))
      throw new AppError('CONFLICT', 409, 'This login ID is already used.', { loginId: 'duplicate' });
    const emailChanged = patch.email !== undefined && patch.email !== u.email;
    if (emailChanged && (await tx.user.findFirst({ where: { email: patch.email, id: { not: userId } }, select: { id: true } })))
      throw new AppError('CONFLICT', 409, 'This email is already used.', { email: 'duplicate' });
    if (isStudent && patch.roll && patch.roll !== (await tx.studentProfile.findUniqueOrThrow({ where: { userId } })).roll &&
      (await tx.studentProfile.findUnique({ where: { sectionId_roll: { sectionId: u.student!.sectionId, roll: patch.roll } } })))
      throw new AppError('CONFLICT', 409, 'This roll number is already used in the section.', { roll: 'duplicate' });

    await tx.user.update({
      where: { id: userId },
      data: {
        ...(patch.loginId !== undefined ? { loginId: patch.loginId } : {}),
        ...(emailChanged ? { email: patch.email, emailVerifiedAt: null } : {}),
      },
    });
    if (isStudent) {
      await tx.studentProfile.update({
        where: { userId },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.nameLocked !== undefined ? { nameLocked: patch.nameLocked } : {}),
          ...(patch.roll !== undefined ? { roll: patch.roll } : {}),
        },
      });
    } else {
      await tx.teacherProfile.update({
        where: { userId },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.designation !== undefined ? { designation: patch.designation } : {}),
          ...(patch.subjects !== undefined ? { subjects: patch.subjects } : {}),
        },
      });
    }
    await audit(actorId, 'user.edit', 'user', userId, { fields: Object.keys(patch) }, ip, tx);
    return { emailChanged, email: emailChanged ? (patch.email ?? null) : null };
  });
}

export async function resetPassword(actorId: string, userId: string, typed: string | undefined, ip?: string): Promise<string> {
  const u = await prisma.user.findFirst({ where: { id: userId, role: { in: ['student', 'teacher'] }, status: { not: 'deleted' } } });
  if (!u) throw new AppError('NOT_FOUND', 404, 'User not found.');
  const password = resolvePassword(typed, u.loginId);
  const passwordHash = await hashPassword(password);
  await transaction(async (tx) => {
    if (u.role === 'student') await closedSessionGuard({ studentId: userId }, tx);
    await tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: true, firstLogin: true } });
    await revokeAllSessions(userId, undefined, tx); // same transaction: never a new password with live old sessions
    await audit(actorId, 'user.reset_password', 'user', userId, undefined, ip, tx);
  });
  return password;
}

export async function deactivate(actorId: string, userId: string, ip?: string): Promise<void> {
  await transaction(async (tx) => {
    const u = await managedUser(tx, userId);
    if (u.role === 'student') await closedSessionGuard({ studentId: userId }, tx);
    if (u.status !== 'active') throw new AppError('CONFLICT', 409, 'Only an active account can be deactivated.');
    await tx.user.update({ where: { id: userId }, data: { status: 'inactive' } });
    await revokeAllSessions(userId, undefined, tx);
    await audit(actorId, 'user.deactivate', 'user', userId, undefined, ip, tx);
  });
}

export async function reactivate(actorId: string, userId: string, ip?: string): Promise<void> {
  await transaction(async (tx) => {
    const u = await managedUser(tx, userId);
    if (u.status !== 'inactive') throw new AppError('CONFLICT', 409, 'Only an inactive account can be reactivated.');
    if (u.student) {
      await lockSection(tx, u.student.sectionId);
      await closedSessionGuard({ sectionId: u.student.sectionId }, tx);
      // Inactive students do not count toward 30, so coming back must respect the limit.
      if ((await activeStudentCount(tx, u.student.sectionId)) >= SECTION_MAX)
        throw new AppError('SECTION_FULL', 409, SECTION_FULL_MESSAGE, { sectionId: u.student.sectionId });
    }
    await tx.user.update({ where: { id: userId }, data: { status: 'active' } });
    await chatMembership.sync(userId, tx);
    await audit(actorId, 'user.reactivate', 'user', userId, undefined, ip, tx);
  });
}

/** Permanent delete = anonymise (§5.5). Posts, comments and messages stay under "Deleted user". */
export async function anonymise(actorId: string, userId: string, confirmLoginId: string, ip?: string): Promise<void> {
  await transaction(
    async (tx) => {
      const u = await tx.user.findFirst({ where: { id: userId, role: { in: ['student', 'teacher'] } } });
      if (!u || u.status === 'deleted') throw new AppError('NOT_FOUND', 404, 'User not found.');
      if (!u.loginId || u.loginId.toLowerCase() !== confirmLoginId.toLowerCase())
        throw new AppError('VALIDATION_ERROR', 400, 'Type the login ID to confirm.', { confirmLoginId: 'mismatch' });
      const attempt = await tx.examAttempt.count({ where: { studentId: userId, status: 'in_progress' } });
      if (attempt > 0) throw new AppError('ATTEMPT_IN_PROGRESS', 409, 'This student has an exam in progress. Delete after it ends.');
      if (u.role === 'teacher') {
        const running = await tx.courseOffering.count({
          where: { teacherId: userId, endedAt: null, section: { deletedAt: null, group: { session: { status: 'active' } } } },
        });
        if (running > 0) throw new AppError('CONFLICT', 409, 'Reassign this teacher\'s courses before deleting the account.');
        await tx.section.updateMany({ where: { mentorTeacherId: userId }, data: { mentorTeacherId: null } });
      }
      await tx.aIConversation.deleteMany({ where: { studentId: userId } }); // messages cascade (PRD §5.20)
      await tx.token.deleteMany({ where: { userId } });
      await tx.pushSubscription.deleteMany({ where: { userId } });
      await tx.notificationPref.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.loginHistory.deleteMany({ where: { userId } });
      if (u.avatarId) await tx.storageObject.update({ where: { id: u.avatarId }, data: { deletedAt: new Date() } });
      await tx.user.update({
        where: { id: userId },
        data: {
          loginId: null, email: null, mobile: null, passwordHash: null, avatarId: null, totpSecretEnc: null, totpPendingSecretEnc: null,
          totpEnabledAt: null, totpLastStep: null, backupCodeHashes: [], status: 'deleted', anonymisedAt: new Date(),
        },
      });
      if (u.role === 'student') {
        await tx.studentProfile.update({
          where: { userId },
          data: { name: 'Deleted user', bio: null, dob: null, address: null, guardianName: null, guardianContact: null },
        });
        await tx.enrollment.updateMany({ where: { studentId: userId, status: 'active' }, data: { status: 'ended', endedAt: new Date() } });
      } else {
        await tx.teacherProfile.update({ where: { userId }, data: { name: 'Deleted user', bio: null, designation: null, subjects: [] } });
      }
      await chatMembership.sync(userId, tx);
      await revokeAllSessions(userId, undefined, tx);
      await audit(actorId, 'user.anonymise', 'user', userId, { role: u.role }, ip, tx);
    },
    { timeout: 30_000 },
  );
}

// ───── move & promote ─────
export async function moveStudents(
  actorId: string,
  input: { studentIds?: string[]; wholeSectionId?: string; targetSectionId: string },
  ip?: string,
): Promise<{ moved: number }> {
  return transaction(
    async (tx) => {
      const target = await lockSection(tx, input.targetSectionId);
      if (!target || target.deleted) throw new AppError('NOT_FOUND', 404, 'Target section not found.');
      await closedSessionGuard({ sectionId: input.targetSectionId }, tx);
      const tsec = await tx.section.findUniqueOrThrow({ where: { id: input.targetSectionId }, select: { group: { select: { sessionId: true } } } });

      const students = await tx.studentProfile.findMany({
        where: input.wholeSectionId
          ? { sectionId: input.wholeSectionId, user: { status: 'active' } }
          : { userId: { in: [...new Set(input.studentIds)] }, user: { status: 'active', role: 'student' } },
        select: { userId: true, roll: true, sectionId: true, section: { select: { group: { select: { sessionId: true } } } } },
        orderBy: { userId: 'asc' },
      });
      const wanted = input.wholeSectionId ? students.length : new Set(input.studentIds).size;
      if (students.length === 0 || students.length !== wanted)
        throw new AppError('VALIDATION_ERROR', 400, 'Choose active students to move.', { studentIds: 'invalid' });
      // Row locks on the students so two moves of the same student cannot interleave.
      await tx.$queryRaw(Prisma.sql`SELECT user_id FROM student_profiles WHERE user_id IN (${Prisma.join(students.map((s) => s.userId))}) ORDER BY user_id FOR UPDATE`);

      for (const s of students) {
        if (s.sectionId === input.targetSectionId) throw new AppError('VALIDATION_ERROR', 400, 'A student is already in the target section.', { studentIds: s.userId });
        if (s.section.group.sessionId !== tsec.group.sessionId)
          throw new AppError('VALIDATION_ERROR', 400, 'Students can only move within the same session.', { targetSectionId: 'other_session' });
      }
      for (const sectionId of new Set(students.map((s) => s.sectionId))) await closedSessionGuard({ sectionId }, tx);

      const running = await tx.examAttempt.findMany({ where: { studentId: { in: students.map((s) => s.userId) }, status: 'in_progress' }, select: { studentId: true } });
      if (running.length)
        throw new AppError('ATTEMPT_IN_PROGRESS', 409, 'A student has an exam in progress. Move them after it ends.', { studentIds: [...new Set(running.map((r) => r.studentId))].join(',') });

      if ((await activeStudentCount(tx, input.targetSectionId)) + students.length > SECTION_MAX)
        throw new AppError('SECTION_FULL', 409, SECTION_FULL_MESSAGE, { sectionId: input.targetSectionId });

      const rolls = await tx.studentProfile.findMany({ where: { sectionId: input.targetSectionId, roll: { in: students.map((s) => s.roll) } }, select: { roll: true } });
      const clash = new Set(rolls.map((r) => r.roll));
      if (clash.size) throw new AppError('CONFLICT', 409, 'Some roll numbers already exist in the target section. Change them first.', { roll: [...clash].join(',') });

      const now = new Date();
      for (const s of students) {
        await tx.enrollment.updateMany({ where: { studentId: s.userId, status: 'active' }, data: { status: 'ended', endedAt: now } });
        await tx.studentProfile.update({ where: { userId: s.userId }, data: { sectionId: input.targetSectionId } });
        await enrollInSection(tx, s.userId, input.targetSectionId);
        await chatMembership.sync(s.userId, tx);
      }
      await audit(actorId, 'student.move', 'section', input.targetSectionId, { count: students.length, studentIds: students.map((s) => s.userId) }, ip, tx);
      return { moved: students.length };
    },
    { timeout: 60_000 },
  );
}
