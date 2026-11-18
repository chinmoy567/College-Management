import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type pg from 'pg';
import { CHECK_VIOLATION, UNIQUE_VIOLATION, makeAcademic, newPool, newPrisma, sqlState, uid } from './testDb';

let prisma: PrismaClient;
let pool: pg.Pool;
let a: Awaited<ReturnType<typeof makeAcademic>>;

beforeAll(async () => {
  prisma = newPrisma();
  pool = newPool();
  a = await makeAcademic(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

const insertSection = (cls: number, name: string, groupId = a.group.id, deleted = false) =>
  sqlState(
    pool,
    `INSERT INTO sections (id, group_id, class_level, name, deleted_at) VALUES ($1,$2,$3,$4,${deleted ? 'now()' : 'NULL'})`,
    [uid('sec'), groupId, cls, name],
  );

const insertExam = (o: { start?: string; end?: string; dur?: number; total?: number; pass?: number }) =>
  sqlState(
    pool,
    `INSERT INTO exams (id, course_offering_id, created_by, kind, title, start_at, end_at, duration_min, total_marks, pass_marks, updated_at)
     VALUES ($1,$2,$3,'exam','T',$4,$5,$6,$7,$8,now())`,
    [uid('ex'), a.offering.id, a.teacherUser.id, o.start ?? '2026-01-01T10:00:00Z', o.end ?? '2026-01-01T12:00:00Z', o.dur ?? 60, o.total ?? 100, o.pass ?? 33],
  );

describe('database constraints', () => {
  it('[DB-03] section class level must be 11 or 12', async () => {
    expect(await insertSection(10, 'X')).toBe(CHECK_VIOLATION);
    expect(await insertSection(12, 'X')).toBeNull();
  });

  it('[DB-03] section name is unique per group + class among live sections only', async () => {
    expect(await insertSection(11, 'B')).toBeNull();
    expect(await insertSection(11, 'B')).toBe(UNIQUE_VIOLATION);
    expect(await insertSection(12, 'B')).toBeNull(); // other class
    expect(await insertSection(11, 'C', a.group.id, true)).toBeNull(); // deleted rows do not block
    expect(await insertSection(11, 'C')).toBeNull();
  });

  it('[DB-03] one active enrollment per student + offering', async () => {
    const ins = (status: string) =>
      sqlState(pool, `INSERT INTO enrollments (id, course_offering_id, student_id, status) VALUES ($1,$2,$3,$4::"enrollment_status")`, [
        uid('en'), a.offering.id, a.studentUser.id, status,
      ]);
    expect(await ins('active')).toBeNull();
    expect(await ins('active')).toBe(UNIQUE_VIOLATION);
    expect(await ins('ended')).toBeNull(); // history rows are allowed
  });

  it('[DB-03] one in-progress attempt per student + exam', async () => {
    const examId = uid('ex');
    await pool.query(
      `INSERT INTO exams (id, course_offering_id, created_by, kind, title, start_at, end_at, duration_min, total_marks, pass_marks, updated_at)
       VALUES ($1,$2,$3,'exam','T','2026-01-01T10:00:00Z','2026-01-01T12:00:00Z',60,100,33,now())`,
      [examId, a.offering.id, a.teacherUser.id],
    );
    const ins = (no: number, status: string) =>
      sqlState(
        pool,
        `INSERT INTO exam_attempts (id, exam_id, student_id, attempt_no, section_id, deadline_at, question_order, status)
         VALUES ($1,$2,$3,$4,$5,now(),'[]'::jsonb,$6::"attempt_status")`,
        [uid('at'), examId, a.studentUser.id, no, a.section.id, status],
      );
    expect(await ins(1, 'in_progress')).toBeNull();
    expect(await ins(2, 'in_progress')).toBe(UNIQUE_VIOLATION);
    expect(await ins(2, 'submitted')).toBeNull();
    expect(await ins(2, 'submitted')).toBe(UNIQUE_VIOLATION); // (exam, student, attempt_no) stays unique
  });

  it('[DB-03] a reaction targets exactly one of post or comment', async () => {
    const post = await prisma.post.create({ data: { authorId: a.teacherUser.id, text: 'hi' } });
    const comment = await prisma.comment.create({ data: { postId: post.id, authorId: a.teacherUser.id, text: 'c' } });
    const ins = (p: string | null, c: string | null) =>
      sqlState(pool, `INSERT INTO reactions (id, user_id, post_id, comment_id, type) VALUES ($1,$2,$3,$4,'like')`, [uid('re'), a.studentUser.id, p, c]);
    expect(await ins(null, null)).toBe(CHECK_VIOLATION);
    expect(await ins(post.id, comment.id)).toBe(CHECK_VIOLATION);
    expect(await ins(post.id, null)).toBeNull();
  });

  it('[DB-03] exam window must end after it starts', async () => {
    expect(await insertExam({ end: '2026-01-01T10:00:00Z' })).toBe(CHECK_VIOLATION);
    expect(await insertExam({ end: '2026-01-01T09:00:00Z' })).toBe(CHECK_VIOLATION);
    expect(await insertExam({})).toBeNull();
  });

  it('[DB-03] exam duration must be one of 15, 30, 45, 60, 90, 120', async () => {
    expect(await insertExam({ dur: 20 })).toBe(CHECK_VIOLATION);
    expect(await insertExam({ dur: 120 })).toBeNull();
  });

  it('[DB-03] exam pass marks can not exceed total marks', async () => {
    expect(await insertExam({ total: 50, pass: 60 })).toBe(CHECK_VIOLATION);
    expect(await insertExam({ total: 50, pass: 50 })).toBeNull();
  });

  it('[DB-03] period end time must be after start time', async () => {
    const ins = (s: string, e: string) => sqlState(pool, `INSERT INTO periods (id, name, start_time, end_time) VALUES ($1,'P',$2,$3)`, [uid('pe'), s, e]);
    expect(await ins('09:00', '09:00')).toBe(CHECK_VIOLATION);
    expect(await ins('09:00', '08:00')).toBe(CHECK_VIOLATION);
    expect(await ins('08:00', '08:45')).toBeNull();
  });

  it('[DB-03] holiday end date can not be before its start date', async () => {
    const ins = (s: string, e: string) =>
      sqlState(pool, `INSERT INTO holidays (id, start_date, end_date, title, created_by) VALUES ($1,$2,$3,'H',$4)`, [uid('ho'), s, e, a.teacherUser.id]);
    expect(await ins('2026-02-02', '2026-02-01')).toBe(CHECK_VIOLATION);
    expect(await ins('2026-02-01', '2026-02-01')).toBeNull();
  });

  it('[DB-03] one routine slot creates one meeting per day, even after the meeting is moved', async () => {
    const period = await prisma.period.create({ data: { name: 'P', startTime: new Date('1970-01-01T08:00:00Z'), endTime: new Date('1970-01-01T08:45:00Z') } });
    const slot = await prisma.routineSlot.create({ data: { day: 'sun', periodId: period.id } });
    const ins = (date: string, original: string | null, slotId: string | null = slot.id) =>
      sqlState(
        pool,
        `INSERT INTO class_meetings (id, routine_slot_id, date, original_date, start_time, end_time, teacher_id)
         VALUES ($1,$2,$3,$4,'08:00','08:45',$5)`,
        [uid('cm'), slotId, date, original, a.teacherUser.id],
      );
    expect(await ins('2026-03-01', null)).toBeNull();
    expect(await ins('2026-03-01', null)).toBe(UNIQUE_VIOLATION);
    // a meeting moved here from 2026-03-01 still occupies that routine day
    expect(await ins('2026-03-05', '2026-03-01')).toBe(UNIQUE_VIOLATION);
    expect(await ins('2026-03-08', null)).toBeNull();
    // extra classes (no routine slot) are never limited
    expect(await ins('2026-03-01', null, null)).toBeNull();
    expect(await ins('2026-03-01', null, null)).toBeNull();
  });

  it('[DB-03] special days are unique per date + session, treating "whole college" as one value', async () => {
    const ins = (date: string, sessionId: string | null) =>
      sqlState(pool, `INSERT INTO special_days (id, date, title, session_id, period_ids, created_by) VALUES ($1,$2,'S',$3,'{}',$4)`, [uid('sd'), date, sessionId, a.teacherUser.id]);
    expect(await ins('2026-04-01', null)).toBeNull();
    expect(await ins('2026-04-01', null)).toBe(UNIQUE_VIOLATION);
    expect(await ins('2026-04-01', a.session.id)).toBeNull();
    expect(await ins('2026-04-01', a.session.id)).toBe(UNIQUE_VIOLATION);
  });

  it('[DB-03] foreign keys restrict deleting a referenced row', async () => {
    const code = await sqlState(pool, `DELETE FROM sections WHERE id = $1`, [a.section.id]);
    expect(['23503', '23001']).toContain(code); // 23001 = RESTRICT, 23503 = NO ACTION
  });
});
