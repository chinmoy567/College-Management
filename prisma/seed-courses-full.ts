/** Completes the HSC (class 11-12) course catalog with 2nd Paper courses and assigns the same subject teachers. Idempotent. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

type G = 'science' | 'commerce' | 'arts' | 'common';
// [base code, name, group, teacher loginId | null, optional]
const SUBJECTS: [string, string, G, string | null, boolean][] = [
  ['BAN', 'Bangla', 'common', 'T-0010', false],
  ['ENG', 'English', 'common', 'T-0002', false],
  ['PHY', 'Physics', 'science', 'T-0001', false],
  ['CHE', 'Chemistry', 'science', 'T-0001', false],
  ['BIO', 'Biology', 'science', 'T-0004', false],
  ['HM', 'Higher Mathematics', 'science', 'T-0005', false],
  ['AGR', 'Agriculture Studies', 'science', 'T-0021', true],
  ['ACC', 'Accounting', 'commerce', 'T-0003', false],
  ['BO', 'Business Organization and Management', 'commerce', 'T-0006', false],
  ['FB', 'Finance, Banking and Insurance', 'commerce', 'T-0007', false],
  ['PMM', 'Production Management and Marketing', 'commerce', 'T-0008', false],
  ['STA', 'Statistics', 'commerce', 'T-0009', false],
  ['HIS', 'History', 'arts', 'T-0011', false],
  ['ISH', 'Islamic History and Culture', 'arts', 'T-0016', false],
  ['IST', 'Islamic Studies', 'arts', 'T-0017', false],
  ['GEO', 'Geography', 'arts', 'T-0012', false],
  ['CIV', 'Civics and Good Governance', 'arts', 'T-0013', false],
  ['ECO', 'Economics', 'arts', 'T-0014', false],
  ['SOC', 'Sociology', 'arts', 'T-0015', false],
  ['SWK', 'Social Work', 'arts', 'T-0019', false],
  ['LOG', 'Logic', 'arts', 'T-0018', false],
  ['PSY', 'Psychology', 'arts', 'T-0020', false],
  ['HEC', 'Home Economics', 'arts', null, true], // no teacher yet: course only, no offering
];
const SECTION_BASES: Record<string, string[]> = {
  'demo-section-sci-a': ['BAN', 'ENG', 'PHY', 'CHE', 'BIO', 'HM', 'AGR'],
  'demo-section-com-a': ['BAN', 'ENG', 'ACC', 'BO', 'FB', 'PMM', 'STA'],
  arts: ['BAN', 'ENG', 'HIS', 'ISH', 'IST', 'GEO', 'CIV', 'ECO', 'SOC', 'SWK', 'LOG', 'PSY'],
};

async function main() {
  const prisma = new PrismaClient();
  const ordinal = ['1st', '2nd'] as const;
  const info = new Map<string, { teacher: string | null; optional: boolean }>();
  for (const [base, name, groupType, teacher, optional] of SUBJECTS) {
    for (const [i, paper] of (['first', 'second'] as const).entries()) {
      const code = `${base}-${i + 1}`;
      info.set(code, { teacher, optional });
      await prisma.course.upsert({
        where: { code },
        create: { id: `demo-course-${code}`, code, name: `${name} ${ordinal[i]} Paper`, groupType, classLevel: 'c11', paper, isOptional: optional },
        update: { name: `${name} ${ordinal[i]} Paper`, groupType, isOptional: optional },
      });
    }
  }
  await prisma.course.upsert({
    where: { code: 'ICT' },
    create: { id: 'demo-course-ICT', code: 'ICT', name: 'Information and Communication Technology', groupType: 'common', classLevel: 'c11', paper: 'none' },
    update: {},
  });
  info.set('ICT', { teacher: 'T-0002', optional: false });

  let created = 0, enrolled = 0;
  for (const [key, bases] of Object.entries(SECTION_BASES)) {
    const sectionId = key !== 'arts' ? key
      : (await prisma.section.findFirstOrThrow({ where: { name: 'A', group: { type: 'arts', session: { name: { startsWith: '2026' } } } } })).id;
    const students = await prisma.studentProfile.findMany({ where: { sectionId }, select: { userId: true } });
    const codes = [...bases.flatMap((b) => [`${b}-1`, `${b}-2`]), 'ICT'];
    for (const code of codes) {
      const { teacher, optional } = info.get(code)!;
      if (!teacher) continue;
      const course = await prisma.course.findUniqueOrThrow({ where: { code } });
      if (await prisma.courseOffering.findUnique({ where: { sectionId_courseId: { sectionId, courseId: course.id } } })) continue;
      const teacherId = (await prisma.user.findUniqueOrThrow({ where: { loginId: teacher } })).id;
      const o = await prisma.courseOffering.create({ data: { id: `do-${sectionId.slice(-10)}-${code}`, sectionId, courseId: course.id, teacherId } });
      created++;
      if (optional) continue;
      for (const s of students) { await prisma.enrollment.create({ data: { courseOfferingId: o.id, studentId: s.userId } }); enrolled++; }
    }
  }
  const total = await prisma.course.count();
  console.log(`Courses in catalog: ${total}. Offerings created: ${created}, enrollments added: ${enrolled}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
