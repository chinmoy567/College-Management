import { Prisma } from '@prisma/client';
import { SETTING_DEFAULTS, attendanceColour, attendancePct } from '@cms/shared';
import { prisma } from '../../db';

export interface Thresholds { threshold: number; orange: number }

export async function getThresholds(db: Prisma.TransactionClient = prisma): Promise<Thresholds> {
  const [t, c] = await Promise.all([
    db.setting.findUnique({ where: { key: 'attendance_threshold' } }),
    db.setting.findUnique({ where: { key: 'attendance_colours' } }),
  ]);
  const colours = (c?.value as { orange?: number } | undefined) ?? SETTING_DEFAULTS.attendance_colours;
  return {
    threshold: typeof t?.value === 'number' ? t.value : SETTING_DEFAULTS.attendance_threshold,
    orange: typeof colours.orange === 'number' ? colours.orange : SETTING_DEFAULTS.attendance_colours.orange,
  };
}

export interface Counts { present: number; excused: number; held: number }
export interface StatRow extends Counts { studentId: string; offeringId: string }

export interface StatFilter {
  studentIds?: string[];
  offeringIds?: string[];
  sectionId?: string; // the section at the time of the class (AttendanceRecord.sectionId)
  from?: string; // Dhaka dates, inclusive
  to?: string;
}

/**
 * One SQL aggregate (04 §7): only `held` meetings, never holiday dates, one row per student × offering.
 * A student who moved is measured on their own records, because records carry their own offering.
 */
export async function aggregate(f: StatFilter, db: Prisma.TransactionClient = prisma): Promise<StatRow[]> {
  const where: Prisma.Sql[] = [
    Prisma.sql`m.status = 'held'`,
    Prisma.sql`NOT EXISTS (SELECT 1 FROM holidays h WHERE m.date BETWEEN h.start_date AND h.end_date)`,
  ];
  if (f.studentIds) where.push(Prisma.sql`r.student_id IN (${Prisma.join(f.studentIds.length ? f.studentIds : [''])})`);
  if (f.offeringIds) where.push(Prisma.sql`r.course_offering_id IN (${Prisma.join(f.offeringIds.length ? f.offeringIds : [''])})`);
  if (f.sectionId) where.push(Prisma.sql`r.section_id = ${f.sectionId}`);
  if (f.from) where.push(Prisma.sql`m.date >= ${f.from}::date`);
  if (f.to) where.push(Prisma.sql`m.date <= ${f.to}::date`);
  return db.$queryRaw<StatRow[]>(Prisma.sql`
    SELECT r.student_id AS "studentId", r.course_offering_id AS "offeringId",
      (count(*) FILTER (WHERE r.status IN ('present', 'late')))::int AS present,
      (count(*) FILTER (WHERE r.status = 'excused'))::int AS excused,
      count(*)::int AS held
    FROM attendance_records r JOIN class_meetings m ON m.id = r.class_meeting_id
    WHERE ${Prisma.join(where, ' AND ')}
    GROUP BY r.student_id, r.course_offering_id`);
}

export const sum = (rows: Counts[]): Counts =>
  rows.reduce((a, r) => ({ present: a.present + r.present, excused: a.excused + r.excused, held: a.held + r.held }), { present: 0, excused: 0, held: 0 });

/** Overall is computed over all records, never as an average of averages. */
export function describe(c: Counts, t: Thresholds) {
  const pct = attendancePct(c.present, c.held, c.excused);
  return { ...c, pct, display: pct === null ? 'N/A' : `${pct}%`, colour: attendanceColour(pct, t.threshold, t.orange) };
}
