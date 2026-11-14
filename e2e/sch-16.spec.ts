import { test, expect } from '@playwright/test';
import type { AttendanceStatus } from '@prisma/client';
import { makeOffering, makeSection, makeUser, markHeld, otherDayThisMonth, prisma, signIn } from './sch-kit';

test.afterAll(() => prisma.$disconnect());

test('[SCH-16] student attendance card colours + calendar', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const teacher = await makeUser('teacher');
  const student = await makeUser('student', sectionId, 'Card Student');
  // A: 4/4 = 100% green, B: 2/3 = 66.7% orange, C: 1/2 = 50% red. Overall 7/9 = 77.8% green.
  const plan: Record<string, AttendanceStatus[]> = {
    A: ['present', 'present', 'late', 'present'],
    B: ['present', 'absent', 'present'],
    C: ['present', 'absent'],
  };
  const codes: Record<string, string> = {};
  for (const [key, statuses] of Object.entries(plan)) {
    const { course, offering } = await makeOffering(sectionId, teacher.id, [student.id]);
    codes[key] = course.code;
    await markHeld(offering.id, sectionId, teacher.id, student.id, statuses);
  }
  await signIn(context, baseURL!, student);

  await page.goto('/student/attendance');
  await expect(page.getByTestId('overall-pct')).toHaveText('77.8%', { timeout: 60_000 });
  await expect(page.getByTestId('overall-pct')).toHaveAttribute('data-colour', 'green');
  const pct = (k: string) => page.getByTestId(`course-${codes[k]}`).getByTestId('course-pct');
  await expect(pct('A')).toHaveText('100%');
  await expect(pct('A')).toHaveAttribute('data-colour', 'green');
  await expect(pct('B')).toHaveText('66.7%');
  await expect(pct('B')).toHaveAttribute('data-colour', 'orange');
  await expect(pct('C')).toHaveText('50%');
  await expect(pct('C')).toHaveAttribute('data-colour', 'red');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  // Calendar: the day has 2 absences out of 9 periods, so it is coloured partial; tapping lists the periods.
  const day = page.getByTestId(`day-${otherDayThisMonth()}`);
  await expect(day).toHaveAttribute('data-colour', 'partial');
  expect((await day.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await day.click();
  const detail = page.getByTestId('day-detail');
  await expect(detail.locator('li')).toHaveCount(9);
  await expect(detail).toContainText(codes.B!);
  await expect(detail).toContainText('absent');
});
