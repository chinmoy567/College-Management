import { test, expect } from '@playwright/test';
import { makeOffering, makeSection, makeUser, prisma, signIn } from './sch-kit';
import { routineClashes, seedRoutine } from '../prisma/seed-routine';

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('[SCH-DEMO-04] seeded demo routine: no room/teacher/section overlap; Admin Schedule Manager and student routine work at 360 px', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const noSideScroll = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  // Two sections that share three teachers, 10 courses each, then the demo routine seed.
  const admin = await makeUser('admin');
  const adminToken = await signIn(context, baseURL!, admin);
  const teachers = [await makeUser('teacher'), await makeUser('teacher'), await makeUser('teacher')];
  const SECTION = await makeSection(request, adminToken);
  const other = await makeSection(request, adminToken);
  const student = await makeUser('student', SECTION, 'Demo Routine Student');
  let n = 0;
  for (const sec of [SECTION, other])
    for (let c = 0; c < 10; c++) await makeOffering(sec, teachers[n++ % 3]!.id, sec === SECTION ? [student.id] : []);
  await seedRoutine(prisma, { sectionIds: [SECTION, other] });

  // The saved routine has no room, teacher or section clash.
  expect(await routineClashes(prisma, [SECTION, other])).toEqual([]);
  const slotCount = await prisma.routineSlot.count({ where: { deletedAt: null, offerings: { some: { courseOffering: { sectionId: SECTION } } } } });
  expect(slotCount).toBe(20);
  expect(await prisma.room.count({ where: { deletedAt: null, id: { startsWith: 'seed-room-' } } })).toBe(11);

  // Admin Schedule Manager: periods, rooms, one section's full routine.
  await page.goto('/admin/schedule');
  await page.getByTestId('tab-periods').click();
  for (let i = 1; i <= 8; i++) await expect(page.getByTestId('period-row').filter({ hasText: `Period ${i}` }).first()).toBeVisible({ timeout: 60_000 });
  await noSideScroll();

  await page.getByTestId('tab-rooms').click();
  await expect(page.getByTestId('room-row').filter({ hasText: 'Physics Lab' })).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId('room-row').filter({ hasText: 'Room 101' })).toHaveCount(1);
  await noSideScroll();

  await page.getByTestId('tab-routine').click();
  await expect(page.getByTestId('routine-section').locator(`option[value="${SECTION}"]`)).toBeAttached({ timeout: 60_000 });
  await page.getByTestId('routine-section').selectOption({ value: SECTION });
  await expect(page.getByTestId('routine-slot')).toHaveCount(slotCount, { timeout: 60_000 });
  await expect(page.getByTestId('routine-warnings')).toHaveCount(0);
  await expect(page.getByTestId('routine-list').getByRole('heading', { name: /^(Sunday|Monday|Tuesday|Wednesday|Thursday)$/ })).toHaveCount(5);
  await noSideScroll();

  // The student of that section sees the whole week.
  await signIn(context, baseURL!, student);
  await page.goto('/student/routine');
  const week = page.getByRole('region', { name: 'Week', exact: true });
  await expect(week.getByRole('heading', { level: 3 })).toHaveCount(5, { timeout: 60_000 });
  await expect(week.getByText(/Period \d/)).toHaveCount(slotCount);
  await noSideScroll();
  expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});
