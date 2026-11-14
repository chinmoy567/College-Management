import { test, expect } from '@playwright/test';
import { makeExam, prisma } from './exam-kit';
import { makeOffering, makeSection, makeUser, signIn } from './sch-kit';

test.afterAll(() => prisma.$disconnect());

test('[EXAM-19] exam page at 360 px: timer always visible, tick on save, reload resumes, no animation', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const teacher = await makeUser('teacher');
  const student = await makeUser('student', sectionId, 'Exam Taker');
  const { offering } = await makeOffering(sectionId, teacher.id, [student.id]);
  const questions = Array.from({ length: 6 }, (_, i) => ({ text: `Question number ${i + 1}? ${'filler '.repeat(40)}` }));
  const { exam } = await makeExam(offering.id, teacher.id, questions, { title: 'Phone exam', shuffleQuestions: true, durationMin: 30 });
  await signIn(context, baseURL!, student);

  // list shows the live exam with a countdown, then Start opens the exam page
  await page.goto('/student/exams');
  await expect(page.getByTestId(`exam-${exam.id}`)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('countdown').first()).toContainText('Closes in');
  await page.goto(`/student/exams/${exam.id}`);
  await page.getByTestId('start-exam').click();
  await expect(page).toHaveURL(/\/student\/take\//, { timeout: 60_000 });

  // timer visible and sticky; no bottom/top nav on the exam page
  const timer = page.getByTestId('timer');
  await expect(timer).toBeVisible();
  await expect(timer).toHaveText(/^(29|30):\d\d$/);
  await expect(page.locator('nav')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const t1 = await timer.textContent();
  await page.waitForTimeout(2200);
  expect(await timer.textContent()).not.toBe(t1); // it is ticking
  const header = page.locator('header').first();
  expect(await header.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
  await page.mouse.wheel(0, 600);
  const box = (await timer.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(740);

  // one question per screen, big targets
  await expect(page.getByTestId('question-counter')).toHaveText('Question 1 of 6');
  const opt = page.getByTestId('option-o2');
  expect((await opt.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const firstText = (await page.getByTestId('question-text').textContent())!;

  // tap -> saving -> "Saved ✓"; the server has it
  await opt.click();
  await expect(page.getByTestId('save-status')).toHaveText('Saved ✓');
  await expect(opt).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('next-q').click();
  await expect(page.getByTestId('question-counter')).toHaveText('Question 2 of 6');
  const secondText = (await page.getByTestId('question-text').textContent())!;
  await page.getByTestId('option-o3').click();
  await page.getByTestId('mark-review').click();
  await expect(page.getByTestId('save-status')).toHaveText('Saved ✓');

  // offline: the tap is queued, then saved when the network is back
  await page.getByTestId('next-q').click();
  await context.setOffline(true);
  await page.getByTestId('option-o4').click();
  await expect(page.getByTestId('save-status')).toHaveText('Offline, will retry', { timeout: 15_000 });
  await context.setOffline(false);
  await expect(page.getByTestId('save-status')).toHaveText('Saved ✓', { timeout: 15_000 });

  // navigator states
  await page.getByTestId('open-navigator').click();
  const nav = page.getByTestId('navigator');
  await expect(nav.getByRole('button', { name: 'Question 1, answered' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Question 2, marked' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Question 4, empty' })).toBeVisible();
  expect((await nav.getByRole('button').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Close' }).click();

  // reload resumes: same order, same answers, timer continues
  await page.reload();
  await expect(page.getByTestId('question-counter')).toHaveText('Question 1 of 6', { timeout: 60_000 });
  expect(await page.getByTestId('question-text').textContent()).toBe(firstText);
  await expect(page.getByTestId('option-o2')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('next-q').click();
  expect(await page.getByTestId('question-text').textContent()).toBe(secondText);
  await expect(page.getByTestId('option-o3')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('mark-review')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('next-q').click();
  await expect(page.getByTestId('option-o4')).toHaveAttribute('aria-checked', 'true');
  await expect(timer).toHaveText(/^(29|30):\d\d$/);

  // no animation: nothing running, no transition durations on the interactive parts
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  const dur = await page.evaluate(() => [...document.querySelectorAll('[data-testid="timer"], [data-testid^="option-"], footer button')].map((el) => getComputedStyle(el).transitionDuration + '|' + getComputedStyle(el).animationName));
  for (const d of dur) expect(d).toBe('0s|none');

  // saved answers really are on the server
  const attempt = await prisma.examAttempt.findFirstOrThrow({ where: { examId: exam.id, studentId: student.id }, include: { answers: true } });
  expect(attempt.answers).toHaveLength(3);
  expect(new Set(attempt.answers.map((a) => a.selectedOptionIds[0]))).toEqual(new Set(['o2', 'o3', 'o4']));
});
