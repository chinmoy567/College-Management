import { test, expect } from '@playwright/test';
import { makeExam, makeResult, prisma } from './exam-kit';
import { makeOffering, makeSection, makeUser, signIn } from './sch-kit';

test.afterAll(() => prisma.$disconnect());

const dhakaLocal = (offsetMin: number) => new Date(Date.now() + offsetMin * 60_000 + 6 * 3_600_000).toISOString().slice(0, 16);

test('[EXAM-UI] teacher builds an exam, adds an inline question, publishes, then reads the report', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const teacher = await makeUser('teacher');
  const student = await makeUser('student', sectionId, 'Report Student');
  const { course, offering } = await makeOffering(sectionId, teacher.id, [student.id]);
  await signIn(context, baseURL!, teacher);

  await page.goto('/teacher/exams');
  await page.getByTestId(`offering-${course.code}`).click({ timeout: 60_000 });
  await page.getByTestId('new-exam').click();
  await page.getByLabel('Title').fill('Builder exam');
  await page.getByLabel('Opens (Dhaka time)').fill(dhakaLocal(60));
  await page.getByLabel('Closes (Dhaka time)').fill(dhakaLocal(180));
  // settings and the question are on the same screen
  await page.getByTestId('q-text').fill('What is 2 + 2?');
  await page.getByTestId('q-option-0').fill('3');
  await page.getByTestId('q-option-1').fill('4');
  await page.getByRole('radio', { name: 'Option 2 is correct' }).click();
  await page.getByRole('button', { name: 'Add question' }).click();
  await expect(page.getByTestId('new-question-1')).toContainText('What is 2 + 2?');
  await page.getByTestId('save-exam').click();
  await expect(page.getByRole('heading', { name: 'Builder exam' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('offering-label')).toContainText(/Class \d+ · Section /); // the class is named under the title
  await expect(page.getByTestId('question-1')).toContainText('What is 2 + 2?', { timeout: 30_000 });
  await expect(page.getByTestId('question-1')).toContainText('✓ 4');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  // the question is now in the bank and can be picked for another exam
  await page.getByTestId('publish-exam').click();
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  expect(await prisma.exam.count({ where: { courseOfferingId: offering.id, status: 'published' } })).toBe(1);

  // report of a finished exam with one result
  const done = await makeExam(offering.id, teacher.id, [{ text: 'Q1' }, { text: 'Q2' }], { status: 'closed', revealed: true, resultsPublished: true, startOffsetMin: -3000, endOffsetMin: -2000, title: 'Old exam' });
  await makeResult(done.exam.id, student.id, sectionId, [true, false]);
  await page.goto(`/teacher/exams/${done.exam.id}/report`);
  await expect(page.getByTestId('offering-label')).toContainText(/Class \d+ · Section /, { timeout: 30_000 });
  await expect(page.getByTestId('summary')).toContainText('1/1', { timeout: 30_000 });
  await expect(page.getByTestId('summary')).toContainText('Highest');
  await expect(page.getByRole('button', { name: 'Reopen with extra time' })).toBeVisible();
});
