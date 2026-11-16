import { test, expect } from '@playwright/test';
import { makeMeeting, makeOffering, makeSection, makeUser, prisma, signIn } from './sch-kit';

test.afterAll(() => prisma.$disconnect());

test('[SCH-15] attendance sheet at 360 px, draft kept on failure', async ({ page, context, request, baseURL }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone project only (360x740)');
  const admin = await makeUser('admin');
  const sectionId = await makeSection(request, await signIn(context, baseURL!, admin));
  const teacher = await makeUser('teacher', undefined, 'Sheet Teacher');
  const kids = [];
  for (let i = 0; i < 12; i++) kids.push(await makeUser('student', sectionId, `Kid ${i + 1}`));
  const { offering } = await makeOffering(sectionId, teacher.id, kids.map((k) => k.id));
  const meeting = await makeMeeting(offering.id, teacher.id);
  await signIn(context, baseURL!, teacher);

  await page.goto(`/teacher/attendance/${meeting.id}`);
  const rows = page.locator('[data-testid^="row-"]');
  await expect(rows).toHaveCount(12, { timeout: 60_000 });
  for (const s of await page.getByTestId('status').all()) await expect(s).toHaveText('present'); // everyone Present by default
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect((await rows.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // tap cycles Present -> Absent -> Late -> Excused -> Present
  const first = rows.first();
  const chip = first.getByTestId('status');
  for (const next of ['absent', 'late', 'excused', 'present', 'absent']) {
    await first.click();
    await expect(chip).toHaveText(next);
  }

  // Submit stays pinned to the bottom of the viewport, even with the list scrolled.
  const submit = page.getByRole('button', { name: /^(Submit|Retry)/ });
  await rows.last().scrollIntoViewIfNeeded();
  const box = (await submit.boundingBox())!;
  expect(box.y + box.height).toBeGreaterThan(740 - 80);
  expect(box.height).toBeGreaterThanOrEqual(44);

  // A failed submit keeps the draft and says "Not sent, retry".
  await page.route('**/api/attendance/meetings/*/sheet', (r) => (r.request().method() === 'POST' ? r.abort('failed') : r.continue()));
  await submit.click();
  await expect(page.getByTestId('not-sent')).toContainText('Not sent, retry');
  expect(await page.evaluate((id) => localStorage.getItem(`att-draft:${id}`), meeting.id)).not.toBeNull();
  await page.reload();
  await expect(rows).toHaveCount(12, { timeout: 30_000 });
  await expect(rows.first().getByTestId('status')).toHaveText('absent', { timeout: 30_000 }); // draft survived a reload
  expect(await prisma.attendanceRecord.count({ where: { classMeetingId: meeting.id } })).toBe(0);

  // Retry once the network is back: saved, draft cleared.
  await page.unroute('**/api/attendance/meetings/*/sheet');
  await page.getByRole('button', { name: /^Retry/ }).click();
  await expect(page.getByText('Attendance saved.')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate((id) => localStorage.getItem(`att-draft:${id}`), meeting.id)).toBeNull();
  expect(await prisma.attendanceRecord.count({ where: { classMeetingId: meeting.id } })).toBe(12);
  expect(await prisma.attendanceRecord.count({ where: { classMeetingId: meeting.id, status: 'absent' } })).toBe(1);

  // Once saved the button is black and cannot be clicked; changing a mark makes it usable again and the edit is saved.
  const saved = page.getByRole('button', { name: /^Saved/ });
  await expect(saved).toBeDisabled();
  await expect(saved).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  expect(await prisma.attendanceRecord.count({ where: { classMeetingId: meeting.id } })).toBe(12);
  expect(await prisma.attendanceEdit.count({ where: { attendanceRecord: { classMeetingId: meeting.id } } })).toBe(0);
  await rows.nth(1).click(); // present -> absent
  await expect(page.getByRole('button', { name: /^Submit/ })).toBeEnabled();
  await page.getByRole('button', { name: /^Submit/ }).click();
  await expect.poll(() => prisma.attendanceRecord.count({ where: { classMeetingId: meeting.id, status: 'absent' } }), { timeout: 30_000 }).toBe(2);
  expect(await prisma.attendanceRecord.count({ where: { classMeetingId: meeting.id } })).toBe(12);
  expect(await prisma.attendanceEdit.count({ where: { attendanceRecord: { classMeetingId: meeting.id } } })).toBe(1);
});
