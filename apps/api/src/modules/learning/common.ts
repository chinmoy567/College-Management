import { prisma } from '../../db';
import { AppError } from '../../lib/http';

export const NOT_FOUND = () => new AppError('NOT_FOUND', 404, 'Not found.');
export const bad = (field: string, message: string) => new AppError('VALIDATION_ERROR', 400, message, { [field]: message });

/** Active students enrolled in any of the offerings (account active). */
export async function enrolledStudentIds(offeringIds: string[]): Promise<string[]> {
  if (!offeringIds.length) return [];
  const rows = await prisma.enrollment.findMany({
    where: { courseOfferingId: { in: offeringIds }, status: 'active', student: { user: { status: 'active' } } },
    select: { studentId: true },
    distinct: ['studentId'],
  });
  return rows.map((r) => r.studentId);
}

/** Offerings the student is actively enrolled in, with their section and group. */
export async function studentScope(studentId: string): Promise<{ offeringIds: string[]; sectionId: string; groupId: string }> {
  const [enr, profile] = await Promise.all([
    prisma.enrollment.findMany({ where: { studentId, status: 'active' }, select: { courseOfferingId: true } }),
    prisma.studentProfile.findUnique({ where: { userId: studentId }, select: { sectionId: true, section: { select: { groupId: true } } } }),
  ]);
  if (!profile) throw NOT_FOUND();
  return { offeringIds: enr.map((e) => e.courseOfferingId), sectionId: profile.sectionId, groupId: profile.section.groupId };
}

/** What a teacher can see or manage: offerings they teach, sections they teach in or mentor. */
export async function teacherScope(teacherId: string): Promise<{ taughtOfferingIds: string[]; mentoredSectionId: string | null; sectionIds: string[]; groupIds: string[] }> {
  const [offerings, mentored] = await Promise.all([
    prisma.courseOffering.findMany({ where: { teacherId, endedAt: null }, select: { id: true, sectionId: true, section: { select: { groupId: true } } } }),
    prisma.section.findFirst({ where: { mentorTeacherId: teacherId, deletedAt: null }, select: { id: true, groupId: true } }),
  ]);
  const sectionIds = new Set(offerings.map((o) => o.sectionId));
  const groupIds = new Set(offerings.map((o) => o.section.groupId));
  if (mentored) {
    sectionIds.add(mentored.id);
    groupIds.add(mentored.groupId);
  }
  return { taughtOfferingIds: offerings.map((o) => o.id), mentoredSectionId: mentored?.id ?? null, sectionIds: [...sectionIds], groupIds: [...groupIds] };
}

/** Offerings of the mentor's own section. */
export async function mentoredOfferingIds(teacherId: string): Promise<string[]> {
  const rows = await prisma.courseOffering.findMany({ where: { endedAt: null, section: { mentorTeacherId: teacherId, deletedAt: null } }, select: { id: true } });
  return rows.map((r) => r.id);
}
