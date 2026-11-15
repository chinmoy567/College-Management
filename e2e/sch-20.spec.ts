import { test, expect } from '@playwright/test';
import { makeOffering, makeSection, makeUser, prisma, signIn } from './sch-kit';
import { timeDate } from '../apps/api/src/modules/schedule/generate';

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('[SCH-20] student routine shows a Full week routine table (5 day columns, own classes) at 360 px without page scroll', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  const admin = await makeUser('admin');
  const adminToken = await signIn(context, baseURL!, admin);
  const sectionId = await makeSection(request, adminToken);
  const teacher = await makeUser('teacher');
  const student = await makeUser('student', sectionId, 'Grid Student');
  const mine = await makeOffering(sectionId, teacher.id, [student.id]);
  const notMine = await makeOffering(sectionId, teacher.id, []); // optional course the student is not enrolled in

  const tag = Date.now();
  const p1 = await prisma.period.create({ data: { name: `G1 ${tag}`, startTime: timeDate('22:00'), endTime: timeDate('22:45') } });
  const p2 = await prisma.period.create({ data: { name: `G2 ${tag}`, startTime: timeDate('23:00'), endTime: timeDate('23:45') } });
  const mk = (day: 'sun' | 'tue' | 'thu', periodId: string, offeringId: string) =>
    prisma.routineSlot.create({ data: { day, periodId, offerings: { create: [{ courseOfferingId: offeringId }] } } });
  await mk('sun', p1.id, mine.offering.id);
  await mk('tue', p1.id, mine.offering.id);
  await mk('thu', p2.id, mine.offering.id);
  await mk('mon', p2.id, notMine.offering.id);

  await signIn(context, baseURL!, student);
  await page.goto('/student/routine');
  const grid = page.getByTestId('week-grid');
  await expect(grid).toBeVisible({ timeout: 60_000 });

  await expect(grid.getByTestId('week-day')).toHaveCount(5);
  await expect(grid.getByTestId('week-cell')).toHaveCount(3);
  await expect(grid.getByTestId('week-cell').filter({ hasText: notMine.course.code })).toHaveCount(0);
  await expect(grid.getByRole('rowheader')).toHaveCount(2);

  // Existing sections are untouched.
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Full week routine' })).toBeVisible();

  // The table scrolls inside its own box; the page does not.
  expect(await grid.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});
