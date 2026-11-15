import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../db';
import { setClock } from '../lib/clock';
import { createMemoryBackend, setStorageBackend, storage } from '../lib/files';
import { runHousekeeping, runPinExpire, runStoragePurge } from './maintenance';
import { makeTeacher } from '../../../../test/m3kit';

const DAY = 86_400_000;
afterEach(() => { setClock(null); setStorageBackend(null); });
afterAll(() => prisma.$disconnect());

describe('maintenance jobs', () => {
  it('[OPS-11] storage.purge deletes objects 30 days after delete and never before', async () => {
    const backend = createMemoryBackend();
    setStorageBackend(backend);
    const o = await prisma.storageObject.create({ data: { bucket: 'private', key: `notes/2026/01/${Date.now()}.pdf`, mime: 'application/pdf', size: 3, originalName: 'a.pdf', uploadedBy: 'system' } });
    await backend.put('private', o.key, Buffer.from('abc'), 'application/pdf');
    await storage().softDelete(o.id);

    const deletedAt = (await prisma.storageObject.findUniqueOrThrow({ where: { id: o.id } })).deletedAt!;
    // Just before day 30: untouched. (The job uses the real clock; move the row's deletedAt instead of the clock.)
    await prisma.storageObject.update({ where: { id: o.id }, data: { deletedAt: new Date(Date.now() - 30 * DAY + 60_000) } });
    await runStoragePurge();
    expect(await prisma.storageObject.count({ where: { id: o.id } })).toBe(1);
    expect(backend.files.size).toBe(1);

    await prisma.storageObject.update({ where: { id: o.id }, data: { deletedAt: new Date(Date.now() - 30 * DAY - 60_000) } });
    expect((await runStoragePurge()).objects).toBeGreaterThanOrEqual(1);
    expect(await prisma.storageObject.count({ where: { id: o.id } })).toBe(0);
    expect(backend.files.size).toBe(0);
    expect((await runStoragePurge()).objects).toBe(0); // second run changes nothing
    expect(deletedAt).toBeInstanceOf(Date);
  });

  it('[OPS-03] housekeeping and pin.expire are idempotent and late-safe', async () => {
    const t = await makeTeacher(prisma);
    const mk = (n: string, expiresAt: Date) => prisma.token.create({ data: { userId: t.id, tokenHash: `${n}-${Date.now()}-${Math.random()}`, purpose: 'password_reset', expiresAt } });
    const old = await mk('old', new Date(Date.now() - DAY));
    const live = await mk('live', new Date(Date.now() + DAY));
    const oldSession = await prisma.loginSession.create({ data: { userId: t.id, tokenHash: `s-old-${Math.random()}`, expiresAt: new Date(Date.now() - 31 * DAY) } });
    const recentSession = await prisma.loginSession.create({ data: { userId: t.id, tokenHash: `s-new-${Math.random()}`, expiresAt: new Date(Date.now() - 5 * DAY) } });
    const hit = await prisma.rateLimitHit.create({ data: { key: `t:${Math.random()}`, windowStart: new Date(Date.now() - 3 * DAY) } });

    const first = await runHousekeeping();
    expect(first.tokens).toBeGreaterThanOrEqual(1);
    expect(first.sessions).toBeGreaterThanOrEqual(1);
    expect(first.hits).toBeGreaterThanOrEqual(1);
    expect(await prisma.token.count({ where: { id: old.id } })).toBe(0);
    expect(await prisma.token.count({ where: { id: live.id } })).toBe(1);
    expect(await prisma.loginSession.count({ where: { id: oldSession.id } })).toBe(0);
    expect(await prisma.loginSession.count({ where: { id: recentSession.id } })).toBe(1);
    expect(await prisma.rateLimitHit.count({ where: { key: hit.key } })).toBe(0);

    // Run again, and "late" (a week later): only newly expired rows go, nothing else changes.
    expect(await runHousekeeping()).toEqual({ hits: 0, tokens: 0, sessions: 0 });
    await runHousekeeping(new Date(Date.now() + 7 * DAY));
    expect(await prisma.loginSession.count({ where: { id: recentSession.id } })).toBe(1);
    await expect(runPinExpire()).resolves.toBeUndefined();
    await expect(runPinExpire()).resolves.toBeUndefined();
  });
});
