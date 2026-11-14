/**
 * Deterministic DEV-ONLY demo data (spec 01 §5): 1 session, 3 groups, 2 sections, 5 courses,
 * 3 teachers, 60 students. Fake names, no real personal data, no randomness. Idempotent.
 * Never run in production.
 */
import argon2 from 'argon2';
import type { PrismaClient } from '@prisma/client';

export const DEMO_PASSWORD = 'Demo@12345';

const FIRST = ['Arif', 'Binta', 'Chaiti', 'Dipu', 'Eshita', 'Farhan', 'Gita', 'Hasan', 'Ishrat', 'Jibon',
  'Kabir', 'Lipi', 'Mahin', 'Nusrat', 'Omi', 'Puja', 'Rafi', 'Sumi', 'Tanvir', 'Urmi'];
const LAST = ['Ahmed', 'Barua', 'Chowdhury', 'Das', 'Hossain', 'Islam'];

const id = (kind: string, n: number | string) => `demo-${kind}-${n}`;

export async function seedDemo(prisma: PrismaClient): Promise<void> {
  const hash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  const session = await prisma.session.upsert({
    where: { name: '2026–27' },
    create: { id: id('session', 1), name: '2026–27' },
    update: {},
  });
  const groups: Record<string, string> = {};
  for (const type of ['science', 'commerce', 'arts'] as const) {
    const g = await prisma.group.upsert({
      where: { sessionId_type: { sessionId: session.id, type } },
      create: { id: id('group', type), sessionId: session.id, type },
      update: {},
    });
    groups[type] = g.id;
  }

  const courses = [
    ['PHY-1', 'Physics 1st Paper', 'science', 'first'],
    ['CHE-1', 'Chemistry 1st Paper', 'science', 'first'],
    ['ACC-1', 'Accounting 1st Paper', 'commerce', 'first'],
    ['ICT', 'Information and Communication Technology', 'common', 'none'],
    ['ENG-1', 'English 1st Paper', 'common', 'first'],
  ] as const;
  const courseIds: Record<string, string> = {};
  for (const [code, name, groupType, paper] of courses) {
    const c = await prisma.course.upsert({
      where: { code },
      create: { id: id('course', code), code, name, groupType, classLevel: 'c11', paper },
      update: {},
    });
    courseIds[code] = c.id;
  }

  const teachers = [
    ['T-0001', 'Rahim Uddin', 'Senior Lecturer', ['physics', 'chemistry']],
    ['T-0002', 'Salma Khatun', 'Lecturer', ['ict', 'english']],
    ['T-0003', 'Karim Sheikh', 'Lecturer', ['accounting']],
  ] as const;
  for (const [loginId, name, designation, subjects] of teachers) {
    await prisma.user.upsert({
      where: { loginId },
      create: {
        id: id('user', loginId),
        loginId,
        email: `${loginId.toLowerCase()}@demo.example.edu`,
        role: 'teacher',
        passwordHash: hash,
        mustChangePassword: false,
        firstLogin: false,
        teacher: { create: { name, designation, subjects: [...subjects] } },
      },
      update: {},
    });
  }
  const tid = (loginId: string) => id('user', loginId);

  const sectionDefs = [
    { key: 'sci-a', group: 'science', mentor: 'T-0001', offerings: [['PHY-1', 'T-0001'], ['CHE-1', 'T-0001'], ['ICT', 'T-0002'], ['ENG-1', 'T-0002']] },
    { key: 'com-a', group: 'commerce', mentor: 'T-0002', offerings: [['ACC-1', 'T-0003'], ['ICT', 'T-0002'], ['ENG-1', 'T-0002']] },
  ] as const;

  let studentNo = 0;
  for (const def of sectionDefs) {
    const section = await prisma.section.upsert({
      where: { id: id('section', def.key) },
      create: {
        id: id('section', def.key),
        groupId: groups[def.group]!,
        classLevel: 11,
        name: 'A',
        mentorTeacherId: tid(def.mentor),
      },
      update: {},
    });
    const offeringIds: string[] = [];
    for (const [code, teacher] of def.offerings) {
      const o = await prisma.courseOffering.upsert({
        where: { sectionId_courseId: { sectionId: section.id, courseId: courseIds[code]! } },
        create: {
          id: id('offering', `${def.key}-${code}`),
          sectionId: section.id,
          courseId: courseIds[code]!,
          teacherId: tid(teacher),
        },
        update: {},
      });
      offeringIds.push(o.id);
    }
    for (let roll = 1; roll <= 30; roll++) {
      studentNo++;
      const loginId = `S-2026-${String(studentNo).padStart(4, '0')}`;
      const name = `${FIRST[(studentNo - 1) % FIRST.length]} ${LAST[Math.floor((studentNo - 1) / FIRST.length) % LAST.length]}`;
      const uid = id('user', loginId);
      await prisma.user.upsert({
        where: { loginId },
        create: {
          id: uid,
          loginId,
          email: `${loginId.toLowerCase()}@demo.example.edu`,
          role: 'student',
          passwordHash: hash,
          mustChangePassword: false,
          firstLogin: false,
          student: {
            create: {
              name,
              sectionId: section.id,
              roll: String(roll).padStart(2, '0'),
              dob: new Date(Date.UTC(2009 + (roll % 2), roll % 12, 1 + (roll % 27))),
            },
          },
        },
        update: {},
      });
      for (const offeringId of offeringIds) {
        const enrollmentId = id('enrollment', `${loginId}-${offeringId}`);
        await prisma.enrollment.upsert({
          where: { id: enrollmentId },
          create: { id: enrollmentId, courseOfferingId: offeringId, studentId: uid },
          update: {},
        });
      }
    }
  }
  console.log(`Demo data ready. Password for every demo user: ${DEMO_PASSWORD}`);
  console.log('Teachers: T-0001..T-0003. Students: S-2026-0001..S-2026-0060.');
}
