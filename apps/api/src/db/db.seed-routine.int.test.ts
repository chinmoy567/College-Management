import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db';
import { makeTeacher } from '../../../../test/factories';
import { makeCourse, makeSessionViaApi } from '../../../../test/m3kit';
import { adminClient, makeApp } from '../../../../test/m5kit';
import { routineClashes, seedRoutine } from '../../../../prisma/seed-routine';
import { weeklyCount } from '../../../../prisma/seed-routine-plan';

const app = makeApp();
let sectionIds: string[] = [];
let offeringsBySection = new Map<string, string[]>();
const teacherIds: string[] = [];

beforeAll(async () => {
  const admin = await adminClient(prisma, app);
  // 4 sections (2 sessions x science/commerce) that share 3 teachers, 10 courses each
  for (let i = 0; i < 3; i++) teacherIds.push((await makeTeacher(prisma)).id);
  let n = 0;
  for (let s = 0; s < 2; s++) {
    const tree = await makeSessionViaApi(admin.c);
    for (const kind of ['science', 'commerce'] as const) {
      const sectionId = tree.groups[kind].sectionId;
      sectionIds.push(sectionId);
      const ids: string[] = [];
      for (let c = 0; c < 10; c++) {
        const course = await makeCourse(prisma);
        const o = await prisma.courseOffering.create({ data: { sectionId, courseId: course.id, teacherId: teacherIds[n++ % 3]! } });
        ids.push(o.id);
      }
      offeringsBySection.set(sectionId, ids);
    }
  }
});
afterAll(async () => {
  await prisma.routineSlot.deleteMany({ where: { OR: sectionIds.map((id) => ({ id: { startsWith: `demo-slot-${id}-` } })) } });
  await prisma.$disconnect();
});

describe('demo routine seed', () => {
  it('[SCH-DEMO-02] saved routine has no room, teacher or section overlap and covers every offering', async () => {
    const r = await seedRoutine(prisma, { sectionIds });
    expect(r.sections).toBe(4);
    expect(await routineClashes(prisma, sectionIds)).toEqual([]);
    for (const [, ids] of offeringsBySection) {
      for (const id of ids) {
        const count = await prisma.routineSlotOffering.count({ where: { courseOfferingId: id, routineSlot: { deletedAt: null } } });
        expect(count).toBe(weeklyCount('science', { id, code: 'CRS', teacherId: 'x' }));
      }
    }
    // every slot got a seeded room and a seeded period
    const slots = await prisma.routineSlot.findMany({ where: { deletedAt: null, id: { startsWith: 'demo-slot-' }, offerings: { some: { courseOffering: { sectionId: { in: sectionIds } } } } } });
    expect(slots.every((s) => s.roomId?.startsWith('seed-room-') && s.periodId.startsWith('seed-period-'))).toBe(true);
  });

  it('[SCH-DEMO-03] running the seed again changes nothing', async () => {
    const live = () => prisma.routineSlot.count({ where: { deletedAt: null, id: { startsWith: 'demo-slot-' }, offerings: { some: { courseOffering: { sectionId: { in: sectionIds } } } } } });
    const before = await live();
    await seedRoutine(prisma, { sectionIds });
    expect(await live()).toBe(before);
    expect(await routineClashes(prisma, sectionIds)).toEqual([]);
  });

  it('[SCH-DEMO-02] the DB checker reports a clash when two slots share a room and period', async () => {
    const [a, b] = await prisma.routineSlot.findMany({ where: { deletedAt: null, id: { startsWith: `demo-slot-${sectionIds[0]}-` } }, take: 2 });
    await prisma.routineSlot.update({ where: { id: b!.id }, data: { day: a!.day, periodId: a!.periodId, roomId: a!.roomId } });
    expect((await routineClashes(prisma, sectionIds)).some((p) => p.startsWith('room '))).toBe(true);
    await seedRoutine(prisma, { sectionIds }); // re-seeding restores the clean plan
    expect(await routineClashes(prisma, sectionIds)).toEqual([]);
  });
});
