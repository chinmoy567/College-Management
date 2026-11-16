import type { AttendanceStatus, Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { transaction } from '../../lib/afterCommit';
import { audit } from '../../lib/audit';
import { AppError } from '../../lib/http';
import { notify } from '../../lib/notify';
import { toUtc } from '../../lib/time';
import { hhmmOf, ymdOf } from '../schedule/generate';
import { aggregate, getThresholds } from './stats';
import { attendancePct } from '@cms/shared';

export interface RosterStudent { id: string; name: string; roll: string; offeringId: string; status: AttendanceStatus }

/** Roster = students whose enrollment was active on the meeting date (04 §6.1). */
export async function loadSheet(meetingId: string) {
  const m = await prisma.classMeeting.findUnique({
    where: { id: meetingId },
    include: {
      period: true,
      room: true,
      teacher: { select: { userId: true, name: true } },
      offerings: { include: { courseOffering: { include: { course: true, section: { include: { group: { include: { session: true } } } } } } } },
      attendance: true,
    },
  });
  if (!m) throw new AppError('NOT_FOUND', 404, 'Class not found.');
  const date = ymdOf(m.date);
  const startAt = toUtc(date, hhmmOf(m.startTime));
  const endAt = toUtc(date, hhmmOf(m.endTime));
  const offeringIds = m.offerings.map((o) => o.courseOfferingId);
  const enrollments = await prisma.enrollment.findMany({
    where: { courseOfferingId: { in: offeringIds }, enrolledAt: { lte: endAt }, OR: [{ endedAt: null }, { endedAt: { gt: startAt } }] },
    include: { student: { include: { user: { select: { status: true } } } } },
    orderBy: { student: { roll: 'asc' } },
  });
  const existing = new Map(m.attendance.map((r) => [r.studentId, r]));
  const joined = new Set<string>(
    m.onlineClassId
      ? (await prisma.onlineClassJoin.findMany({ where: { onlineClassId: m.onlineClassId }, select: { studentId: true } })).map((j) => j.studentId)
      : [],
  );
  const seen = new Set<string>();
  const students: RosterStudent[] = [];
  for (const e of enrollments) {
    if (seen.has(e.studentId) || e.student.user.status === 'deleted') continue; // a student in two offerings of a combined class appears once
    seen.add(e.studentId);
    const rec = existing.get(e.studentId);
    const status: AttendanceStatus = rec ? rec.status : m.onlineClassId ? (joined.has(e.studentId) ? 'present' : 'absent') : 'present';
    students.push({ id: e.studentId, name: e.student.name, roll: e.student.roll, offeringId: e.courseOfferingId, status });
  }
  return { meeting: m, date, startAt, endAt, students };
}

export async function sheetView(meetingId: string) {
  const { meeting: m, date, students } = await loadSheet(meetingId);
  return {
    meeting: {
      id: m.id, date, status: m.status, startTime: hhmmOf(m.startTime), endTime: hhmmOf(m.endTime),
      period: m.period?.name ?? null, room: m.room?.name ?? null, teacher: m.teacher.name,
      attendanceTaken: !!m.attendanceTakenAt, online: !!m.onlineClassId,
    },
    offerings: m.offerings.map((o) => ({
      id: o.courseOfferingId,
      course: { code: o.courseOffering.course.code, name: o.courseOffering.course.name },
      session: o.courseOffering.section.group.session.name,
      group: o.courseOffering.section.group.type,
      section: o.courseOffering.section.name,
      classLevel: o.courseOffering.section.classLevel,
      students: students.filter((s) => s.offeringId === o.courseOfferingId),
    })),
  };
}

/** Submit a whole sheet (04 §6.1): upsert in one transaction, edits logged, notifications on absence/threshold crossing. */
export async function submitSheet(
  meetingId: string,
  actor: { id: string; role: 'admin' | 'teacher' | 'student' },
  body: { records: { studentId: string; status: AttendanceStatus }[]; clientDraftId: string },
  ip?: string,
) {
  const sheet = await loadSheet(meetingId);
  const m = sheet.meeting;
  if (m.status === 'cancelled' || m.status === 'removed') throw new AppError('CONFLICT', 409, 'This class was cancelled or removed.');
  if (m.lastClientDraftId === body.clientDraftId && m.attendanceTakenAt) return { ok: true, repeated: true, changed: 0 };
  if (sheet.startAt.getTime() > Date.now() + 15 * 60_000) throw new AppError('VALIDATION_ERROR', 400, 'Attendance opens 15 minutes before the class starts.');

  const roster = new Map(sheet.students.map((s) => [s.id, s]));
  const wanted = new Map<string, AttendanceStatus>();
  for (const r of body.records) {
    if (!roster.has(r.studentId)) throw new AppError('VALIDATION_ERROR', 400, 'A student is not on this class roster.', { records: r.studentId });
    wanted.set(r.studentId, r.status);
  }
  for (const s of sheet.students) if (!wanted.has(s.id)) wanted.set(s.id, s.status); // untouched rows keep their default or saved status

  return transaction(async (tx) => {
    const th = await getThresholds(tx);
    const ids = [...wanted.keys()];
    const before = await aggregate({ studentIds: ids }, tx);
    const existing = new Map((await tx.attendanceRecord.findMany({ where: { classMeetingId: m.id } })).map((r) => [r.studentId, r]));
    const wasAbsent = new Set([...existing.values()].filter((r) => r.status === 'absent').map((r) => r.studentId));
    // Batched writes: a few queries instead of one per student, so a 30-student sheet stays fast even on a remote database.
    const toCreate: Prisma.AttendanceRecordCreateManyInput[] = [];
    const edits: Prisma.AttendanceEditCreateManyInput[] = [];
    const byNewStatus = new Map<AttendanceStatus, string[]>();
    for (const [studentId, status] of wanted) {
      const s = roster.get(studentId)!;
      const prev = existing.get(studentId);
      if (!prev) {
        toCreate.push({ classMeetingId: m.id, studentId, sectionId: m.offerings.find((o) => o.courseOfferingId === s.offeringId)!.courseOffering.sectionId, courseOfferingId: s.offeringId, status, markedBy: actor.id });
      } else if (prev.status !== status) {
        byNewStatus.set(status, [...(byNewStatus.get(status) ?? []), prev.id]);
        edits.push({ attendanceRecordId: prev.id, oldStatus: prev.status, newStatus: status, editedBy: actor.id });
      }
    }
    if (toCreate.length) await tx.attendanceRecord.createMany({ data: toCreate });
    for (const [status, recordIds] of byNewStatus)
      await tx.attendanceRecord.updateMany({ where: { id: { in: recordIds } }, data: { status, markedBy: actor.id, markedAt: new Date() } });
    if (edits.length) await tx.attendanceEdit.createMany({ data: edits });
    const changed = toCreate.length + edits.length;
    await tx.classMeeting.update({
      where: { id: m.id },
      data: { status: 'held', attendanceTakenAt: m.attendanceTakenAt ?? new Date(), lastClientDraftId: body.clientDraftId },
    });
    if (actor.role === 'admin' && existing.size > 0 && changed > 0)
      await audit(actor.id, 'attendance.sheet_edit', 'class_meeting', m.id, { changed }, ip, tx);

    const after = await aggregate({ studentIds: ids }, tx);
    const pctOf = (rows: typeof before, studentId: string, offeringId: string) => {
      const r = rows.find((x) => x.studentId === studentId && x.offeringId === offeringId);
      return r ? attendancePct(r.present, r.held, r.excused) : null;
    };
    const absent = ids.filter((id) => wanted.get(id) === 'absent' && !wasAbsent.has(id));
    if (absent.length) await notify(absent, 'marked_absent', { type: 'class_meeting', id: m.id }, 'You were marked absent in a class.', tx);
    for (const id of ids) {
      const off = roster.get(id)!.offeringId;
      const b = pctOf(before, id, off);
      const a = pctOf(after, id, off);
      if (a !== null && a < th.threshold && (b === null || b >= th.threshold))
        await notify([id], 'attendance_below_threshold', { type: 'course_offering', id: off }, `Your attendance in a course fell below ${th.threshold}%.`, tx);
    }
    return { ok: true, repeated: false, changed };
  }, { timeout: 30_000, maxWait: 10_000 });
}
