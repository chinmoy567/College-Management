import { test, expect } from '@playwright/test';
import { makeSection, makeUser, prisma, signIn } from './sch-kit';

test.afterAll(() => prisma.$disconnect());

test('[CHAT-18] at 360 px the People page finds a classmate by section and name, and Message opens the chat', async ({ browser, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  test.setTimeout(150_000);
  const setup = await browser.newContext();
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(setup, baseURL!, admin));
  await setup.close();
  const alice = await makeUser('student', sectionId, 'Alice Finder');
  await makeUser('student', sectionId, 'Zubair Findme');

  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await signIn(ctx, baseURL!, alice);
  await page.goto('/people');
  await expect(page.getByRole('heading', { name: 'Find people' })).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const section = await prisma.section.findUniqueOrThrow({ where: { id: sectionId }, select: { group: { select: { sessionId: true } } } });
  await page.locator('select').nth(1).selectOption(section.group.sessionId);
  await page.locator('select').nth(3).selectOption(sectionId);
  await page.getByPlaceholder('Search by name').fill('Zubair');
  const row = page.getByTestId('person').filter({ hasText: 'Zubair Findme' });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('person').filter({ hasText: 'Alice Finder' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Message' }).click();
  await expect(page).toHaveURL(/\/messages\/.+/, { timeout: 15_000 });
  await ctx.close();
});
