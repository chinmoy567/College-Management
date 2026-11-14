import { test, expect } from '@playwright/test';
import { makeExam, makeResult, prisma } from './exam-kit';
import { makeOffering, makeSection, makeUser, signIn } from './sch-kit';

test.afterAll(() => prisma.$disconnect());

test('[EXAM-20] student progress page: marks, %, grade, section rank, trend chart, strong/weak chapters', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const teacher = await makeUser('teacher');
  const me = await makeUser('student', sectionId, 'Progress Student');
  const other = await makeUser('student', sectionId, 'Classmate');
  const { course, offering } = await makeOffering(sectionId, teacher.id, [me.id, other.id]);
  const a = await prisma.chapter.create({ data: { courseId: course.id, name: 'Algebra', order: 1, createdById: teacher.id } });
  const b = await prisma.chapter.create({ data: { courseId: course.id, name: 'Geometry', order: 2, createdById: teacher.id } });
  const qs = [a, a, a, b, b, b].map((c, i) => ({ text: `Q${i + 1}`, chapterId: c.id }));
  const done = { status: 'closed' as const, revealed: true, resultsPublished: true, startOffsetMin: -3 * 1440, endOffsetMin: -2 * 1440 };
  const e1 = await makeExam(offering.id, teacher.id, qs, { ...done, title: 'Midterm', passMarks: 3 });
  const e2 = await makeExam(offering.id, teacher.id, qs, { ...done, title: 'Final', passMarks: 3, startOffsetMin: -2 * 1440 + 10, endOffsetMin: -1440 });
  // me: Midterm 3/6 (Algebra right, Geometry wrong) = 50%, B; Final 6/6 = 100%, A+. Classmate scores lower in both.
  await makeResult(e1.exam.id, me.id, sectionId, [true, true, true, false, false, false]);
  await makeResult(e1.exam.id, other.id, sectionId, [true, true, false, false, false, false]);
  await makeResult(e2.exam.id, me.id, sectionId, [true, true, true, true, true, true]);
  await makeResult(e2.exam.id, other.id, sectionId, [true, true, true, false, false, false]);
  await signIn(context, baseURL!, me);

  await page.goto('/student/progress');
  const r1 = page.getByTestId(`result-${e1.exam.id}`);
  await expect(r1).toBeVisible({ timeout: 60_000 });
  await expect(r1.getByTestId('marks')).toHaveText('3/6');
  await expect(r1.getByTestId('pct')).toHaveText('50%');
  await expect(r1.getByTestId('grade')).toHaveText('B');
  await expect(r1.getByTestId('rank')).toHaveText('1/2');
  const r2 = page.getByTestId(`result-${e2.exam.id}`);
  await expect(r2.getByTestId('marks')).toHaveText('6/6');
  await expect(r2.getByTestId('pct')).toHaveText('100%');
  await expect(r2.getByTestId('grade')).toHaveText('A+');
  await expect(r2.getByTestId('rank')).toHaveText('1/2');

  // course overall: average of 50% and 100% = 75% (A), rank 1 of 2
  const card = page.getByTestId(`course-${course.code}`);
  await expect(card.getByTestId('course-pct')).toHaveText('75%');
  await expect(card.getByTestId('course-grade')).toHaveText('A');
  await expect(card.getByTestId('course-rank')).toHaveText('1/2');

  // trend chart (Recharts, loaded lazily)
  await expect(page.getByTestId('trend-chart').locator('svg.recharts-surface').first()).toBeVisible({ timeout: 30_000 });

  // strong / weak chapters: Algebra 100%, Geometry 50%
  await expect(page.getByTestId('chapters-strong')).toContainText('Algebra');
  await expect(page.getByTestId('chapters-strong')).toContainText('100%');
  await expect(page.getByTestId('chapters-weak')).toContainText('Geometry');
  await expect(page.getByTestId('chapters-weak')).toContainText('50%');

  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
