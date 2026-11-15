import { test, expect } from '@playwright/test';
import { makeOffering, makeSection, makeUser, prisma, signIn } from './sch-kit';

test.afterAll(() => prisma.$disconnect());

test('[SCH-16] student who moved: attendance card lists only current courses; 360 px has no side scroll, no console errors, 44 px targets', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const teacher = await makeUser('teacher');
  const student = await makeUser('student', sectionId, 'Moved Student');
  const current = await makeOffering(sectionId, teacher.id, [student.id]);
  const old = await makeOffering(sectionId, teacher.id, [student.id]);
  await prisma.enrollment.updateMany({ where: { courseOfferingId: old.offering.id, studentId: student.id }, data: { status: 'ended', endedAt: new Date() } });

  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(context, baseURL!, student);
  await page.goto('/student/attendance');
  await expect(page.getByTestId(`course-${current.course.code}`)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId(`course-${old.course.code}`)).toHaveCount(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('main a, main button, main [role=button]')]
      .map((e) => ({ r: e.getBoundingClientRect(), t: (e.innerText || e.getAttribute('aria-label') || e.tagName).slice(0, 30) }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && r.height < 44)
      .map(({ t, r }) => `${t} (${Math.round(r.height)}px)`));
  expect(small, 'tap targets under 44 px').toEqual([]);
  expect(errors).toEqual([]);
});
