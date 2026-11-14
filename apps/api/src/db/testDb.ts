import pg from 'pg';
import { PrismaClient } from '@prisma/client';

/** Shared helpers for the database integration tests (DATABASE_URL is set by test/globalSetup.ts). */
let seq = 0;
export const uid = (p: string) => `${p}-${process.pid}-${Date.now().toString(36)}-${++seq}`;

export function newPrisma(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
}

export function newPool(): pg.Pool {
  return new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
}

/** Runs a statement and returns the Postgres error code (SQLSTATE), or null when it succeeded. */
export async function sqlState(pool: pg.Pool, text: string, values: unknown[] = []): Promise<string | null> {
  try {
    await pool.query(text, values);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'unknown';
  }
}

export const CHECK_VIOLATION = '23514';
export const UNIQUE_VIOLATION = '23505';

/** Minimal valid parents so a constraint test only has to supply the row under test. */
export async function makeAcademic(prisma: PrismaClient) {
  const session = await prisma.session.create({ data: { name: uid('sess') } });
  const group = await prisma.group.create({ data: { sessionId: session.id, type: 'science' } });
  const section = await prisma.section.create({ data: { groupId: group.id, classLevel: 11, name: 'A' } });
  const teacherUser = await prisma.user.create({
    data: { role: 'teacher', loginId: uid('T'), teacher: { create: { name: 'Test Teacher' } } },
  });
  const studentUser = await prisma.user.create({
    data: { role: 'student', loginId: uid('S'), student: { create: { name: 'Test Student', sectionId: section.id, roll: '01' } } },
  });
  const course = await prisma.course.create({
    data: { code: uid('C'), name: 'Test Course', groupType: 'science', classLevel: 'c11' },
  });
  const offering = await prisma.courseOffering.create({
    data: { sectionId: section.id, courseId: course.id, teacherId: teacherUser.id },
  });
  return { session, group, section, teacherUser, studentUser, course, offering };
}
