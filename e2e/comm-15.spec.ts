import { test, expect } from '@playwright/test';
import { makeSection, makeUser, prisma, signIn } from './sch-kit';

test.afterAll(() => prisma.$disconnect());

const LONG = Array.from({ length: 9 }, (_, i) => `Line ${i + 1} of a long announcement that takes a lot of room on a phone screen.`).join('\n');

test('[COMM-15] a pin counts as seen only after 50% is visible for 1 s; collapsed pins are not counted; 5 shown + "Show N more announcements"', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const mentor = await makeUser('teacher', undefined, 'Mentor Meena');
  await prisma.section.update({ where: { id: sectionId }, data: { mentorTeacherId: mentor.id } });
  const student = await makeUser('student', sectionId, 'Pin Reader');

  // 7 section pins, oldest first so that ids[6] is the newest and shown first.
  const ids: string[] = [];
  for (let i = 0; i < 7; i++) {
    const p = await prisma.post.create({
      data: {
        authorId: mentor.id, text: `Pin ${i + 1}\n${LONG}`, pinAudience: 'section', pinSectionId: sectionId,
        createdAt: new Date(Date.now() - (7 - i) * 60_000), pinnedUntil: new Date(Date.now() + 5 * 86_400_000),
      },
    });
    ids.push(p.id);
  }
  const newestFirst = [...ids].reverse();
  await signIn(context, baseURL!, student);

  const seenCalls: string[][] = [];
  await page.route('**/api/feed/seen', async (route) => {
    seenCalls.push((route.request().postDataJSON() as { postIds: string[] }).postIds);
    await route.continue();
  });

  await page.goto('/feed');
  const cards = page.getByTestId('pinned-card');
  await expect(cards).toHaveCount(5, { timeout: 60_000 }); // 5 expanded
  await expect(page.getByTestId('show-more-pins')).toHaveText('Show 2 more announcements');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await expect(cards.first()).toHaveAttribute('data-post-id', newestFirst[0]!);

  // Nothing is sent before 1 s of visibility.
  await page.waitForTimeout(400);
  expect(seenCalls).toHaveLength(0);
  // After ≥ 1 s the first card (fully on screen) is reported, within the 2 s batch window.
  await expect.poll(() => seenCalls.flat().includes(newestFirst[0]!), { timeout: 8000 }).toBe(true);
  expect(await prisma.postView.count({ where: { postId: newestFirst[0]!, userId: student.id } })).toBe(1);
  // Far-down cards were never visible; collapsed ones are not even rendered.
  expect(seenCalls.flat()).not.toContain(newestFirst[4]);
  expect(seenCalls.flat()).not.toContain(newestFirst[5]);
  expect(seenCalls.flat()).not.toContain(newestFirst[6]);
  // The seen card does not jump away while the user is looking at it.
  await expect(cards.first()).toHaveAttribute('data-post-id', newestFirst[0]!);

  // On the next load it has left the top and sits in the timeline.
  await page.reload();
  await expect(page.getByTestId('pinned-stack')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pinned-card').first()).not.toHaveAttribute('data-post-id', newestFirst[0]!);
  await expect(page.locator(`[data-post-id="${newestFirst[0]}"][data-testid="post-card"]`)).toHaveCount(1);
});

test('[COMM-UI] write a post, comment, report it and review it in moderation at 360 px', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const author = await makeUser('student', sectionId, 'Post Author');
  const other = await makeUser('student', sectionId, 'Other Student');
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  await signIn(context, baseURL!, author);
  await page.goto('/feed');
  await page.getByTestId('new-post').click();
  const text = `Need help with chapter ${Date.now()}`;
  await page.getByLabel('What do you want to share?').fill(text);
  await page.getByRole('dialog').getByLabel('Tag').selectOption('problem');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  const card = page.getByTestId('post-card').filter({ hasText: text });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('Problem / Need Help');
  await noOverflow();

  await signIn(context, baseURL!, other);
  await page.goto('/feed');
  const theirs = page.getByTestId('post-card').filter({ hasText: text });
  await expect(theirs).toBeVisible({ timeout: 30_000 });
  await theirs.getByTestId('react-btn').click();
  await page.getByRole('button', { name: 'Love' }).click();
  await theirs.getByRole('button', { name: 'Report' }).click();
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByRole('status')).toContainText('Thank you');
  await theirs.getByRole('link', { name: /comments/ }).click();
  await page.getByLabel('Write a comment').fill('Try the second example.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('comment')).toContainText('Try the second example.');
  await noOverflow();
  await page.getByTestId('author-link').first().click();
  await expect(page.getByTestId('public-profile')).toContainText('Post Author');
  expect(await page.content()).not.toContain(author.loginId!);
  await noOverflow();

  await signIn(context, baseURL!, admin);
  await page.goto('/admin/moderation');
  const item = page.getByTestId('queue-item').filter({ hasText: text });
  await expect(item).toContainText('1 report', { timeout: 30_000 });
  await item.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByLabel('Reason (kept in the audit log)').fill('Not allowed');
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
  await expect(item).toHaveCount(0);
  await noOverflow();
  expect((await prisma.post.findFirstOrThrow({ where: { text } })).status).toBe('removed');
});
