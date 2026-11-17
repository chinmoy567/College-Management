import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { createSession } from '../apps/api/src/modules/auth/sessions';
import { chatMembership } from '../apps/api/src/lib/chatMembership';

/** Needs the app running against the test database (see playwright.config.ts). Signs in through session rows, like the other specs. */
const prisma = new PrismaClient();
test.afterAll(() => prisma.$disconnect());

const teacher = (tag: string) =>
  prisma.user.create({
    data: {
      role: 'teacher', loginId: `e2e${tag}${randomUUID().slice(0, 6)}`, email: `e2e-${randomUUID()}@x.test`, passwordHash: 'x', firstLogin: false, mustChangePassword: false,
      teacher: { create: { name: tag === 'm' ? 'Mona Mentor' : 'Plain Teacher', subjects: [] } },
    },
  });

test('[ACAD-21] My Section at 360 px: menu, filters, student sheet, group chat; hidden for other teachers', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const admin = await prisma.user.create({ data: { role: 'admin', email: `e2e-${randomUUID()}@x.test`, passwordHash: 'x', mustChangePassword: false, firstLogin: false } });
  const adminToken = (await createSession(admin)).token;
  const cookieName = process.env.SESSION_COOKIE_NAME ?? 'cms_session';

  const n = 1000 + Math.floor(Math.random() * 8000);
  const created = await request.post('/api/academics/sessions', { headers: { 'X-Requested-With': 'cms', Cookie: `${cookieName}=${adminToken}` }, data: { name: `${n}–${String(n % 100).padStart(2, '0')}` } });
  expect(created.status()).toBe(201);
  const body = (await created.json()) as { groups: { type: string; sections: { id: string }[] }[] };
  const sectionId = body.groups.find((g) => g.type === 'science')!.sections[0]!.id;

  const mentor = await teacher('m');
  const plain = await teacher('p');
  await prisma.section.update({ where: { id: sectionId }, data: { mentorTeacherId: mentor.id } });
  const kids = [];
  for (let i = 0; i < 3; i++)
    kids.push(await prisma.user.create({
      data: { role: 'student', loginId: `e2e${n}s${i}`, email: `e2e${n}s${i}@x.test`, passwordHash: 'x', firstLogin: false, mustChangePassword: false, student: { create: { name: `Student ${['One', 'Two', 'Three'][i]}`, roll: String(i + 1), sectionId } } },
    }));
  await chatMembership.syncMany([mentor.id, ...kids.map((k) => k.id)]);
  // Student Two was active a moment ago; the others never logged in (inactive).
  await prisma.user.update({ where: { id: kids[1]!.id }, data: { lastLoginAt: new Date() } });

  // A teacher who mentors nothing sees no My Section.
  await context.addCookies([{ name: cookieName, value: (await createSession(plain)).token, url: baseURL! }]);
  await page.goto('/teacher');
  await expect(page.getByRole('heading', { name: /^Hello/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('My Section')).toHaveCount(0);
  await page.goto('/teacher/section');
  await expect(page.getByText('You are not a Section Mentor')).toBeVisible();

  // The mentor sees the dashboard card and the page.
  await context.clearCookies();
  await context.addCookies([{ name: cookieName, value: (await createSession(mentor)).token, url: baseURL! }]);
  await page.goto('/teacher');
  await expect(page.getByRole('link', { name: /My Section/ })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('link', { name: /My Section/ }).click();
  await expect(page.getByRole('heading', { name: 'My Section' })).toBeVisible();
  await expect(page.getByTestId('stat-students')).toContainText('3');
  await expect(page.getByTestId('student-1')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  // Filter: inactive hides the student who just logged in; search narrows further.
  await page.getByTestId('filter-inactive').click();
  await expect(page.getByTestId('student-1')).toBeVisible();
  await expect(page.getByTestId('student-2')).toHaveCount(0);
  await page.getByTestId('filter-all').click();
  await page.getByLabel('Search students').fill('three');
  await expect(page.getByTestId('student-3')).toBeVisible();
  await expect(page.getByTestId('student-1')).toHaveCount(0);
  await page.getByLabel('Search students').fill('');

  // Student sheet with Message button at 44 px.
  await page.getByTestId('student-2').click();
  await expect(page.getByTestId('student-detail')).toBeVisible();
  await expect(page.getByTestId('student-detail')).toContainText('Roll 2');
  const msg = await page.getByRole('button', { name: /^Message/ }).boundingBox();
  expect(msg!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: /^Close/ }).first().click().catch(() => page.keyboard.press('Escape'));

  // The section group chat opens.
  await page.getByTestId('open-group-chat').click();
  await expect(page).toHaveURL(/\/messages\/.+/);

  await prisma.loginSession.deleteMany({ where: { userId: { in: [admin.id, mentor.id, plain.id] } } });
});
