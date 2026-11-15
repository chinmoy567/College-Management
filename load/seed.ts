/**
 * Load seed (11 §5): 510 fake students in 17 sections, one exam of 40 questions open now, 7 chat
 * conversations covering 200 students, and a login session per student (so argon2 is not in the measurement).
 * Writes test-results/load/fixture.json (gitignored: contains session tokens). Run against a DISPOSABLE local database only.
 *   DATABASE_URL=postgresql://...localhost... npx tsx load/seed.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { randomToken, sha256 } from '../apps/api/src/lib/crypto';

const prisma = new PrismaClient();
const STUDENTS = Number(process.env.LOAD_STUDENTS ?? 510);
const PER_SECTION = 30;
const QUESTIONS = 40;

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) throw new Error('Refusing to seed a non-local database.');
  const tag = Date.now().toString(36);
  const session = await prisma.session.create({ data: { name: `LOAD-${tag}` } });
  const group = await prisma.group.create({ data: { sessionId: session.id, type: 'science' } });
  const teacher = await prisma.user.create({
    data: { role: 'teacher', email: `lt-${tag}@load.test`, loginId: `lt${tag}`, passwordHash: 'x', firstLogin: false, mustChangePassword: false, teacher: { create: { name: 'Load Teacher', subjects: [] } } },
  });
  const sections: string[] = [];
  for (let i = 0; i < Math.ceil(STUDENTS / PER_SECTION); i++)
    sections.push((await prisma.section.create({ data: { groupId: group.id, classLevel: 11, name: String.fromCharCode(65 + i) } })).id);
  const course = await prisma.course.create({ data: { code: `LD${tag}`, name: 'Load course', groupType: 'common', classLevel: 'both' } });
  const offering = await prisma.courseOffering.create({ data: { sectionId: sections[0]!, courseId: course.id, teacherId: teacher.id } });

  const students: { id: string; token: string; section: number }[] = [];
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  for (let i = 0; i < STUDENTS; i++) {
    const s = Math.floor(i / PER_SECTION);
    const u = await prisma.user.create({
      data: {
        role: 'student', email: `ls${i}-${tag}@load.test`, loginId: `ls${i}${tag}`, passwordHash: 'x', firstLogin: false, mustChangePassword: false,
        student: { create: { name: `Load Student ${i}`, roll: String(i + 1), sectionId: sections[s]! } },
      },
    });
    const token = randomToken(32);
    await prisma.loginSession.create({ data: { userId: u.id, tokenHash: sha256(token), expiresAt } });
    await prisma.enrollment.create({ data: { courseOfferingId: offering.id, studentId: u.id, enrolledAt: new Date(Date.now() - 86_400_000) } });
    students.push({ id: u.id, token, section: s });
  }

  const exam = await prisma.exam.create({
    data: {
      courseOfferingId: offering.id, createdBy: teacher.id, kind: 'exam', title: 'Load exam', startAt: new Date(Date.now() - 60_000),
      endAt: new Date(Date.now() + 4 * 3600_000), durationMin: 60, totalMarks: QUESTIONS, passMarks: 1, maxAttempts: 1,
      shuffleQuestions: true, shuffleOptions: true, status: 'published', publishedAt: new Date(),
    },
  });
  for (let q = 0; q < QUESTIONS; q++)
    await prisma.examQuestion.create({
      data: { examId: exam.id, order: q + 1, type: 'single', text: `Question ${q + 1}`, options: [1, 2, 3, 4].map((n) => ({ id: `o${n}`, text: `Option ${n}` })), correct: ['o1'], marks: 1 },
    });

  // Chat: 7 group conversations, ~29 students each = 200 sockets.
  const conversations: { id: string; userIds: string[]; tokens: string[] }[] = [];
  const chatStudents = students.slice(0, 200);
  for (let c = 0; c < 7; c++) {
    const members = chatStudents.filter((_, i) => i % 7 === c);
    const conv = await prisma.conversation.create({ data: { type: 'group', refId: `load-${tag}-${c}` } });
    await prisma.conversationMember.createMany({ data: members.map((m) => ({ conversationId: conv.id, userId: m.id })) });
    conversations.push({ id: conv.id, userIds: members.map((m) => m.id), tokens: members.map((m) => m.token) });
  }

  const dir = path.resolve(__dirname, '../test-results/load');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'fixture.json'), JSON.stringify({ examId: exam.id, students, conversations }, null, 1));
  console.log(`seeded ${students.length} students, exam ${exam.id}, ${conversations.length} conversations`);
}
main().finally(() => prisma.$disconnect());
