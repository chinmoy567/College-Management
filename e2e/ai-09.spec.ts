import { test, expect } from '@playwright/test';
import { makeSection, makeUser, prisma, signIn } from './sch-kit';

test.afterAll(() => prisma.$disconnect());

test('[AI-09] the answer streams in, math renders, the disclaimer stays visible, past chats open and delete', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  test.setTimeout(240_000);
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const student = await makeUser('student', sectionId, 'Asker Asif');
  await signIn(context, baseURL!, student);

  await page.goto('/student/ai');
  await expect(page.getByTestId('ai-disclaimer')).toContainText('AI may make mistakes, verify with your teacher.', { timeout: 120_000 });
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page).toHaveURL(/\/student\/ai\/c[a-z0-9]+$/, { timeout: 60_000 });
  await expect(page.getByTestId('ai-disclaimer')).toBeVisible();
  const chatUrl = page.url();

  await page.getByLabel('Your question').fill('What is the energy formula?');
  await page.getByRole('button', { name: 'Send' }).click();
  // streaming: the first words show up while the end of the answer has not arrived yet
  await expect(page.getByText('Here is the')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Step two')).toHaveCount(0);
  await expect(page.getByText('Step two')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.getByTestId('msg-ai')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await expect(page.getByTestId('ai-usage')).toContainText('1 of 20');

  // reload: the saved chat is still there, math included
  await page.goto(chatUrl);
  await expect(page.getByText('What is the energy formula?')).toBeVisible();
  await expect(page.locator('.katex').first()).toBeVisible();

  await page.goto('/student/ai');
  await expect(page.getByText('What is the energy formula?')).toBeVisible();
  await page.getByRole('button', { name: /Delete chat/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No chats yet')).toBeVisible({ timeout: 30_000 });
  expect(await prisma.aIConversation.count({ where: { studentId: student.id } })).toBe(0);
});
