import { test, expect } from '@playwright/test';
import { COOKIE, makeOffering, makeSection, makeUser, prisma, signIn, today } from './sch-kit';

test.afterAll(async () => {
  await prisma.holiday.deleteMany({ where: { title: 'Founders Day' } }); // holidays are global; do not leak into other tests
  await prisma.$disconnect();
});

test('[SCH-17] admin adds holiday + extra class, student routine shows them', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const admin = await makeUser('admin');
  const adminToken = await signIn(context, baseURL!, admin);
  const sectionId = await makeSection(request, adminToken);
  const teacher = await makeUser('teacher');
  const student = await makeUser('student', sectionId, 'Routine Student');
  const { course } = await makeOffering(sectionId, teacher.id, [student.id]);
  const p = await request.post('/api/schedule/periods', {
    headers: { 'X-Requested-With': 'cms', Cookie: `${COOKIE}=${adminToken}` },
    data: { name: `E2E ${Date.now()}`, startTime: '23:00', endTime: '23:45' },
  });
  expect(p.status()).toBe(201);
  const period = (await p.json()) as { name: string };

  await page.goto('/admin/schedule');
  await expect(page.getByTestId('day-panel')).toContainText(today(), { timeout: 60_000 });

  // Extra class on today.
  await page.getByRole('button', { name: 'Add extra class' }).click();
  const extra = page.getByRole('dialog', { name: 'Add extra class' });
  const optionLabel = async (field: string, text: string) =>
    (await extra.getByLabel(field).locator('option', { hasText: text }).first().textContent())!;
  await expect(extra.getByLabel('Section').locator(`option[value="${sectionId}"]`)).toBeAttached();
  await extra.getByLabel('Section').selectOption({ value: sectionId });
  await expect(extra.getByLabel('Course').locator('option', { hasText: course.code })).toHaveCount(1);
  await extra.getByLabel('Course').selectOption({ label: await optionLabel('Course', course.code) });
  await extra.getByLabel('Period').selectOption({ label: await optionLabel('Period', period.name) });
  await extra.getByRole('button', { name: 'Save extra class' }).click();
  await expect(extra).toBeHidden();
  await expect(page.getByTestId('day-panel')).toContainText(course.code);
  await expect(page.getByTestId('day-panel')).toContainText('Extra');

  // Holiday on today.
  await page.getByRole('button', { name: 'Add holiday' }).click();
  const hol = page.getByRole('dialog', { name: 'Add holiday' });
  await hol.getByLabel('Title').fill('Founders Day');
  await hol.getByRole('button', { name: 'Save holiday' }).click();
  await expect(hol).toBeHidden();
  await expect(page.getByTestId('day-panel')).toContainText('Holiday: Founders Day');

  // The student's routine shows both.
  await signIn(context, baseURL!, student);
  await page.goto('/student/routine');
  await expect(page.getByTestId('today-holiday')).toContainText('Founders Day', { timeout: 60_000 });
  const cls = page.getByTestId('today-class');
  await expect(cls).toHaveCount(1);
  await expect(cls).toContainText(course.code);
  await expect(cls).toContainText('Extra class');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
