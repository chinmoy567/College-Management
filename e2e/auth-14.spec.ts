import { test, expect, type Page } from '@playwright/test';
import { hashPassword } from '../apps/api/src/lib/crypto';
import { makeSection, makeUser, prisma, signIn } from './sch-kit';

test.afterAll(() => prisma.$disconnect());
const PW = 'Pa55word!x9';

async function login(page: Page, identifier: string, role?: string) {
  await page.goto(role ? `/login?role=${role}` : '/login');
  await page.getByLabel('User ID or Email').fill(identifier);
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Log in' }).click();
}

test('[AUTH-14] login form at 360 px: role label, role mismatch notice, first-login redirects', async ({ page, context, request, baseURL }) => {
  const passwordHash = await hashPassword(PW);
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  await context.clearCookies();

  // Role buttons pre-select the label.
  await page.goto('/login?role=teacher');
  await expect(page.getByRole('heading', { name: 'Teacher login' })).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  // Role mismatch: a student using the Teacher button gets the notice and lands on the student dashboard.
  const student = await makeUser('student', sectionId, 'Mismatch Student');
  await prisma.user.update({ where: { id: student.id }, data: { passwordHash, firstLogin: false, mustChangePassword: false } });
  await login(page, student.loginId!, 'teacher');
  await expect(page.getByRole('status')).toContainText('You signed in as a Student');
  await expect(page).toHaveURL(/\/student/, { timeout: 30_000 });

  // Admin first login is sent to change the seed password.
  await context.clearCookies();
  await prisma.user.update({ where: { id: admin.id }, data: { passwordHash, mustChangePassword: true } });
  await login(page, admin.email!, 'admin');
  await expect(page).toHaveURL(/\/admin\/setup/, { timeout: 30_000 });

  // Teacher first login goes to Complete Your Profile.
  await context.clearCookies();
  const teacher = await makeUser('teacher');
  await prisma.user.update({ where: { id: teacher.id }, data: { passwordHash, firstLogin: true, mustChangePassword: false } });
  await login(page, teacher.loginId!, 'teacher');
  await expect(page).toHaveURL(/\/complete-profile/, { timeout: 30_000 });
});
