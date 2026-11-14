import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { dhakaDate } from '../../lib/time';
import { plan, type PlanExisting, type PlanSlot } from './generator';

export const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export const GENERATE_DAYS = 14;

/** `@db.Time` columns come back as 1970-01-01T<time>Z. */
export const hhmmOf = (d: Date): string => d.toISOString().slice(11, 16);
export const timeDate = (t: string): Date => new Date(`1970-01-01T${t}:00Z`);
/** `@db.Date` columns come back as midnight UTC. */
export const ymdOf = (d: Date): string => d.toISOString().slice(0, 10);
export const dateOnly = (s: string): Date => new Date(`${s}T00:00:00Z`);
export const newId = (): string => `c${randomBytes(12).toString('hex')}`;

export function addDays(date: string, n: number): string {
  const d = dateOnly(date);
  d.setUTCDate(d.getUTCDate() + n);
  return ymdOf(d);
}
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface GenerateResult { inserted: number; updated: number; removed: number }

/**
 * Applies the pure plan for [from, to] (defaults to today … today+14). Idempotent: the unique index on
 * (routine_slot_id, COALESCE(original_date, date)) plus ON CONFLICT DO NOTHING makes a second run a no-op.
 */
export async function generateMeetings(opts: { from?: string; to?: string; now?: Date } = {}): Promise<GenerateResult> {
  const today = dhakaDate(opts.now);
  const from = opts.from && opts.from > today ? opts.from : today;
  const to = opts.to ?? addDays(today, GENERATE_DAYS);
  if (to < from) return { inserted: 0, updated: 0, removed: 0 };
  const dates = datesBetween(from, to);

  const [slotRows, holidays, specials, existingRows] = await Promise.all([
    prisma.routineSlot.findMany({
      include: {
        period: true,
        offerings: { include: { courseOffering: { include: { section: { include: { group: { include: { session: true } } } } } } } },
      },
    }),
    prisma.holiday.findMany({ where: { startDate: { lte: dateOnly(to) }, endDate: { gte: dateOnly(from) } } }),
    prisma.specialDay.findMany({ where: { date: { gte: dateOnly(from), lte: dateOnly(to) } } }),
    prisma.classMeeting.findMany({
      where: { routineSlotId: { not: null }, OR: [{ date: { gte: dateOnly(from), lte: dateOnly(to) } }, { originalDate: { gte: dateOnly(from), lte: dateOnly(to) } }] },
      include: { offerings: true },
    }),
  ]);

  const slots: PlanSlot[] = slotRows.map((s) => ({
    id: s.id,
    day: WEEKDAY_NAMES.indexOf(s.day),
    periodId: s.periodId,
    roomId: s.roomId,
    startTime: hhmmOf(s.period.startTime),
    endTime: hhmmOf(s.period.endTime),
    deleted: !!s.deletedAt,
    offerings: s.offerings
      .map((o) => o.courseOffering)
      .filter((o) => !o.endedAt && o.section.group.session.status !== 'closed')
      .map((o) => ({ id: o.id, teacherId: o.teacherId, sessionId: o.section.group.sessionId })),
  }));
  const existing: PlanExisting[] = existingRows.map((m) => ({
    id: m.id,
    routineSlotId: m.routineSlotId!,
    date: ymdOf(m.date),
    originalDate: m.originalDate ? ymdOf(m.originalDate) : null,
    status: m.status,
    attended: !!m.attendanceTakenAt,
    manuallyEdited: m.manuallyEdited,
    teacherId: m.teacherId,
    roomId: m.roomId,
    periodId: m.periodId,
    startTime: hhmmOf(m.startTime),
    endTime: hhmmOf(m.endTime),
    offeringIds: m.offerings.map((o) => o.courseOfferingId),
  }));

  const result = plan({
    dates,
    today,
    slots,
    holidays: holidays.map((h) => ({ startDate: ymdOf(h.startDate), endDate: ymdOf(h.endDate) })),
    specialDays: specials.map((d) => ({ date: ymdOf(d.date), sessionId: d.sessionId, periodIds: d.periodIds })),
    existing,
  });

  let inserted = 0;
  await prisma.$transaction(async (tx) => {
    for (const i of result.inserts) {
      const id = newId();
      const n = await tx.$executeRaw(Prisma.sql`
        INSERT INTO class_meetings (id, routine_slot_id, date, period_id, room_id, start_time, end_time, teacher_id)
        VALUES (${id}, ${i.routineSlotId}, ${i.date}::date, ${i.periodId}, ${i.roomId}, ${i.startTime}::time, ${i.endTime}::time, ${i.teacherId})
        ON CONFLICT (routine_slot_id, (COALESCE(original_date, date))) WHERE routine_slot_id IS NOT NULL DO NOTHING`);
      if (n === 1) {
        inserted++;
        await tx.classMeetingOffering.createMany({ data: i.offeringIds.map((courseOfferingId) => ({ classMeetingId: id, courseOfferingId })) });
      }
    }
    for (const u of result.updates) {
      await tx.classMeeting.update({
        where: { id: u.id },
        data: {
          ...(u.status ? { status: u.status } : {}),
          teacherId: u.teacherId, roomId: u.roomId, periodId: u.periodId,
          startTime: timeDate(u.startTime), endTime: timeDate(u.endTime),
        },
      });
      await tx.classMeetingOffering.deleteMany({ where: { classMeetingId: u.id, courseOfferingId: { notIn: u.offeringIds } } });
      await tx.classMeetingOffering.createMany({ data: u.offeringIds.map((courseOfferingId) => ({ classMeetingId: u.id, courseOfferingId })), skipDuplicates: true });
    }
    if (result.removals.length)
      await tx.classMeeting.updateMany({ where: { id: { in: result.removals }, attendanceTakenAt: null }, data: { status: 'removed' } });
  });
  return { inserted, updated: result.updates.length, removed: result.removals.length };
}
