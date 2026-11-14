import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { COOKIE, makeSection, makeUser, prisma, signIn } from './sch-kit';

test.afterAll(() => prisma.$disconnect());

test('[BOOK-05] browse, pay, the reader opens and the book is in My Books at 360 px', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  test.setTimeout(240_000);
  const admin = await makeUser('admin');
  const token = await signIn(context, baseURL!, admin);
  const sectionId = await makeSection(request, token);
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([300, 400]).drawText(`Page ${i + 1}`, { x: 40, y: 200 });
  const title = `E2E Physics ${Date.now().toString(36)}`;
  const created = await request.post('/api/books', {
    headers: { 'X-Requested-With': 'cms', Cookie: `${COOKIE}=${token}` },
    multipart: { title, author: 'E. Author', price: '150', previewPages: '', pdf: { name: 'b.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) } },
  });
  expect(created.status(), await created.text()).toBe(201);
  const student = await makeUser('student', sectionId, 'Reader Rina');
  await signIn(context, baseURL!, student);

  await page.goto('/student/books');
  const card = page.getByText(title);
  await expect(card).toBeVisible({ timeout: 120_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await card.click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('button', { name: /Pay .*150.* to unlock/ }).click();
  await expect(page.getByText('No money is taken')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();

  await expect(page).toHaveURL(/\/read$/, { timeout: 60_000 });
  await expect(page.getByTestId('pdf-page')).toHaveText('Page 1 of 3', { timeout: 90_000 });
  await page.getByTestId('pdf-reader').getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByTestId('pdf-page')).toHaveText('Page 2 of 3');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const box = await page.locator('canvas').first().boundingBox();
  expect(box!.width).toBeLessThanOrEqual(360);

  await page.goto('/student/my-books');
  await expect(page.getByText(title)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Unlocked')).toBeVisible();
  expect(await prisma.bookPurchase.count({ where: { studentId: student.id } })).toBe(1);
});
