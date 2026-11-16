import { test, expect } from '@playwright/test';
import { makeOffering, makeSection, makeUser, prisma, signIn } from './sch-kit';
import { timeDate } from '../apps/api/src/modules/schedule/generate';

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('[SCH-26] teacher routine shows the recurring Full week routine table (own classes, section, room) at 360 px', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  const admin = await makeUser('admin');
  const adminToken = await signIn(context, baseURL!, admin);
  const sectionId = await makeSection(request, adminToken);
  const me = await makeUser('teacher', undefined, 'Pattern Teacher');
  const other = await makeUser('teacher', undefined, 'Other Pattern');
  const mine = await makeOffering(sectionId, me.id, []);
  const theirs = await makeOffering(sectionId, other.id, []);
  const tag = Date.now();
  const p1 = await prisma.period.create({ data: { name: `P1 ${tag}`, startTime: timeDate('19:00'), endTime: timeDate('19:45') } });
  const p2 = await prisma.period.create({ data: { name: `P2 ${tag}`, startTime: timeDate('19:50'), endTime: timeDate('20:35') } });
  const mk = (day: 'sun' | 'tue' | 'thu' | 'mon', periodId: string, offeringId: string) =>
    prisma.routineSlot.create({ data: { day, periodId, offerings: { create: [{ courseOfferingId: offeringId }] } } });
  await mk('sun', p1.id, mine.offering.id);
  await mk('tue', p1.id, mine.offering.id);
  await mk('thu', p2.id, mine.offering.id);
  await mk('mon', p2.id, theirs.offering.id); // not this teacher's

  await signIn(context, baseURL!, me);
  await page.goto('/teacher/routine');
  const section = page.getByRole('region', { name: 'Full week routine' });
  await expect(section.getByRole('heading', { name: 'Full week routine (every week)' })).toBeVisible({ timeout: 60_000 });
  const grid = section.getByTestId('pattern-grid');
  await expect(grid).toBeVisible();
  await expect(grid.getByTestId('pattern-cell')).toHaveCount(3);
  await expect(grid.getByTestId('pattern-cell').filter({ hasText: theirs.course.code })).toHaveCount(0);
  await expect(grid.getByTestId('pattern-cell').first()).toContainText('Class');
  await expect(grid.getByRole('rowheader')).toHaveCount(2);

  // Existing week view is still there.
  await expect(page.getByRole('button', { name: 'Previous week' })).toBeVisible();

  expect(await grid.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});
