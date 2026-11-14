import { randomUUID } from 'node:crypto';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { PrismaClient, type AttendanceStatus, type User } from '@prisma/client';
import { createSession } from '../apps/api/src/modules/auth/sessions';
import { dhakaDate } from '../apps/api/src/lib/time';
import { dateOnly, timeDate } from '../apps/api/src/modules/schedule/generate';

export const prisma = new PrismaClient();
export const COOKIE = process.env.SESSION_COOKIE_NAME ?? 'cms_session';
export const today = () => dhakaDate();

export async function makeUser(role: 'admin' | 'teacher' | 'student', sectionId?: string, name = 'E2E User'): Promise<User> {
  const id = randomUUID().slice(0, 8);
  return prisma.user.create({
    data: {
      role, email: `e2e-${id}@x.test`, passwordHash: 'x', mustChangePassword: false, firstLogin: false,
      ...(role === 'admin' ? { totpEnabledAt: new Date() } : { loginId: `e2e${id}` }),
      ...(role === 'teacher' ? { teacher: { create: { name, subjects: [] } } } : {}),
      ...(role === 'student' ? { student: { create: { name, roll: String(Math.floor(Math.random() * 1e6)), sectionId: sectionId! } } } : {}),
    },
  });
}

/** Signs the browser context in as `user` (same shortcut as the ACAD-15 test). */
export async function signIn(context: BrowserContext, baseURL: string, user: User): Promise<string> {
  const { token } = await createSession(user, { stepUpPending: false });
  await context.clearCookies();
  await context.addCookies([{ name: COOKIE, value: token, url: baseURL }]);
  return token;
}

/** A fresh session tree through the API; returns the Science Section A id. */
export async function makeSection(request: APIRequestContext, adminToken: string): Promise<string> {
  const n = 1000 + Math.floor(Math.random() * 8000);
  const res = await request.post('/api/academics/sessions', {
    headers: { 'X-Requested-With': 'cms', Cookie: `${COOKIE}=${adminToken}` },
    data: { name: `${n}–${String(n % 100).padStart(2, '0')}` },
  });
  if (res.status() !== 201) throw new Error(`session create ${res.status()}`);
  const body = (await res.json()) as { groups: { type: string; sections: { id: string }[] }[] };
  return body.groups.find((g) => g.type === 'science')!.sections[0]!.id;
}

export async function makeOffering(sectionId: string, teacherId: string, studentIds: string[]) {
  const course = await prisma.course.create({ data: { code: `E${randomUUID().slice(0, 6)}`, name: 'E2E course', groupType: 'common', classLevel: 'both' } });
  const offering = await prisma.courseOffering.create({ data: { sectionId, courseId: course.id, teacherId } });
  for (const studentId of studentIds)
    await prisma.enrollment.create({ data: { courseOfferingId: offering.id, studentId, enrolledAt: new Date(Date.now() - 90 * 86_400_000) } });
  return { course, offering };
}

export const makeMeeting = (offeringId: string, teacherId: string, o: { start?: string; end?: string; status?: 'scheduled' | 'held'; date?: string } = {}) =>
  prisma.classMeeting.create({
    data: {
      date: dateOnly(o.date ?? today()), startTime: timeDate(o.start ?? '00:05'), endTime: timeDate(o.end ?? '00:50'),
      teacherId, status: o.status ?? 'scheduled', attendanceTakenAt: o.status === 'held' ? new Date() : null,
      offerings: { create: [{ courseOfferingId: offeringId }] },
    },
  });

/** A day in the current month other than today, so holidays the SCH-17 test adds on today never affect the % tests. */
export const otherDayThisMonth = (): string => {
  const t = today();
  const d = new Date(`${t}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (d.getUTCDate() > 1 ? -1 : 1));
  return d.toISOString().slice(0, 10);
};

export async function markHeld(offeringId: string, sectionId: string, teacherId: string, studentId: string, statuses: AttendanceStatus[], date = otherDayThisMonth()) {
  for (const status of statuses) {
    const m = await makeMeeting(offeringId, teacherId, { status: 'held', date });
    await prisma.attendanceRecord.create({ data: { classMeetingId: m.id, studentId, sectionId, courseOfferingId: offeringId, status, markedBy: teacherId } });
  }
}
