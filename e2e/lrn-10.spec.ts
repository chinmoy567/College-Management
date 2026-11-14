import { test, expect } from '@playwright/test';
import { makeOffering, makeSection, makeUser, prisma, signIn } from './sch-kit';

test.afterAll(() => prisma.$disconnect());

test('[LRN-10] a recording plays in the embedded player at 360 px and shows as watched; Join opens the meeting in a new tab', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  test.setTimeout(150_000);
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const teacher = await makeUser('teacher', undefined, 'Teacher Tara');
  const student = await makeUser('student', sectionId, 'Watcher Wasi');
  const { course, offering } = await makeOffering(sectionId, teacher.id, [student.id]);
  await prisma.recordedClass.create({
    data: {
      courseId: course.id, courseOfferingId: offering.id, title: 'Newton laws', videoSource: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ',
      videoId: 'dQw4w9WgXcQ', visibility: 'section', createdBy: teacher.id,
    },
  });
  const cls = await prisma.onlineClass.create({
    data: {
      teacherId: teacher.id, title: 'Revision live', startAt: new Date(Date.now() + 5 * 60_000), durationMin: 60, platform: 'meet',
      joinUrl: 'https://meet.google.com/abc-defg-hij', offerings: { create: [{ courseOfferingId: offering.id }] },
    },
  });
  await signIn(context, baseURL!, student);

  // External sites are stubbed so the test needs no internet.
  await context.route('https://www.youtube-nocookie.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>player</p>' }));
  await context.route('https://meet.google.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>meeting</p>' }));

  await page.goto('/student/recordings');
  await expect(page.getByText('Newton laws')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Watched')).toHaveCount(0);
  await page.getByText('Newton laws').click();
  const frame = page.locator('iframe[title="Newton laws"]');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  await expect(frame).toHaveAttribute('loading', 'lazy');
  const box = await frame.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await expect(page.getByText('Watched')).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByText('Watched')).toBeVisible({ timeout: 30_000 });

  await page.goto('/student/live');
  const card = page.getByTestId(`class-${cls.id}`);
  await expect(card.getByText('Revision live')).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const popupPromise = context.waitForEvent('page');
  await card.getByRole('button', { name: 'Join class' }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url()).toContain('meet.google.com');
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  expect(page.url()).toContain('/student/live');
  expect(await prisma.onlineClassJoin.count({ where: { onlineClassId: cls.id, studentId: student.id } })).toBe(1);
});
