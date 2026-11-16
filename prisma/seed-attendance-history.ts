/**
 * Demo attendance HISTORY (DEV / demo data only, idempotent):  npm run db:seed:attendance
 * For the last 6 weeks (Sun-Thu, before today) every demo routine slot gets a HELD Class Meeting
 * and every actively enrolled student gets a present / late / absent / excused record, so the
 * student's attendance table shows overall and per-course percentages.
 * Each student has a fixed "attendance habit" (about 55%..98% present), derived from the id,
 * so a re-run produces the same data and the colours (green / orange / red) are all visible.
 */
import 'dotenv/config';
import { PrismaClient, type AttendanceStatus, type Weekday } from '@prisma/client';

const WEEKS = 6;
const DAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296; // 0..1
}

export async function seedAttendanceHistory(prisma: PrismaClient): Promise<{ meetings: number; records: number }> {
  const slots = await prisma.routineSlot.findMany({
    where: { id: { startsWith: 'demo-slot-' }, deletedAt: null },
    include: { period: true, offerings: { include: { courseOffering: true } } },
  });
  const holidays = await prisma.holiday.findMany();
  const todayUtc = new Date(); todayUtc.setUTCHours(0, 0, 0, 0);
  const dates: Date[] = [];
  for (let i = 1; i <= WEEKS * 7; i++) {
    const d = new Date(todayUtc.getTime() - i * 86400000);
    const wd = DAYS[d.getUTCDay()]!;
    if (wd === 'fri' || wd === 'sat') continue;
    if (holidays.some((h) => d >= h.startDate && d <= h.endDate)) continue;
    dates.push(d);
  }
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const offeringIds = [...new Set(slots.flatMap((s) => s.offerings.map((o) => o.courseOfferingId)))];
  const enrollments = await prisma.enrollment.findMany({
    where: { courseOfferingId: { in: offeringIds }, status: 'active' },
    select: { courseOfferingId: true, studentId: true, student: { select: { sectionId: true } } },
  });
  const byOffering = new Map<string, typeof enrollments>();
  for (const e of enrollments) byOffering.set(e.courseOfferingId, [...(byOffering.get(e.courseOfferingId) ?? []), e]);

  const meetings: Parameters<typeof prisma.classMeeting.createMany>[0] extends { data: infer D } ? (D extends Array<infer X> ? X[] : never) : never = [];
  const links: { classMeetingId: string; courseOfferingId: string }[] = [];
  const records: { classMeetingId: string; studentId: string; sectionId: string; courseOfferingId: string; status: AttendanceStatus; markedBy: string; markedAt: Date }[] = [];

  for (const slot of slots) {
    for (const d of dates) {
      if (DAYS[d.getUTCDay()] !== slot.day) continue;
      const id = `demo-hist-${slot.id}-${iso(d)}`;
      const off = slot.offerings[0]!.courseOffering;
      meetings.push({
        id, routineSlotId: slot.id, date: d, periodId: slot.periodId, roomId: slot.roomId,
        startTime: slot.period.startTime, endTime: slot.period.endTime, teacherId: off.teacherId,
        status: 'held', attendanceTakenAt: new Date(d.getTime() + 9 * 3600000),
      });
      for (const o of slot.offerings) {
        links.push({ classMeetingId: id, courseOfferingId: o.courseOfferingId });
        for (const e of byOffering.get(o.courseOfferingId) ?? []) {
          const habit = 0.55 + hash(e.studentId) * 0.43; // this student's presence rate
          const r = hash(`${e.studentId}|${id}`);
          const status: AttendanceStatus =
            r < habit ? (hash(`late|${e.studentId}|${id}`) < 0.08 ? 'late' : 'present')
            : hash(`exc|${e.studentId}|${id}`) < 0.12 ? 'excused' : 'absent';
          records.push({ classMeetingId: id, studentId: e.studentId, sectionId: e.student.sectionId, courseOfferingId: o.courseOfferingId, status, markedBy: off.teacherId, markedAt: new Date(d.getTime() + 9 * 3600000) });
        }
      }
    }
  }

  const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
  let m = 0, r = 0;
  for (const c of chunk(meetings, 500)) m += (await prisma.classMeeting.createMany({ data: c, skipDuplicates: true })).count;
  for (const c of chunk(links, 1000)) await prisma.classMeetingOffering.createMany({ data: c, skipDuplicates: true });
  for (const c of chunk(records, 2000)) r += (await prisma.attendanceRecord.createMany({ data: c, skipDuplicates: true })).count;
  return { meetings: m, records: r };
}

if (process.argv[1] && /seed-attendance-history\.ts$/.test(process.argv[1])) {
  const prisma = new PrismaClient();
  seedAttendanceHistory(prisma)
    .then((x) => console.log(`Attendance history: ${x.meetings} held meetings and ${x.records} records added.`))
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
