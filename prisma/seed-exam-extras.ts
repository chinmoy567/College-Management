/**
 * Demo EXAM EXTRAS (DEV / demo data only, idempotent):  npm run db:seed:exam-extras
 * Run it after  npm run db:seed:exams. For the past instant-result exam (`dx-<offering>-past`) of every demo offering:
 *  - every 2nd offering gets an ANSWER-KEY FIX on question 5 (new key, ExamChangeLog, all answers and attempt scores
 *    regraded, `exam_key_fixed` notification to the students who took it),
 *  - every 3rd offering gets a CANCELLED question 10 (everybody gets its marks, ExamChangeLog, regrade, notification),
 *  - up to 2 attempts per offering get a logged EXTRA-TIME extension (AttemptExtension, 10 minutes).
 * Each change is applied once: a re-run finds the log row and skips. Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';

export async function seedExamExtras(prisma: PrismaClient): Promise<{ fixes: number; cancels: number; extensions: number }> {
  if (process.env.NODE_ENV === 'production') throw new Error('seed-exam-extras is for development data only');

  const exams = await prisma.exam.findMany({
    where: { id: { startsWith: 'dx-', endsWith: '-past' }, status: 'closed' },
    select: { id: true, createdBy: true, title: true },
    orderBy: { id: 'asc' },
  });
  if (!exams.length) throw new Error('No demo exams found: run npm run db:seed:exams first');
  let fixes = 0, cancels = 0, extensions = 0;

  for (let idx = 0; idx < exams.length; idx++) {
    const exam = exams[idx]!;
    const attempts = await prisma.examAttempt.findMany({ where: { examId: exam.id }, select: { id: true, studentId: true }, orderBy: { id: 'asc' } });

    if (idx % 2 === 0) {
      const eqId = `${exam.id}-q5`;
      const eq = await prisma.examQuestion.findUnique({ where: { id: eqId } });
      const done = await prisma.examChangeLog.findFirst({ where: { examQuestionId: eqId } });
      if (eq && !done && !eq.isCancelled) {
        const options = (eq.options as { id: string }[]).map((o) => o.id);
        const from = eq.correct as string[];
        const to = [options.find((o) => !from.includes(o)) ?? options[0]!];
        await prisma.$transaction(async (tx) => {
          await tx.examQuestion.update({ where: { id: eqId }, data: { correct: to } });
          await tx.examChangeLog.create({ data: { examId: exam.id, examQuestionId: eqId, change: { from, to }, changedBy: exam.createdBy, createdAt: new Date(Date.now() - 12 * 3600000) } });
          const answers = await tx.answer.findMany({ where: { examQuestionId: eqId }, select: { attemptId: true, selectedOptionIds: true } });
          const right = answers.filter((a) => a.selectedOptionIds.length === to.length && a.selectedOptionIds.every((o) => to.includes(o))).map((a) => a.attemptId);
          const wrong = answers.filter((a) => !right.includes(a.attemptId)).map((a) => a.attemptId);
          if (right.length) await tx.answer.updateMany({ where: { examQuestionId: eqId, attemptId: { in: right } }, data: { isCorrect: true, marksAwarded: eq.marks } });
          if (wrong.length) await tx.answer.updateMany({ where: { examQuestionId: eqId, attemptId: { in: wrong } }, data: { isCorrect: false, marksAwarded: 0 } });
          await tx.$executeRaw(Prisma.sql`UPDATE exam_attempts a SET score = (SELECT COALESCE(SUM(marks_awarded), 0) FROM answers WHERE attempt_id = a.id) WHERE a.exam_id = ${exam.id}`);
          await tx.notification.createMany({
            skipDuplicates: true,
            data: attempts.map((a) => ({ id: `dkf-${eqId.slice(-14)}-${a.studentId.slice(-8)}`, userId: a.studentId, type: 'exam_key_fixed', refType: 'exam', refId: exam.id, text: `The answer key of a question in "${exam.title}" was corrected and your score was updated.` })),
          });
        });
        fixes++;
      }
    }

    if (idx % 3 === 0) {
      const eqId = `${exam.id}-q10`;
      const eq = await prisma.examQuestion.findUnique({ where: { id: eqId } });
      const done = await prisma.examChangeLog.findFirst({ where: { examQuestionId: eqId } });
      if (eq && !done && !eq.isCancelled) {
        await prisma.$transaction(async (tx) => {
          await tx.examQuestion.update({ where: { id: eqId }, data: { isCancelled: true } });
          await tx.examChangeLog.create({ data: { examId: exam.id, examQuestionId: eqId, change: { cancelled: true }, changedBy: exam.createdBy, createdAt: new Date(Date.now() - 10 * 3600000) } });
          await tx.answer.updateMany({ where: { examQuestionId: eqId }, data: { isCorrect: true, marksAwarded: eq.marks } });
          await tx.$executeRaw(Prisma.sql`UPDATE exam_attempts a SET score = (SELECT COALESCE(SUM(marks_awarded), 0) FROM answers WHERE attempt_id = a.id) WHERE a.exam_id = ${exam.id}`);
          await tx.notification.createMany({
            skipDuplicates: true,
            data: attempts.map((a) => ({ id: `dkf-${eqId.slice(-14)}-${a.studentId.slice(-8)}`, userId: a.studentId, type: 'exam_key_fixed', refType: 'exam', refId: exam.id, text: `A question in "${exam.title}" was cancelled; everyone received its marks.` })),
          });
        });
        cancels++;
      }
    }

    for (const a of attempts.slice(0, 2)) {
      if (await prisma.attemptExtension.findFirst({ where: { attemptId: a.id } })) continue;
      await prisma.attemptExtension.create({ data: { attemptId: a.id, minutes: 10, reopened: false, givenBy: exam.createdBy, createdAt: new Date(Date.now() - 13 * 24 * 3600000) } });
      extensions++;
    }
  }
  return { fixes, cancels, extensions };
}

if (process.argv[1] && /seed-exam-extras\.ts$/.test(process.argv[1])) {
  const prisma = new PrismaClient();
  seedExamExtras(prisma)
    .then((x) => console.log(`Exam extras: ${x.fixes} answer-key fixes, ${x.cancels} cancelled questions and ${x.extensions} extensions added.`))
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
