import { test, expect } from '@playwright/test';
import { makeSection, makeUser, prisma, signIn } from './sch-kit';

test.afterAll(() => prisma.$disconnect());

test('[CHAT-15] two browsers at 360 px: a message arrives in under 1 s, the typing indicator and "Seen" show', async ({ browser, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  test.setTimeout(150_000);
  const setup = await browser.newContext();
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(setup, baseURL!, admin));
  await setup.close();
  const alice = await makeUser('student', sectionId, 'Alice Chat');
  const bob = await makeUser('student', sectionId, 'Bob Chat');
  const conv = await prisma.conversation.create({
    data: { type: 'direct', directKey: [alice.id, bob.id].sort().join(':'), members: { create: [{ userId: alice.id }, { userId: bob.id }] } },
  });

  const phone = { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true };
  const ctxA = await browser.newContext(phone);
  const ctxB = await browser.newContext(phone);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await signIn(ctxA, baseURL!, alice);
  await signIn(ctxB, baseURL!, bob);
  await a.goto(`/messages/${conv.id}`);
  await b.goto(`/messages/${conv.id}`);
  await expect(a.getByLabel('Message')).toBeVisible({ timeout: 60_000 });
  await expect(b.getByLabel('Message')).toBeVisible({ timeout: 60_000 });
  expect(await a.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  // Let both sockets finish joining the room before measuring.
  await a.waitForTimeout(1000);

  // Typing indicator on the other phone.
  await b.getByLabel('Message').pressSequentially('hel', { delay: 30 });
  await expect(a.getByTestId('typing')).toHaveText('Typing…', { timeout: 3000 });

  // Delivery time.
  await b.getByLabel('Message').fill('hello Alice');
  const t0 = Date.now();
  await b.getByRole('button', { name: 'Send' }).click();
  await expect(a.getByTestId('message').filter({ hasText: 'hello Alice' })).toBeVisible({ timeout: 1000 });
  expect(Date.now() - t0).toBeLessThan(1000);

  // Alice has the thread open, so Bob sees "Seen".
  await expect(b.getByTestId('seen')).toHaveText('Seen', { timeout: 5000 });
  await ctxA.close();
  await ctxB.close();
});
