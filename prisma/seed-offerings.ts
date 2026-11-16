/** Creates the missing subject courses and assigns the subject teachers (T-0004..T-0021) to course offerings in the demo sections. Idempotent. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

type G = 'science' | 'commerce' | 'arts' | 'common';
// [code, name, courseGroup, teacher loginId]
const NEW_COURSES: [string, string, G, string][] = [
  ['BIO-1', 'Biology 1st Paper', 'science', 'T-0004'],
  ['HM-1', 'Higher Mathematics 1st Paper', 'science', 'T-0005'],
  ['AGR-1', 'Agriculture Studies 1st Paper', 'science', 'T-0021'],
  ['BO-1', 'Business Organization and Management 1st Paper', 'commerce', 'T-0006'],
  ['FB-1', 'Finance and Banking 1st Paper', 'commerce', 'T-0007'],
  ['PMM-1', 'Production Management and Marketing 1st Paper', 'commerce', 'T-0008'],
  ['STA-1', 'Statistics 1st Paper', 'commerce', 'T-0009'],
  ['BAN-1', 'Bangla 1st Paper', 'common', 'T-0010'],
  ['HIS-1', 'History 1st Paper', 'arts', 'T-0011'],
  ['GEO-1', 'Geography 1st Paper', 'arts', 'T-0012'],
  ['CIV-1', 'Civics and Good Governance 1st Paper', 'arts', 'T-0013'],
  ['ECO-1', 'Economics 1st Paper', 'arts', 'T-0014'],
  ['SOC-1', 'Sociology 1st Paper', 'arts', 'T-0015'],
  ['ISH-1', 'Islamic History and Culture 1st Paper', 'arts', 'T-0016'],
  ['IST-1', 'Islamic Studies 1st Paper', 'arts', 'T-0017'],
  ['LOG-1', 'Logic 1st Paper', 'arts', 'T-0018'],
  ['SWK-1', 'Social Work 1st Paper', 'arts', 'T-0019'],
  ['PSY-1', 'Psychology 1st Paper', 'arts', 'T-0020'],
];
const OPTIONAL = new Set(['AGR-1']);
const SECTIONS: Record<string, string[]> = {
  'demo-section-sci-a': ['BIO-1', 'HM-1', 'AGR-1', 'BAN-1'],
  'demo-section-com-a': ['BO-1', 'FB-1', 'PMM-1', 'STA-1', 'BAN-1'],
  'arts': ['HIS-1', 'GEO-1', 'CIV-1', 'ECO-1', 'SOC-1', 'ISH-1', 'IST-1', 'LOG-1', 'SWK-1', 'PSY-1', 'BAN-1', 'ICT', 'ENG-1'],
};
const COMMON_TEACHER: Record<string, string> = { ICT: 'T-0002', 'ENG-1': 'T-0002' };

async function main() {
  const prisma = new PrismaClient();
  const teacherOf: Record<string, string> = { ...COMMON_TEACHER };
  for (const [code, name, groupType, t] of NEW_COURSES) {
    teacherOf[code] = t;
    await prisma.course.upsert({
      where: { code },
      create: { id: `demo-course-${code}`, code, name, groupType, classLevel: 'c11', paper: 'first', isOptional: OPTIONAL.has(code) },
      update: {},
    });
  }
  const user = async (loginId: string) => (await prisma.user.findUniqueOrThrow({ where: { loginId } })).id;
  let created = 0, enrolled = 0;
  for (const [key, codes] of Object.entries(SECTIONS)) {
    // Arts Section A of 2026 may have a generated id, so find it by group type.
    const sectionId = key !== 'arts' ? key : (await prisma.section.findFirstOrThrow({ where: { name: 'A', group: { type: 'arts', session: { name: { startsWith: '2026' } } } } })).id;
    const students = await prisma.studentProfile.findMany({ where: { sectionId }, select: { userId: true } });
    for (const code of codes) {
      const course = await prisma.course.findUniqueOrThrow({ where: { code } });
      const teacherId = await user(teacherOf[code]!);
      const exists = await prisma.courseOffering.findUnique({ where: { sectionId_courseId: { sectionId, courseId: course.id } } });
      if (exists) continue;
      const o = await prisma.courseOffering.create({ data: { id: `do-${sectionId.slice(-10)}-${code}`, sectionId, courseId: course.id, teacherId } });
      created++;
      if (OPTIONAL.has(code)) continue; // optional subject: Admin enrolls students individually
      for (const s of students) {
        await prisma.enrollment.create({ data: { courseOfferingId: o.id, studentId: s.userId } });
        enrolled++;
      }
    }
  }
  console.log(`Offerings created: ${created}, enrollments added: ${enrolled}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
