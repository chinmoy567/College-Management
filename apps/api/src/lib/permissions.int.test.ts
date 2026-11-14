import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../db';
import { makeTeacher, uniq } from '../../../../test/factories';
import { canSeeStudentPrivate, createPermissions, memoStore, prismaPermissionStore, type Actor } from './permissions';

afterAll(() => prisma.$disconnect());

const actor = (u: { id: string }, role: Actor['role']): Actor => ({ id: u.id, role });

describe('[CONV-08] Prisma-backed permission helpers (allow and deny)', () => {
  it('teachesOffering / mentorsSection / teachesInSection / canManageOffering / isEnrolled / canTakeAttendance', async () => {
    const session = await prisma.session.create({ data: { name: uniq('p') } });
    const group = await prisma.group.create({ data: { sessionId: session.id, type: 'science' } });
    const s1 = await prisma.section.create({ data: { groupId: group.id, classLevel: 11, name: 'A' } });
    const s2 = await prisma.section.create({ data: { groupId: group.id, classLevel: 11, name: 'B' } });
    const [teacher, mentor, sub, other] = [await makeTeacher(prisma), await makeTeacher(prisma), await makeTeacher(prisma), await makeTeacher(prisma)];
    await prisma.section.update({ where: { id: s1.id }, data: { mentorTeacherId: mentor.id } });
    const course = await prisma.course.create({ data: { code: uniq('PC'), name: 'C', groupType: 'science', classLevel: 'c11' } });
    const off = await prisma.courseOffering.create({ data: { sectionId: s1.id, courseId: course.id, teacherId: teacher.id } });
    const student = await prisma.user.create({ data: { role: 'student', loginId: uniq('PS'), student: { create: { name: 'S', roll: '1', sectionId: s1.id } } } });
    await prisma.enrollment.create({ data: { courseOfferingId: off.id, studentId: student.id } });
    const meeting = await prisma.classMeeting.create({
      data: {
        date: new Date('2030-03-03'), startTime: new Date('1970-01-01T09:00:00Z'), endTime: new Date('1970-01-01T09:45:00Z'),
        teacherId: teacher.id, substituteTeacherId: sub.id, offerings: { create: { courseOfferingId: off.id } },
      },
    });
    const p = createPermissions(prismaPermissionStore);
    const admin: Actor = { id: 'admin-x', role: 'admin' };

    expect(await p.teachesOffering(actor(teacher, 'teacher'), off.id)).toBe(true);
    expect(await p.teachesOffering(actor(other, 'teacher'), off.id)).toBe(false);
    expect(await p.teachesOffering(actor(student, 'student'), off.id)).toBe(false);

    expect(await p.mentorsSection(actor(mentor, 'teacher'), s1.id)).toBe(true);
    expect(await p.mentorsSection(actor(mentor, 'teacher'), s2.id)).toBe(false);
    expect(await p.mentorsSection(actor(teacher, 'teacher'), s1.id)).toBe(false);

    expect(await p.teachesInSection(actor(teacher, 'teacher'), s1.id)).toBe(true);
    expect(await p.teachesInSection(actor(teacher, 'teacher'), s2.id)).toBe(false);
    expect(await p.teachesInSection(actor(mentor, 'teacher'), s1.id)).toBe(false);

    expect(await p.canManageOffering(admin, off.id)).toBe(true);
    expect(await p.canManageOffering(actor(teacher, 'teacher'), off.id)).toBe(true);
    expect(await p.canManageOffering(actor(mentor, 'teacher'), off.id)).toBe(false);
    expect(await p.canManageOffering(actor(mentor, 'teacher'), off.id, { mentorAllowed: true })).toBe(true);
    expect(await p.canManageOffering(actor(other, 'teacher'), off.id, { mentorAllowed: true })).toBe(false);
    expect(await p.canManageOffering(actor(student, 'student'), off.id)).toBe(false);

    expect(await p.isEnrolled(student.id, off.id)).toBe(true);
    expect(await p.isEnrolled(other.id, off.id)).toBe(false);

    expect(await p.canTakeAttendance(actor(teacher, 'teacher'), meeting.id)).toBe(true);
    expect(await p.canTakeAttendance(actor(sub, 'teacher'), meeting.id)).toBe(true);
    expect(await p.canTakeAttendance(actor(mentor, 'teacher'), meeting.id)).toBe(true);
    expect(await p.canTakeAttendance(actor(other, 'teacher'), meeting.id)).toBe(false);
    expect(await p.canTakeAttendance(actor(student, 'student'), meeting.id)).toBe(false);

    expect(canSeeStudentPrivate(admin, student.id)).toBe(true);
    expect(canSeeStudentPrivate(actor(student, 'student'), student.id)).toBe(true);
    expect(canSeeStudentPrivate(actor(teacher, 'teacher'), student.id)).toBe(false);
    expect(canSeeStudentPrivate(actor(mentor, 'teacher'), student.id)).toBe(false);

    // an ended offering and an ended enrollment grant nothing
    await prisma.courseOffering.update({ where: { id: off.id }, data: { endedAt: new Date() } });
    await prisma.enrollment.updateMany({ where: { courseOfferingId: off.id }, data: { status: 'ended', endedAt: new Date() } });
    expect(await p.teachesOffering(actor(teacher, 'teacher'), off.id)).toBe(false);
    expect(await p.teachesInSection(actor(teacher, 'teacher'), s1.id)).toBe(false);
    expect(await p.isEnrolled(student.id, off.id)).toBe(false);
  });

  it('memoises repeated lookups within one request', async () => {
    const spy = vi.fn(prismaPermissionStore.getSection);
    const store = memoStore({ ...prismaPermissionStore, getSection: spy }, new Map());
    const p = createPermissions(store);
    const t: Actor = { id: 'nobody', role: 'teacher' };
    await p.mentorsSection(t, 'missing-section');
    await p.mentorsSection(t, 'missing-section');
    await p.canManageOffering(t, 'missing-offering', { mentorAllowed: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
