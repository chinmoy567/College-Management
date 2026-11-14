import { test, expect } from '@playwright/test';
import { makeSection, makeUser, prisma, signIn } from './sch-kit';

test.afterAll(() => prisma.$disconnect());

test('[CHAT-16] an urgent notice shows a dashboard banner until read; Notices filters Central / My Classes with unread markers', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  test.setTimeout(150_000);
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const teacher = await makeUser('teacher', undefined, 'Teacher Tina');
  const student = await makeUser('student', sectionId, 'Notice Reader');
  const publish = async (authorId: string, scope: 'central' | 'class', title: string, priority: 'normal' | 'urgent') => {
    const n = await prisma.notice.create({ data: { authorId, scope, audience: {}, title, bodyHtml: `<p>${title} body</p>`, priority, publishedAt: new Date() } });
    await prisma.noticeRecipient.create({ data: { noticeId: n.id, userId: student.id } });
    return n;
  };
  const urgent = await publish(admin.id, 'central', 'Campus closed tomorrow', 'urgent');
  await publish(teacher.id, 'class', 'Bring your calculator', 'normal');
  await signIn(context, baseURL!, student);

  await page.goto('/student/routine');
  const banner = page.getByTestId('urgent-banner');
  await expect(banner).toContainText('Campus closed tomorrow', { timeout: 60_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  await banner.getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Notices' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('notice')).toHaveCount(2);
  await expect(page.getByTestId('unread-dot')).toHaveCount(2);

  await page.getByRole('tab', { name: 'Central' }).click();
  await expect(page.getByTestId('notice')).toHaveCount(1);
  await expect(page.getByTestId('notice')).toContainText('Campus closed tomorrow');
  await page.getByRole('tab', { name: 'My Classes' }).click();
  await expect(page.getByTestId('notice')).toHaveCount(1);
  await expect(page.getByTestId('notice')).toContainText('Bring your calculator');

  // Reading the urgent notice removes the banner.
  await page.getByRole('tab', { name: 'Central' }).click();
  await page.getByRole('button', { name: 'Mark as read' }).click();
  await expect(page.getByTestId('unread-dot')).toHaveCount(0, { timeout: 20_000 });
  expect(await prisma.noticeRead.count({ where: { noticeId: urgent.id, userId: student.id } })).toBe(1);
  await page.goto('/student/routine');
  await expect(page.getByRole('link', { name: /Notifications/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('urgent-banner')).toHaveCount(0);
});
