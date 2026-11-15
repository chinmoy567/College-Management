import { test, expect } from '@playwright/test';
import { COOKIE, makeSection, makeUser, prisma, signIn } from './sch-kit';

test.afterAll(() => prisma.$disconnect());

const noOverflow = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

const ROUTES: Record<'admin' | 'teacher' | 'student', string[]> = {
  admin: ['/admin', '/admin/sessions', '/admin/courses', '/admin/mentors', '/admin/moderation', '/admin/schedule', '/admin/books', '/admin/ai', '/admin/library', '/admin/students', '/admin/students/new', '/admin/students/import', '/admin/teachers'],
  teacher: ['/teacher', '/teacher/attendance', '/teacher/content', '/teacher/exams'],
  student: ['/student', '/student/courses', '/student/live', '/student/recordings', '/student/notes', '/student/previous-questions', '/student/exams', '/student/progress', '/student/routine', '/student/attendance', '/student/books', '/student/my-books', '/student/ai'],
};
const SHARED = ['/feed', '/messages', '/notices', '/notifications', '/profile'];

test('[FE-01] no page has horizontal scroll (every route of every role)', async ({ page, context, request, baseURL }) => {
  test.setTimeout(900_000);
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const users = { admin, teacher: await makeUser('teacher'), student: await makeUser('student', sectionId, 'Scroll Student') };
  const bad: string[] = [];
  for (const role of ['admin', 'teacher', 'student'] as const) {
    await signIn(context, baseURL!, users[role]);
    for (const route of [...ROUTES[role], ...SHARED]) {
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await page.getByRole('main').first().waitFor({ timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
      if (!(await noOverflow(page))) bad.push(`${role} ${route}`);
    }
  }
  await context.clearCookies();
  for (const route of ['/', '/login?role=student', '/login?role=admin', '/forgot-password']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    if (!(await noOverflow(page))) bad.push(`public ${route}`);
  }
  expect(bad).toEqual([]);
});

test('[FE-02] touch targets are at least 44 x 44 px and inputs at least 16 px', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'phone layout');
  test.setTimeout(300_000);
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const student = await makeUser('student', sectionId, 'Target Student');
  const small: string[] = [];
  const audit = async (name: string) => {
    const found = await page.evaluate(() => {
      const out: string[] = [];
      const els = document.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab]');
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
        const isField = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
        const t = (el as HTMLInputElement).type ?? '';
        if (isField && !/checkbox|radio|file/.test(t) && parseFloat(getComputedStyle(el).fontSize) < 16) out.push(`font ${el.tagName}[${el.getAttribute('name') ?? el.id}]`);
        // Links inside running text are exempt (WCAG inline-text exception); block and flex controls are not.
        const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
        if (!inline && (r.width < 43.5 || r.height < 43.5) && !/checkbox|radio/.test(t))
          out.push(`${el.tagName} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    for (const f of found) small.push(`${name}: ${f}`);
  };
  await page.goto('/login?role=student');
  await page.getByLabel('Password').waitFor();
  await audit('login');
  await page.goto('/');
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await audit('landing');
  await signIn(context, baseURL!, student);
  for (const r of ['/student', '/student/courses', '/feed', '/profile']) {
    await page.goto(r);
    await page.getByRole('navigation').first().waitFor({ timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await audit(r);
  }
  expect(small).toEqual([]);
});

test('[FE-05] a data screen shows loading, empty and error states', async ({ page, context, request, baseURL }) => {
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const student = await makeUser('student', sectionId, 'States Student');
  await signIn(context, baseURL!, student);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route('**/api/classes/online', async (route) => { await gate; await route.continue(); });
  await page.goto('/student/live');
  await expect(page.getByLabel('Loading')).toBeVisible({ timeout: 60_000 });
  release();
  await expect(page.getByText('No online classes')).toBeVisible();
  await page.unroute('**/api/classes/online');
  await page.route('**/api/classes/online', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Server broke' } }) }));
  await page.goto('/student/live');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible({ timeout: 60_000 });
});

test('[FE-06] controls a role may not use are hidden, and the API still denies the call', async ({ page, context, request, baseURL }) => {
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const student = await makeUser('student', sectionId, 'Gate Student');
  const token = await signIn(context, baseURL!, student);
  await page.goto('/student');
  const phone = test.info().project.name === 'phone';
  await expect(page.getByRole('navigation', { name: `student ${phone ? 'tabs' : 'sidebar'}` })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('a[href^="/admin"], a[href^="/teacher"]')).toHaveCount(0);
  await page.goto('/admin/sessions');
  await expect(page).toHaveURL(/\/student/, { timeout: 60_000 });
  const res = await request.post('/api/academics/sessions', { headers: { Cookie: `${COOKIE}=${token}`, 'X-Requested-With': 'cms' }, data: { name: 'X' } });
  expect(res.status()).toBe(403);
});
