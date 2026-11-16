import { test, expect } from '@playwright/test';
import { makeMeeting, makeOffering, makeSection, makeUser, prisma, signIn, today } from './sch-kit';

test.afterAll(async () => {
  await prisma.$disconnect();
});

const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const sundayOf = (s: string) => addDays(s, -new Date(`${s}T00:00:00Z`).getUTCDay());

test('[SCH-22] teacher routine: own classes with section/room/substitute, take-attendance links by date and status, 360 px', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  const admin = await makeUser('admin');
  const adminToken = await signIn(context, baseURL!, admin);
  const sectionId = await makeSection(request, adminToken);
  const me = await makeUser('teacher', undefined, 'Route Teacher');
  const other = await makeUser('teacher', undefined, 'Other Teacher');
  const mine = await makeOffering(sectionId, me.id, []);
  const theirs = await makeOffering(sectionId, other.id, []);

  const lastWeek = addDays(sundayOf(today()), -7);
  const nextWeek = addDays(sundayOf(today()), 7);
  const notTaken = await makeMeeting(mine.offering.id, me.id, { date: addDays(lastWeek, 3), start: '09:00', end: '09:45' }); // Wed
  const done = await makeMeeting(mine.offering.id, me.id, { date: addDays(lastWeek, 2), start: '09:00', end: '09:45', status: 'held' }); // Tue
  const cancelled = await makeMeeting(mine.offering.id, me.id, { date: addDays(lastWeek, 1), start: '09:00', end: '09:45' }); // Mon
  await prisma.classMeeting.update({ where: { id: cancelled.id }, data: { status: 'cancelled' } });
  const sub = await makeMeeting(theirs.offering.id, other.id, { date: addDays(lastWeek, 4), start: '10:00', end: '10:45' }); // Thu
  await prisma.classMeeting.update({ where: { id: sub.id }, data: { substituteTeacherId: me.id } });
  await makeMeeting(theirs.offering.id, other.id, { date: addDays(lastWeek, 0), start: '11:00', end: '11:45' }); // not mine, Sun
  await makeMeeting(mine.offering.id, me.id, { date: addDays(nextWeek, 3), start: '09:00', end: '09:45' }); // future

  await signIn(context, baseURL!, me);
  await page.goto('/teacher/routine');
  await expect(page.getByRole('heading', { name: 'Routine' })).toBeVisible({ timeout: 60_000 });

  // Today's class (only visible when today is Sun–Thu) has a Take attendance link.
  const dow = new Date(`${today()}T00:00:00Z`).getUTCDay();
  if (dow <= 4) {
    const t = await makeMeeting(mine.offering.id, me.id, { date: today(), start: '14:00', end: '14:45' });
    await page.reload();
    await expect(page.locator(`a[href="/teacher/attendance/${t.id}"]`)).toHaveText('Take attendance', { timeout: 30_000 });
  }

  // Previous week: past classes.
  await page.getByRole('button', { name: 'Previous week' }).click();
  const grid = page.getByTestId('teacher-grid');
  await expect(grid).toBeVisible({ timeout: 30_000 });
  await expect(grid.getByTestId('teacher-cell')).toHaveCount(4); // not taken, done, cancelled, substitute (not the other teacher's own)
  await expect(grid.locator(`a[href="/teacher/attendance/${notTaken.id}"]`)).toHaveText('Take attendance');
  await expect(grid.getByText('Attendance not taken')).toHaveCount(2); // notTaken + substitute meeting
  await expect(grid.locator(`a[href="/teacher/attendance/${done.id}"]`)).toHaveText('Edit attendance');
  await expect(grid.locator(`a[href="/teacher/attendance/${cancelled.id}"]`)).toHaveCount(0);
  await expect(grid.getByText('Cancelled')).toHaveCount(1);
  await expect(grid.getByText(`${mine.course.code}`).first()).toBeVisible();
  await expect(grid.getByText('for Other Teacher')).toHaveCount(1);
  await expect(grid.locator(`a[href="/teacher/attendance/${sub.id}"]`)).toHaveText('Take attendance');

  // Table scrolls inside its own box; the page never scrolls sideways.
  expect(await grid.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  // Two weeks forward: the future class has no button.
  await page.getByRole('button', { name: 'Next week' }).click();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(grid.getByTestId('teacher-cell')).toHaveCount(1);
  await expect(grid.getByText('Not yet')).toHaveCount(1);
  await expect(grid.getByTestId('take-attendance')).toHaveCount(0);

  expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});
