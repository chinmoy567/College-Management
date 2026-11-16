import { test, expect } from '@playwright/test';
import { makeOffering, makeSection, makeUser, prisma, signIn } from './sch-kit';
import { timeDate } from '../apps/api/src/modules/schedule/generate';

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('[SCH-23] student Full week routine table shows the teacher name in each cell at 360 px', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  const admin = await makeUser('admin');
  const adminToken = await signIn(context, baseURL!, admin);
  const sectionId = await makeSection(request, adminToken);
  const teacher = await makeUser('teacher', undefined, 'Named Teacher');
  const student = await makeUser('student', sectionId, 'Teacher Name Student');
  const mine = await makeOffering(sectionId, teacher.id, [student.id]);
  const period = await prisma.period.create({ data: { name: `T ${Date.now()}`, startTime: timeDate('21:00'), endTime: timeDate('21:45') } });
  await prisma.routineSlot.create({ data: { day: 'mon', periodId: period.id, offerings: { create: [{ courseOfferingId: mine.offering.id }] } } });

  await signIn(context, baseURL!, student);
  await page.goto('/student/routine');
  const grid = page.getByTestId('week-grid');
  await expect(grid).toBeVisible({ timeout: 60_000 });
  const cell = grid.getByTestId('week-cell');
  await expect(cell).toHaveCount(1);
  await expect(cell.getByTestId('week-teacher')).toHaveText('Named Teacher');
  await expect(cell).toContainText(mine.course.code);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});
