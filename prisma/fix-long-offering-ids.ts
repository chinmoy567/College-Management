/**
 * One-off dev fix:  npx tsx prisma/fix-long-offering-ids.ts
 * The demo seeds named offerings `demo-offering-<sectionId>-<code>` (45+ characters) but the API accepts ids of at most
 * 40 characters, so the exam pages returned 400 "Invalid id". This renames every offering id longer than 40 characters to
 * `do-<last 10 of section id>-<course code>`; foreign keys are ON UPDATE CASCADE, so all linked rows follow.
 * Demo data whose ids or JSON were derived from the old offering id is removed first so the seeds can recreate it:
 * demo exams (dx-, dxb-), demo online classes / recordings / offering notes (dol-, doj-, drc-, dmt-<short>) and class
 * notices (dn-k-). Afterwards run: db:seed:exams, db:seed:exam-extras, db:seed:learning, db:seed:notices.
 * Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

export async function fixLongOfferingIds(prisma: PrismaClient): Promise<number> {
  if (process.env.NODE_ENV === 'production') throw new Error('fix-long-offering-ids is for development data only');
  const longOnes = (await prisma.courseOffering.findMany({ select: { id: true, sectionId: true, course: { select: { code: true } } } })).filter((o) => o.id.length > 40);
  if (!longOnes.length) return 0;

  // 1. demo exam data
  const examIds = (await prisma.exam.findMany({ where: { id: { startsWith: 'dx-' } }, select: { id: true } })).map((e) => e.id);
  const attemptIds = (await prisma.examAttempt.findMany({ where: { examId: { in: examIds } }, select: { id: true } })).map((a) => a.id);
  for (let i = 0; i < attemptIds.length; i += 5000) await prisma.attemptExtension.deleteMany({ where: { attemptId: { in: attemptIds.slice(i, i + 5000) } } });
  await prisma.examChangeLog.deleteMany({ where: { examId: { in: examIds } } });
  for (let i = 0; i < attemptIds.length; i += 5000) await prisma.answer.deleteMany({ where: { attemptId: { in: attemptIds.slice(i, i + 5000) } } });
  await prisma.examAttempt.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.notification.deleteMany({ where: { id: { startsWith: 'dkf-' } } });
  await prisma.exam.deleteMany({ where: { id: { in: examIds } } }); // exam questions cascade
  await prisma.question.deleteMany({ where: { id: { startsWith: 'dxb-' } } });
  // 2. demo learning content tied to offerings
  await prisma.onlineClassJoin.deleteMany({ where: { id: { startsWith: 'doj-' } } });
  await prisma.onlineClassOffering.deleteMany({ where: { onlineClassId: { startsWith: 'dol-' } } });
  await prisma.onlineClass.deleteMany({ where: { id: { startsWith: 'dol-' } } });
  await prisma.recordingProgress.deleteMany({ where: { recordedClassId: { startsWith: 'drc-' } } });
  await prisma.recordedClass.deleteMany({ where: { id: { startsWith: 'drc-' } } });
  await prisma.material.deleteMany({ where: { id: { startsWith: 'dmt-' }, scope: 'offering' } });
  // 3. class notices (audience JSON holds offering ids)
  const noticeIds = (await prisma.notice.findMany({ where: { id: { startsWith: 'dn-k-' } }, select: { id: true } })).map((n) => n.id);
  await prisma.notification.deleteMany({ where: { id: { startsWith: 'dnn-dn-k-' } } });
  await prisma.noticeRead.deleteMany({ where: { noticeId: { in: noticeIds } } });
  await prisma.noticeRecipient.deleteMany({ where: { noticeId: { in: noticeIds } } });
  await prisma.notice.deleteMany({ where: { id: { in: noticeIds } } });
  // 4. rename
  for (const o of longOnes) {
    const newId = `do-${o.sectionId.slice(-10)}-${o.course.code}`.slice(0, 40);
    await prisma.$executeRaw`UPDATE course_offerings SET id = ${newId} WHERE id = ${o.id}`;
  }
  return longOnes.length;
}

if (process.argv[1] && /fix-long-offering-ids\.ts$/.test(process.argv[1])) {
  const prisma = new PrismaClient();
  fixLongOfferingIds(prisma)
    .then((n) => console.log(`${n} offering ids shortened.`))
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
