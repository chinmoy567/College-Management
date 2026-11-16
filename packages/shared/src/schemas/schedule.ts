import { z } from 'zod';
import { dhakaDate, id } from './common';

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type WeekdayName = (typeof WEEKDAYS)[number];
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

export const periodBody = z
  .object({ name: z.string().trim().min(1).max(60), startTime: hhmm, endTime: hhmm })
  .refine((p) => p.endTime > p.startTime, { message: 'End time must be after start time', path: ['endTime'] });
export const periodPatch = z
  .object({ name: z.string().trim().min(1).max(60), startTime: hhmm, endTime: hhmm })
  .partial();
export const replaceBody = z.object({ replacementPeriodId: id.optional(), replacementRoomId: id.optional() });

export const roomBody = z.object({
  name: z.string().trim().min(1).max(60),
  capacity: z.number().int().min(1).max(2000).nullable().optional(),
  building: z.string().trim().max(60).nullable().optional(),
});
export const roomPatch = roomBody.partial();

export const slotBody = z.object({
  day: z.enum(WEEKDAYS),
  periodId: id,
  roomId: id.nullable().optional(),
  offeringIds: z.array(id).min(1).max(20),
});
export const slotPatch = slotBody.partial();
export const routineCopyBody = z.object({ fromSectionId: id, toSectionId: id });

export const holidayBody = z
  .object({ title: z.string().trim().min(1).max(120), startDate: dhakaDate, endDate: dhakaDate })
  .refine((h) => h.endDate >= h.startDate, { message: 'End date must not be before start date', path: ['endDate'] });
export const holidayPatch = z
  .object({ title: z.string().trim().min(1).max(120), startDate: dhakaDate, endDate: dhakaDate })
  .partial();

export const specialDayBody = z.object({
  date: dhakaDate,
  title: z.string().trim().min(1).max(120),
  sessionId: id.nullable().optional(),
  periodIds: z.array(id).max(30),
});
export const specialDayPatch = specialDayBody.partial();

export const extraMeetingBody = z.object({
  offeringIds: z.array(id).min(1).max(20),
  date: dhakaDate,
  periodId: id.optional(),
  startTime: hhmm.optional(),
  endTime: hhmm.optional(),
  roomId: id.nullable().optional(),
});
export const meetingPatch = z.object({
  periodId: id.optional(),
  roomId: id.nullable().optional(),
  date: dhakaDate.optional(),
  substituteTeacherId: id.nullable().optional(),
});

export const calendarQuery = z.object({
  from: dhakaDate,
  to: dhakaDate,
  sessionId: id.optional(),
  groupId: id.optional(),
  sectionId: id.optional(),
  teacherId: id.optional(),
  roomId: id.optional(),
});

/** A teacher's own meetings for a date range of at most 31 days (04 §8). */
export const myMeetingsQuery = z
  .object({ from: dhakaDate, to: dhakaDate })
  .refine((q) => q.from <= q.to, { message: 'From must not be after to.', path: ['to'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 30, { message: 'Range is at most 31 days.', path: ['to'] });

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'] as const;
export const sheetBody = z.object({
  records: z.array(z.object({ studentId: id, status: z.enum(ATTENDANCE_STATUSES) })).max(400),
  clientDraftId: z.string().min(8).max(80),
});
export const manualMeetingBody = z.object({ offeringId: id, date: dhakaDate, periodId: id });
export const recordPatch = z.object({ status: z.enum(ATTENDANCE_STATUSES) });

/** Attendance % (04 §7): late counts as present, excused is excluded, "N/A" when nothing counts. */
export function attendancePct(present: number, held: number, excused: number): number | null {
  const base = held - excused;
  return base <= 0 ? null : Math.round((present / base) * 1000) / 10;
}
export function attendanceColour(pct: number | null, threshold = 75, orangeFrom = 60): 'green' | 'orange' | 'red' | 'none' {
  if (pct === null) return 'none';
  return pct >= threshold ? 'green' : pct >= orangeFrom ? 'orange' : 'red';
}
