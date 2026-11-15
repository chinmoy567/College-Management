import { test, expect } from '@playwright/test';
import { makeOffering, makeSection, makeUser, prisma, signIn } from './sch-kit';

// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('[SCH-19] admin builds a section routine, uploads a routine file; student sees both at 360 px', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  const admin = await makeUser('admin');
  const adminToken = await signIn(context, baseURL!, admin);
  const sectionId = await makeSection(request, adminToken);
  const teacher = await makeUser('teacher');
  const student = await makeUser('student', sectionId, 'Routine Student');
  const { course } = await makeOffering(sectionId, teacher.id, [student.id]);
  const periodName = `E2E ${Date.now()}`;

  // Periods tab: add a period through the UI.
  await page.goto('/admin/schedule');
  await page.getByTestId('tab-periods').click();
  await page.getByRole('button', { name: 'Add period' }).click();
  const pd = page.getByRole('dialog', { name: 'Add period' });
  await pd.getByLabel('Name').fill(periodName);
  await pd.getByLabel('Starts').fill('22:00');
  await pd.getByLabel('Ends').fill('22:45');
  await pd.getByRole('button', { name: 'Add period' }).click();
  await expect(pd).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId('period-row').filter({ hasText: periodName })).toHaveCount(1);

  // Routine tab: choose the section and add a class.
  await page.getByTestId('tab-routine').click();
  await expect(page.getByTestId('routine-section').locator(`option[value="${sectionId}"]`)).toBeAttached({ timeout: 60_000 });
  await page.getByTestId('routine-section').selectOption({ value: sectionId });
  await page.getByRole('button', { name: 'Add class' }).click();
  const slot = page.getByRole('dialog', { name: 'Add class' });
  await slot.getByLabel('Day').selectOption('sun');
  await slot.getByLabel('Period').selectOption({ label: `${periodName} (22:00–22:45)` });
  await slot.getByLabel(new RegExp(course.code)).check();
  await slot.getByRole('button', { name: 'Add to routine' }).click();
  await expect(slot).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId('routine-slot').filter({ hasText: course.code })).toHaveCount(1);

  // Upload a routine image.
  await page.getByTestId('routine-file').setInputFiles({ name: 'routine.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('routine-upload')).toContainText('routine.png', { timeout: 30_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  // The student sees the class and the file.
  await signIn(context, baseURL!, student);
  await page.goto('/student/routine');
  await expect(page.getByText(course.code).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('routine-file')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});
