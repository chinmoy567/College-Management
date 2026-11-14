import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { createSession } from '../apps/api/src/modules/auth/sessions';

/**
 * Needs the app running against a migrated Postgres (DATABASE_URL points at the same database the server uses).
 * It signs in by creating a session row for a fresh Admin, the same shortcut the integration tests use.
 */
const prisma = new PrismaClient();
test.afterAll(() => prisma.$disconnect());

test('[ACAD-15] add student at 360 px, slip, new section when full', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const admin = await prisma.user.create({
    data: { role: 'admin', email: `e2e-${randomUUID()}@x.test`, passwordHash: 'x', mustChangePassword: false, totpEnabledAt: new Date(), firstLogin: false },
  });
  const { token } = await createSession(admin, { stepUpPending: false });
  const cookie = { name: process.env.SESSION_COOKIE_NAME ?? 'cms_session', value: token, url: baseURL! };
  await context.addCookies([cookie]);

  // A fresh session whose Science Class 11 Section A already holds 30 students.
  const n = 1000 + Math.floor(Math.random() * 8000);
  const created = await request.post('/api/academics/sessions', {
    headers: { 'X-Requested-With': 'cms', Cookie: `${cookie.name}=${token}` },
    data: { name: `${n}–${String(n % 100).padStart(2, '0')}` },
  });
  expect(created.status()).toBe(201);
  const body = (await created.json()) as { id: string; name: string; groups: { id: string; type: string; sections: { id: string }[] }[] };
  const science = body.groups.find((g) => g.type === 'science')!;
  for (let i = 0; i < 30; i++) {
    await prisma.user.create({
      data: {
        role: 'student', loginId: `e2e${n}x${i}`, email: `e2e${n}x${i}@x.test`, passwordHash: 'x', firstLogin: false, mustChangePassword: false,
        student: { create: { name: `Filler ${i}`, roll: String(i + 1), sectionId: science.sections[0]!.id } },
      },
    });
  }

  await page.goto('/admin/students/new');
  await expect(page.getByRole('heading', { name: 'Add student' })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Session').selectOption({ label: body.name });
  await page.getByLabel('Group').selectOption({ label: 'Science' });

  // All sections full: inline create-new-section card.
  await expect(page.getByTestId('all-full')).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^Section/ })).toContainText('0 free');
  await page.getByRole('button', { name: 'Create new section' }).click();
  await expect(page.getByRole('combobox', { name: /^Section/ })).toContainText('Section B (30 free)');
  await expect(page.getByTestId('all-full')).toBeHidden();

  await page.getByLabel('Full name').fill('Rahim Uddin');
  await page.getByLabel('Roll number').fill('31');
  await page.getByLabel('Email').fill(`rahim-${n}@x.test`);
  expect(await page.getByLabel('Roll number').getAttribute('inputmode')).toBe('numeric');
  await page.getByRole('button', { name: 'Create student' }).click();

  // Credential slip shown once with login ID and plain password.
  const slip = page.getByRole('dialog', { name: 'Credential slip' });
  await expect(slip).toBeVisible();
  await expect(page.getByTestId('slip-login')).not.toBeEmpty();
  expect((await page.getByTestId('slip-password').textContent())!.length).toBeGreaterThanOrEqual(8);
  await expect(slip).toContainText('Section B');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const btn = await page.getByRole('button', { name: 'Print slip' }).boundingBox();
  expect(btn!.height).toBeGreaterThanOrEqual(44);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(slip).toBeHidden();
  await expect(page.getByTestId('slip-password')).toHaveCount(0); // never shown again

  await prisma.loginSession.deleteMany({ where: { userId: admin.id } });
});
