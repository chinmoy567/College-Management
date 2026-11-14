import { Prisma } from '@prisma/client';
import { SECTION_MAX } from '@cms/shared';

type Db = Prisma.TransactionClient;

/** The single definition of "counts toward the 30-student limit": status = 'active' (inactive, passed-out, deleted never count). */
export const ACTIVE_STUDENT_WHERE = { user: { status: 'active' as const } };

export const activeStudentCount = (db: Db, sectionId: string): Promise<number> =>
  db.studentProfile.count({ where: { sectionId, ...ACTIVE_STUDENT_WHERE } });

/** Locks the section row for the rest of the transaction so the limit holds under concurrency. */
export async function lockSection(db: Db, sectionId: string): Promise<{ id: string; deleted: boolean } | null> {
  const rows = await db.$queryRaw<{ id: string; deleted_at: Date | null }[]>(
    Prisma.sql`SELECT id, deleted_at FROM sections WHERE id = ${sectionId} FOR UPDATE`,
  );
  return rows[0] ? { id: rows[0].id, deleted: rows[0].deleted_at !== null } : null;
}

export const SECTION_FULL_MESSAGE = `This section already has ${SECTION_MAX} students. Choose another section or create a new one.`;
