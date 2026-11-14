import type { PrismaClient } from '@prisma/client';
import { WEEKDAYS } from '@cms/shared';
import { addDays, dateOnly, timeDate } from '../apps/api/src/modules/schedule/generate';
import { dhakaDate, weekdayOf } from '../apps/api/src/lib/time';
import { fillStudents, makeCourse, makeSessionViaApi, makeTeacher, uniq } from './m3kit';

export * from './m3kit';

/** Dhaka date n days from today. */
export const dateIn = (n: number): string => addDays(dhakaDate(), n);
/** Weekday name (sun…sat) of the Dhaka date n days from today. */
export const dayIn = (n: number) => WEEKDAYS[weekdayOf(dateIn(n))]!;

type Client = ReturnType<typeof import('./factories').client>;

/** A section with one offering, its teacher, enrolled students, one period and one room. */
export async function classroom(prisma: PrismaClient, admin: Client, students = 3, start = '08:00', end = '08:45') {
  const tree = await makeSessionViaApi(admin);
  const sectionId = tree.groups.science.sectionId;
  const teacher = await makeTeacher(prisma);
  const course = await makeCourse(prisma);
  const offering = await prisma.courseOffering.create({ data: { sectionId, courseId: course.id, teacherId: teacher.id } });
  const kids = await fillStudents(prisma, sectionId, students);
  for (const s of kids)
    await prisma.enrollment.create({ data: { courseOfferingId: offering.id, studentId: s.id, enrolledAt: new Date(Date.now() - 90 * 86_400_000) } });
  const period = (await admin.post('/api/schedule/periods', { name: uniq('P'), startTime: start, endTime: end })).body as { id: string };
  const room = (await admin.post('/api/schedule/rooms', { name: uniq('R') })).body as { id: string };
  return { sessionId: tree.sessionId, sectionId, teacher, course, offering, students: kids, period, room };
}

/** A meeting created straight in the database, e.g. yesterday, so attendance can be taken. */
export async function pastMeeting(prisma: PrismaClient, offeringId: string, teacherId: string, daysAgo = 1, status: 'scheduled' | 'held' | 'cancelled' = 'scheduled') {
  return prisma.classMeeting.create({
    data: {
      date: dateOnly(dateIn(-daysAgo)), startTime: timeDate('08:00'), endTime: timeDate('08:45'), teacherId, status,
      offerings: { create: [{ courseOfferingId: offeringId }] },
    },
  });
}
