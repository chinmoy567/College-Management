import { test, expect } from '@playwright/test';
import { makeOffering, makeSection, makeUser, prisma, signIn, today } from './sch-kit';
import { dateOnly, timeDate } from '../apps/api/src/modules/schedule/generate';

test.afterAll(async () => {
  await prisma.$disconnect();
});

const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

test('[SCH-25] student routine marks cancelled, moved, extra and substitute classes (Full week table and This week list) at 360 px', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  const admin = await makeUser('admin');
  const adminToken = await signIn(context, baseURL!, admin);
  const sectionId = await makeSection(request, adminToken);
  const teacher = await makeUser('teacher', undefined, 'Regular Teacher');
  const stand = await makeUser('teacher', undefined, 'Stand In');
  const student = await makeUser('student', sectionId, 'Overlay Student');
  const o = await makeOffering(sectionId, teacher.id, [student.id]);

  const sunday = addDays(today(), -new Date(`${today()}T00:00:00Z`).getUTCDay());
  const tag = Date.now();
  const p1 = await prisma.period.create({ data: { name: `O1 ${tag}`, startTime: timeDate('20:00'), endTime: timeDate('20:45') } });
  const p2 = await prisma.period.create({ data: { name: `O2 ${tag}`, startTime: timeDate('21:00'), endTime: timeDate('21:45') } });
  const slot = (day: 'mon' | 'tue' | 'thu', periodId: string) =>
    prisma.routineSlot.create({ data: { day, periodId, offerings: { create: [{ courseOfferingId: o.offering.id }] } } });
  const mon = await slot('mon', p1.id); // cancelled
  const tue = await slot('tue', p1.id); // moved to wed
  const thu = await slot('thu', p2.id); // substitute
  const meeting = (date: string, extra: Record<string, unknown>) =>
    prisma.classMeeting.create({
      data: { date: dateOnly(date), startTime: timeDate('20:00'), endTime: timeDate('20:45'), teacherId: teacher.id, offerings: { create: [{ courseOfferingId: o.offering.id }] }, ...extra },
    });
  await meeting(addDays(sunday, 1), { routineSlotId: mon.id, periodId: p1.id, status: 'cancelled' });
  await meeting(addDays(sunday, 3), { routineSlotId: tue.id, periodId: p1.id, originalDate: dateOnly(addDays(sunday, 2)), manuallyEdited: true });
  await meeting(addDays(sunday, 4), { routineSlotId: thu.id, periodId: p2.id, startTime: timeDate('21:00'), endTime: timeDate('21:45'), substituteTeacherId: stand.id });
  await meeting(addDays(sunday, 0), { periodId: p2.id, startTime: timeDate('21:00'), endTime: timeDate('21:45') }); // extra, Sunday

  await signIn(context, baseURL!, student);
  await page.goto('/student/routine');
  const grid = page.getByTestId('week-grid');
  await expect(grid).toBeVisible({ timeout: 60_000 });

  await expect(grid.locator('[data-state="cancelled"]')).toHaveCount(1);
  await expect(grid.locator('[data-state="cancelled"]')).toContainText('Cancelled');
  await expect(grid.locator('[data-state="moved"]')).toContainText(`Moved to ${addDays(sunday, 3)}`);
  await expect(grid.locator('[data-state="moved-in"]')).toContainText(`Moved from ${addDays(sunday, 2)}`);
  await expect(grid.locator('[data-state="extra"]')).toContainText('Extra class');
  await expect(grid.locator('[data-state="normal"]')).toContainText('Substitute: Stand In');
  await expect(grid.getByTestId('week-cell')).toHaveCount(5);

  // The This week list shows the same changes.
  const list = page.getByRole('region', { name: 'Week', exact: true });
  await expect(list.getByText('Cancelled')).toHaveCount(1);
  await expect(list.getByText('Extra class')).toHaveCount(1);
  await expect(list.getByText('Substitute: Stand In')).toHaveCount(1);

  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});
