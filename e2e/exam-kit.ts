import type { ExamKind, Prisma } from '@prisma/client';
import { prisma } from './sch-kit';

export { prisma };
const OPTS = (n: number, tag: string) => Array.from({ length: n }, (_, i) => ({ id: `o${i + 1}`, text: `${tag} option ${i + 1}` }));

export interface SeedQuestion { text: string; chapterId?: string | null; correct?: string[]; marks?: number }

/** A published exam with single-answer questions (4 options each, o1 is correct unless given). Times are relative to now. */
export async function makeExam(offeringId: string, teacherId: string, questions: SeedQuestion[], o: {
  title?: string; kind?: ExamKind; startOffsetMin?: number; endOffsetMin?: number; durationMin?: number; passMarks?: number;
  revealed?: boolean; resultsPublished?: boolean; shuffleQuestions?: boolean; status?: 'published' | 'closed';
} = {}) {
  const total = questions.reduce((s, q) => s + (q.marks ?? 1), 0);
  const at = (min: number) => new Date(Date.now() + min * 60_000);
  const exam = await prisma.exam.create({
    data: {
      courseOfferingId: offeringId, createdBy: teacherId, kind: o.kind ?? 'exam', title: o.title ?? 'E2E exam',
      startAt: at(o.startOffsetMin ?? -2), endAt: at(o.endOffsetMin ?? 60), durationMin: o.durationMin ?? 30,
      totalMarks: total, passMarks: o.passMarks ?? 1, maxAttempts: 1, shuffleQuestions: o.shuffleQuestions ?? false, shuffleOptions: false,
      status: o.status ?? 'published', publishedAt: new Date(), revealedAt: o.revealed ? new Date() : null, resultsPublishedAt: o.resultsPublished ? new Date() : null,
    },
  });
  const rows = [];
  for (const [i, q] of questions.entries()) {
    rows.push(await prisma.examQuestion.create({
      data: {
        examId: exam.id, order: i + 1, type: 'single', text: q.text, options: OPTS(4, `Q${i + 1}`), correct: q.correct ?? ['o1'],
        marks: q.marks ?? 1, chapterId: q.chapterId ?? null,
      },
    }));
  }
  return { exam, questions: rows };
}

/** A finished attempt with the given answers (true = the right option, false = a wrong one, null = unanswered), already graded. */
export async function makeResult(examId: string, studentId: string, sectionId: string, correctFlags: (boolean | null)[]) {
  const qs = await prisma.examQuestion.findMany({ where: { examId }, orderBy: { order: 'asc' } });
  const score = correctFlags.reduce<number>((s, f, i) => s + (f ? Number(qs[i]!.marks) : 0), 0);
  const attempt = await prisma.examAttempt.create({
    data: {
      examId, studentId, attemptNo: 1, sectionId, startedAt: new Date(Date.now() - 2 * 86_400_000), deadlineAt: new Date(Date.now() - 2 * 86_400_000 + 30 * 60_000),
      submittedAt: new Date(Date.now() - 2 * 86_400_000 + 20 * 60_000), status: 'submitted', score,
      questionOrder: qs.map((q) => ({ q: q.id, o: ['o1', 'o2', 'o3', 'o4'] })) as unknown as Prisma.InputJsonValue,
    },
  });
  for (const [i, f] of correctFlags.entries()) {
    if (f === null) continue;
    await prisma.answer.create({
      data: { attemptId: attempt.id, examQuestionId: qs[i]!.id, selectedOptionIds: [f ? 'o1' : 'o2'], isCorrect: f, marksAwarded: f ? qs[i]!.marks : 0 },
    });
  }
  return attempt;
}
