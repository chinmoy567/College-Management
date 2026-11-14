import { test, expect } from '@playwright/test';
import { hashPassword } from '../apps/api/src/lib/crypto';
import { makeSection, makeUser, prisma, signIn } from './sch-kit';

test.afterAll(() => prisma.$disconnect());

const noOverflow = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('[FE-03] landing shows every public section and the three role buttons; a signed-in user sees Open my dashboard', async ({ page, context, request, baseURL }) => {
  await page.goto('/');
  for (const h of ['About', 'Departments', 'Latest notices', 'Book Shop', 'Contact'])
    await expect(page.getByRole('heading', { name: h })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Student Login' })).toHaveAttribute('href', '/login?role=student');
  await expect(page.getByRole('link', { name: 'Teacher Login' })).toHaveAttribute('href', '/login?role=teacher');
  await expect(page.getByRole('link', { name: 'Admin Login' })).toHaveAttribute('href', '/login?role=admin');
  await expect(page.getByRole('link', { name: 'Open my dashboard' })).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);
  // Public data only: no private fields in the public API responses.
  const body = JSON.stringify(await (await request.get('/api/public/college')).json());
  expect(body).not.toMatch(/passwordHash|email|mobile/i);

  const admin = await makeUser('admin');
  await signIn(context, baseURL!, admin);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Open my dashboard' })).toHaveAttribute('href', '/admin');
  await expect(page.getByRole('link', { name: 'Student Login' })).toHaveCount(0);
});

test('[FE-04] each role gets its own tab bar on phones and a sidebar on lg; the bell shows the unread count', async ({ page, context, request, baseURL }) => {
  const phone = test.info().project.name === 'phone';
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const teacher = await makeUser('teacher');
  const student = await makeUser('student', sectionId, 'Tab Student');
  for (const [role, user, label] of [['student', student, 'Courses'], ['teacher', teacher, 'Today'], ['admin', admin, 'Schedule']] as const) {
    await signIn(context, baseURL!, user);
    await page.goto(`/${role}`);
    const nav = page.getByRole('navigation', { name: `${role} ${phone ? 'tabs' : 'sidebar'}` });
    await expect(nav).toBeVisible({ timeout: 60_000 });
    await expect(nav.getByRole('link', { name: new RegExp(label) })).toBeVisible();
    if (phone) await expect(page.getByRole('button', { name: /More/ })).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
  }
  await prisma.notification.create({ data: { userId: student.id, type: 'notice', text: 'Hi' } });
  await signIn(context, baseURL!, student);
  await page.goto('/student');
  await expect(page.getByTestId('bell-count')).toHaveText('1', { timeout: 60_000 });
});

test('[FE-07] 401 goes to /login and a first-login account goes to /complete-profile', async ({ page, context, request, baseURL }) => {
  await context.clearCookies();
  await page.goto('/student');
  await expect(page).toHaveURL(/\/login/, { timeout: 60_000 });

  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const student = await makeUser('student', sectionId, 'First Login');
  await prisma.user.update({ where: { id: student.id }, data: { firstLogin: true } });
  await signIn(context, baseURL!, student);
  await page.goto('/student');
  await expect(page).toHaveURL(/\/complete-profile/, { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
});

test('login form signs a student in and lands on the dashboard; a wrong password shows a generic error', async ({ page, context, request, baseURL }) => {
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const student = await makeUser('student', sectionId, 'Form Student');
  const loginId = student.loginId!;
  await prisma.user.update({ where: { id: student.id }, data: { passwordHash: await hashPassword('Correct-Horse-9') } });
  await context.clearCookies();

  await page.goto('/login?role=student');
  await page.getByLabel('User ID or Email').fill(loginId);
  await page.getByLabel('Password').fill('wrong-pass-1');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('Wrong ID or password.')).toContainText('Wrong ID or password');
  await page.getByLabel('Password').fill('Correct-Horse-9');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/student$/, { timeout: 60_000 });
});
