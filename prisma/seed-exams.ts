/**
 * Demo EXAM data (DEV / demo data only, idempotent):  npm run db:seed:exams
 * For up to 6 demo offerings that have active students it adds, with fixed ids so a re-run changes nothing:
 *  - a question bank (10 questions over 3 chapters, 8 single + 2 multiple answer),
 *  - Past exam (instant result, results published, revealed)   - ranks, grades, report, progress page
 *  - Past quiz (3 attempts allowed, best attempt ranks)
 *  - Past exam, manual result mode, results NOT yet published  - "Publish results" button
 *  - Live exam (window open now, nobody has started)            - student can take it, teacher sees "did not attend"
 *  - Upcoming exam (published, starts in 3 days)                - editable by the teacher
 *  - Draft exam (no questions)
 * Each student has a fixed "ability" (about 35%..95% correct) derived from the id, so scores, ranks,
 * pass/fail and strong/weak chapters all vary, and about 12% of students miss each past exam.
 * Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { Prisma, PrismaClient, type ExamKind, type ExamStatus, type ResultMode } from '@prisma/client';

const MAX_OFFERINGS = 6;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const Q_COUNT = 10;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296; // 0..1
}

type Opt = { id: string; text: string };
interface QDef { type: 'single' | 'multiple'; text: string; options: Opt[]; correct: string[]; marks: number; chapter: number }

/** The same 10 questions for every offering: text names the course so the screens read naturally. */
function questionDefs(courseName: string): QDef[] {
  const defs: QDef[] = [];
  for (let i = 0; i < Q_COUNT; i++) {
    const multiple = i === 3 || i === 7;
    const options = ['A', 'B', 'C', 'D'].map((l, k) => ({ id: `o${k + 1}`, text: `Option ${l} for question ${i + 1}` }));
    const single = `o${(i % 4) + 1}`;
    const correct = multiple ? [`o${(i % 4) + 1}`, `o${((i + 2) % 4) + 1}`].sort() : [single];
    defs.push({
      type: multiple ? 'multiple' : 'single',
      text: `${courseName}: sample question ${i + 1}${multiple ? ' (choose all that apply)' : ''}`,
      options, correct, marks: i < 8 ? 1 : 2, chapter: i % 3,
    });
  }
  return defs;
}

interface ExamPlan {
  key: string; kind: ExamKind; title: string; startOffsetMs: number; windowMs: number; durationMin: number;
  maxAttempts: number; resultMode: ResultMode; status: ExamStatus; withQuestions: boolean;
  attempts: 'one' | 'quiz' | 'none'; resultsPublished: boolean; revealed: boolean; participation: number;
}

const PLANS: ExamPlan[] = [
  { key: 'past', kind: 'exam', title: 'Mid-term exam', startOffsetMs: -14 * DAY, windowMs: 2 * HOUR, durationMin: 60, maxAttempts: 1, resultMode: 'instant', status: 'closed', withQuestions: true, attempts: 'one', resultsPublished: true, revealed: true, participation: 0.88 },
  { key: 'quiz', kind: 'quiz', title: 'Weekly quiz', startOffsetMs: -7 * DAY, windowMs: 2 * DAY, durationMin: 15, maxAttempts: 3, resultMode: 'instant', status: 'closed', withQuestions: true, attempts: 'quiz', resultsPublished: true, revealed: true, participation: 0.8 },
  { key: 'manual', kind: 'exam', title: 'Unit test (result pending)', startOffsetMs: -2 * DAY, windowMs: 2 * HOUR, durationMin: 30, maxAttempts: 1, resultMode: 'manual', status: 'closed', withQuestions: true, attempts: 'one', resultsPublished: false, revealed: true, participation: 0.9 },
  { key: 'live', kind: 'exam', title: 'Live exam (open now)', startOffsetMs: -1 * HOUR, windowMs: 26 * HOUR, durationMin: 30, maxAttempts: 1, resultMode: 'instant', status: 'published', withQuestions: true, attempts: 'none', resultsPublished: false, revealed: false, participation: 0 },
  { key: 'upcoming', kind: 'exam', title: 'Upcoming exam', startOffsetMs: 3 * DAY, windowMs: 2 * HOUR, durationMin: 45, maxAttempts: 1, resultMode: 'instant', status: 'published', withQuestions: true, attempts: 'none', resultsPublished: false, revealed: false, participation: 0 },
  { key: 'draft', kind: 'exam', title: 'Draft exam (not published)', startOffsetMs: 10 * DAY, windowMs: 2 * HOUR, durationMin: 60, maxAttempts: 1, resultMode: 'instant', status: 'draft', withQuestions: false, attempts: 'none', resultsPublished: false, revealed: false, participation: 0 },
];

export async function seedExams(prisma: PrismaClient): Promise<{ offerings: number; exams: number; attempts: number }> {
  if (process.env.NODE_ENV === 'production') throw new Error('seed-exams is for development data only');

  const offerings = await prisma.courseOffering.findMany({
    where: { endedAt: null, enrollments: { some: { status: 'active' } } },
    include: { course: true },
    orderBy: { id: 'asc' },
    take: MAX_OFFERINGS,
  });

  const now = Date.now();
  let examCount = 0, attemptCount = 0;

  for (const off of offerings) {
    // chapters (find by name, create when missing)
    const chapterIds: string[] = [];
    for (let c = 0; c < 3; c++) {
      const name = `Chapter ${c + 1}`;
      const found = await prisma.chapter.findFirst({ where: { courseId: off.courseId, name } });
      if (found) { chapterIds.push(found.id); continue; }
      const max = await prisma.chapter.aggregate({ where: { courseId: off.courseId }, _max: { order: true } });
      const made = await prisma.chapter.create({ data: { courseId: off.courseId, name, order: (max._max.order ?? 0) + 1, createdById: off.teacherId } });
      chapterIds.push(made.id);
    }

    const defs = questionDefs(off.course.name);
    const bankIds: string[] = [];
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i]!;
      const id = `demo-bank-${off.id}-${i + 1}`;
      bankIds.push(id);
      await prisma.question.upsert({
        where: { id },
        update: {},
        create: { id, teacherId: off.teacherId, courseId: off.courseId, chapterId: chapterIds[d.chapter]!, type: d.type, text: d.text, options: d.options, correct: d.correct, marks: d.marks },
      });
    }

    const students = await prisma.enrollment.findMany({
      where: { courseOfferingId: off.id, status: 'active' },
      select: { studentId: true, student: { select: { sectionId: true } } },
    });
    const totalMarks = defs.reduce((s, d) => s + d.marks, 0);

    for (const plan of PLANS) {
      const examId = `demo-exam-${off.id}-${plan.key}`;
      const startAt = new Date(now + plan.startOffsetMs);
      const endAt = new Date(startAt.getTime() + plan.windowMs);
      const passMarks = Math.round(totalMarks * 0.4);
      // a draft has no questions, so its total is max(sum, pass) (spec 05 section 3)
      const exam = await prisma.exam.createMany({
        data: [{
          id: examId, courseOfferingId: off.id, createdBy: off.teacherId, kind: plan.kind, title: `${off.course.name} - ${plan.title}`,
          instructions: 'Read each question carefully. Demo data.', startAt, endAt, durationMin: plan.durationMin,
          totalMarks: plan.withQuestions ? totalMarks : passMarks, passMarks,
          maxAttempts: plan.maxAttempts, shuffleQuestions: false, shuffleOptions: false, showAnswersAfterEnd: true,
          resultMode: plan.resultMode, status: plan.status,
          publishedAt: plan.status === 'draft' ? null : new Date(startAt.getTime() - 3 * DAY),
          resultsPublishedAt: plan.resultsPublished ? endAt : null,
          revealedAt: plan.revealed ? endAt : null,
        }],
        skipDuplicates: true,
      });
      examCount += exam.count;
      if (!plan.withQuestions) continue;

      const eqIds = defs.map((_, i) => `${examId}-q${i + 1}`);
      await prisma.examQuestion.createMany({
        data: defs.map((d, i) => ({ id: eqIds[i]!, examId, questionId: bankIds[i]!, order: i + 1, type: d.type, text: d.text, options: d.options, correct: d.correct, marks: d.marks, chapterId: chapterIds[d.chapter]! })),
        skipDuplicates: true,
      });

      if (plan.attempts === 'none') continue;

      const attempts: Prisma.ExamAttemptCreateManyInput[] = [];
      const answers: Prisma.AnswerCreateManyInput[] = [];
      for (const st of students) {
        const ability = 0.35 + hash(st.studentId) * 0.6;
        if (hash(`miss|${st.studentId}|${examId}`) > plan.participation) continue; // did not attend
        const nAttempts = plan.attempts === 'quiz' ? 1 + Math.floor(hash(`n|${st.studentId}|${examId}`) * 3) : 1;
        for (let a = 1; a <= nAttempts; a++) {
          const startedAt = new Date(startAt.getTime() + Math.floor(hash(`s|${st.studentId}|${examId}|${a}`) * (plan.windowMs / 2)) + (a - 1) * 20 * 60000);
          const submittedAt = new Date(startedAt.getTime() + plan.durationMin * 60000 * (0.5 + hash(`d|${st.studentId}|${examId}|${a}`) * 0.45));
          const attemptId = `${examId}-a-${st.studentId}-${a}`;
          let score = 0;
          defs.forEach((d, i) => {
            const right = hash(`r|${st.studentId}|${examId}|${a}|${i}`) < Math.min(0.97, ability + (a - 1) * 0.08);
            const wrong = d.options.map((o) => o.id).filter((o) => !d.correct.includes(o));
            const selected = right ? d.correct : [wrong[Math.floor(hash(`w|${st.studentId}|${examId}|${a}|${i}`) * wrong.length)]!];
            const marks = right ? d.marks : 0;
            score += marks;
            answers.push({ attemptId, examQuestionId: eqIds[i]!, selectedOptionIds: selected, isCorrect: right, marksAwarded: marks });
          });
          attempts.push({
            id: attemptId, examId, studentId: st.studentId, attemptNo: a, sectionId: st.student.sectionId,
            startedAt, deadlineAt: new Date(Math.min(startedAt.getTime() + plan.durationMin * 60000, endAt.getTime())),
            questionOrder: eqIds.map((q, i) => ({ q, o: defs[i]!.options.map((o) => o.id) })),
            submittedAt, score, status: 'submitted', integrityLog: [],
          });
        }
      }
      for (let i = 0; i < attempts.length; i += 500) attemptCount += (await prisma.examAttempt.createMany({ data: attempts.slice(i, i + 500), skipDuplicates: true })).count;
      for (let i = 0; i < answers.length; i += 2000) await prisma.answer.createMany({ data: answers.slice(i, i + 2000), skipDuplicates: true });
    }
  }
  return { offerings: offerings.length, exams: examCount, attempts: attemptCount };
}

if (process.argv[1] && /seed-exams\.ts$/.test(process.argv[1])) {
  const prisma = new PrismaClient();
  seedExams(prisma)
    .then((x) => console.log(`Exam demo data: ${x.offerings} offerings, ${x.exams} exams and ${x.attempts} attempts added.`))
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
