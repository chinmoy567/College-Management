/**
 * Demo BOOK SHOP catalog (DEV / demo data only, idempotent):  npm run db:seed:books
 * Adds 40 published books with a price, author, description and a course/group/class where one matches.
 * No PDF and no cover are attached: the Admin uploads those later from Admin > Book shop (a student can still
 * press Pay and the book lands in My Books; the reader tells them the PDF is not uploaded yet).
 * Matched by title, so re-running adds nothing. Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { PrismaClient, type CourseClass, type CourseGroup } from '@prisma/client';

type B = [title: string, author: string, publisher: string, price: number, group: CourseGroup, level: CourseClass, keyword: string];
const BOOKS: B[] = [
  ['Physics First Paper: Concepts and Problems', 'Dr. Shahjahan Tapan', 'Hasan Book House', 350, 'science', 'c11', 'physics'],
  ['Physics Second Paper: Concepts and Problems', 'Dr. Shahjahan Tapan', 'Hasan Book House', 350, 'science', 'c12', 'physics'],
  ['Higher Math Made Simple, Part 1', 'Abdul Matin', 'Tamralipi', 320, 'science', 'c11', 'math'],
  ['Higher Math Made Simple, Part 2', 'Abdul Matin', 'Tamralipi', 320, 'science', 'c12', 'math'],
  ['Chemistry First Paper: Complete Guide', 'Hajari Lal Bhowmik', 'Hafiz Book Centre', 300, 'science', 'c11', 'chemistry'],
  ['Chemistry Second Paper: Complete Guide', 'Hajari Lal Bhowmik', 'Hafiz Book Centre', 300, 'science', 'c12', 'chemistry'],
  ['Biology First Paper: Illustrated Notes', 'Dr. Nasima Akter', 'Gazi Publications', 280, 'science', 'c11', 'biology'],
  ['Biology Second Paper: Illustrated Notes', 'Dr. Nasima Akter', 'Gazi Publications', 280, 'science', 'c12', 'biology'],
  ['Organic Chemistry Reaction Map', 'Rafiq Hossain', 'Open Shelf', 150, 'science', 'both', 'chemistry'],
  ['Physics Numerical Workbook', 'Kamrul Hasan', 'Open Shelf', 120, 'science', 'both', 'physics'],
  ['Calculus Practice Sheets', 'Mahmudul Haque', 'Open Shelf', 100, 'science', 'both', 'math'],
  ['Accounting First Paper: Step by Step', 'Prof. Anwar Kabir', 'Hasan Book House', 340, 'commerce', 'c11', 'accounting'],
  ['Accounting Second Paper: Step by Step', 'Prof. Anwar Kabir', 'Hasan Book House', 340, 'commerce', 'c12', 'accounting'],
  ['Business Organization and Management', 'Md. Selim Reza', 'Tamralipi', 290, 'commerce', 'c11', 'business'],
  ['Finance, Banking and Insurance', 'Farhana Yasmin', 'Gazi Publications', 290, 'commerce', 'c12', 'finance'],
  ['Production Management and Marketing', 'Md. Selim Reza', 'Tamralipi', 270, 'commerce', 'c12', 'marketing'],
  ['Statistics for Commerce Students', 'Dr. Jahangir Alam', 'Hafiz Book Centre', 250, 'commerce', 'both', 'statistics'],
  ['Business Math Shortcuts', 'Dr. Jahangir Alam', 'Open Shelf', 90, 'commerce', 'both', 'math'],
  ['Economics First Paper: Core Ideas', 'Prof. Shamima Nasrin', 'Gazi Publications', 260, 'arts', 'c11', 'economics'],
  ['Economics Second Paper: Core Ideas', 'Prof. Shamima Nasrin', 'Gazi Publications', 260, 'arts', 'c12', 'economics'],
  ['History of Bangladesh and the Subcontinent', 'Dr. Mizanur Rahman', 'Hasan Book House', 300, 'arts', 'both', 'history'],
  ['Civics and Good Governance', 'Prof. Tasnim Jahan', 'Tamralipi', 270, 'arts', 'both', 'civics'],
  ['Sociology: An Introduction', 'Prof. Rubina Sultana', 'Hafiz Book Centre', 250, 'arts', 'both', 'sociology'],
  ['Logic and Critical Thinking', 'Dr. Habibur Rahman', 'Open Shelf', 180, 'arts', 'both', 'logic'],
  ['Islamic History and Culture', 'Maulana Abdul Karim', 'Gazi Publications', 240, 'arts', 'both', 'islamic'],
  ['Geography and Environment', 'Prof. Sultana Razia', 'Hasan Book House', 260, 'arts', 'both', 'geography'],
  ['Bangla First Paper: Prose and Poetry', 'Dr. Anisuzzaman Khan', 'Tamralipi', 220, 'common', 'both', 'bangla'],
  ['Bangla Second Paper: Grammar and Composition', 'Dr. Anisuzzaman Khan', 'Tamralipi', 220, 'common', 'both', 'bangla'],
  ['English First Paper: Reading and Writing', 'Prof. Ruhul Amin', 'Hafiz Book Centre', 230, 'common', 'both', 'english'],
  ['English Second Paper: Grammar and Composition', 'Prof. Ruhul Amin', 'Hafiz Book Centre', 230, 'common', 'both', 'english'],
  ['English Vocabulary Builder', 'Nusrat Jahan', 'Open Shelf', 80, 'common', 'both', 'english'],
  ['ICT: Theory and Practical', 'Engr. Tanvir Ahmed', 'Gazi Publications', 280, 'common', 'both', 'ict'],
  ['ICT Chapter-wise MCQ Bank', 'Engr. Tanvir Ahmed', 'Open Shelf', 60, 'common', 'both', 'ict'],
  ['Programming Basics with C', 'Engr. Tanvir Ahmed', 'Open Shelf', 200, 'common', 'both', 'ict'],
  ['HSC Model Test Papers 2026', 'Editorial Board', 'Hasan Book House', 0, 'common', 'both', ''],
  ['Study Skills and Exam Strategy', 'Dr. Farzana Haque', 'Open Shelf', 0, 'common', 'both', ''],
  ['Admission Test Guide: Medical and Engineering', 'Editorial Board', 'Gazi Publications', 450, 'science', 'c12', ''],
  ['Admission Test Guide: Business and Arts', 'Editorial Board', 'Gazi Publications', 400, 'common', 'c12', ''],
  ['Previous Board Questions with Solutions, 10 Years', 'Editorial Board', 'Hafiz Book Centre', 380, 'common', 'both', ''],
  ['Spoken English in 30 Days', 'Nusrat Jahan', 'Open Shelf', 70, 'common', 'both', ''],
];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seeds do not run in production.');
  const prisma = new PrismaClient();
  try {
    const courses = await prisma.course.findMany({ where: { archivedAt: null }, select: { id: true, name: true, groupType: true, classLevel: true } });
    const existing = new Set((await prisma.book.findMany({ select: { title: true } })).map((b) => b.title));
    let added = 0;
    for (const [i, [title, author, publisher, price, groupType, classLevel, kw]] of BOOKS.entries()) {
      if (existing.has(title)) continue;
      const course = kw
        ? courses.find((c) => c.name.toLowerCase().includes(kw) && (groupType === 'common' || c.groupType === groupType) && (classLevel === 'both' || c.classLevel === classLevel || c.classLevel === 'both'))
        : undefined;
      await prisma.book.create({
        data: {
          title, author, publisher, price, groupType, classLevel, courseId: course?.id ?? null,
          description: `${title} by ${author}. Chapter-wise notes, worked examples and practice questions for HSC students. (Demo book: the PDF is uploaded by the Admin.)`,
          previewPages: [], publishedAt: new Date(Date.now() - i * 3_600_000),
        },
      });
      added++;
    }
    console.log(`Books: ${added} added (${BOOKS.length - added} already present). No PDFs or covers attached.`);
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
