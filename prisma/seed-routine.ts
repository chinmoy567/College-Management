/**
 * Demo weekly routine for every section that has course offerings (DEV / demo data only, idempotent).
 * Run after seed-offerings / seed-courses-full / seed-students-90:  npm run db:seed:routine
 *  - normalises the demo periods and rooms (prisma/seed.ts)
 *  - soft-deletes the leftover "E2E <n>" test periods
 *  - plans a clash-free Sun-Thu routine (prisma/seed-routine-plan.ts) and writes it as demo-slot-* routine slots
 *  - generates Class Meetings for the next 14 days
 * Refuses to run if the Admin has already built routine slots for these offerings (never mixes with real data).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { demoRoomId, seedPeriods, seedRooms } from './seed';
import { planRoutine, type PlanSection } from './seed-routine-plan';

const HOME_ROOMS = ['101', '102', '103', '201', '202', '203']; // class 11 sci/com/arts, then class 12
const GROUP_ORDER = ['science', 'commerce', 'arts'];
const slotId = (sectionId: string, n: number) => `demo-slot-${sectionId}-${String(n).padStart(2, '0')}`;

/** `sectionIds` limits the routine to those sections (used by tests); default is every section with offerings. */
export async function seedRoutine(prisma: PrismaClient, opts: { sectionIds?: string[] } = {}): Promise<{ sections: number; slots: number }> {
  await seedPeriods(prisma);
  await seedRooms(prisma);
  await prisma.period.updateMany({
    where: { name: { startsWith: 'E2E ' }, deletedAt: null, slots: { none: { deletedAt: null } } },
    data: { deletedAt: new Date() },
  });

  const rows = await prisma.section.findMany({
    where: { deletedAt: null, offerings: { some: { endedAt: null } }, ...(opts.sectionIds ? { id: { in: opts.sectionIds } } : {}) },
    include: {
      group: { include: { session: true } },
      offerings: { where: { endedAt: null }, include: { course: true } },
    },
  });
  // stable order: Class 11 before 12, then Science, Commerce, Arts, then session name
  rows.sort((a, b) =>
    a.classLevel - b.classLevel || GROUP_ORDER.indexOf(a.group.type) - GROUP_ORDER.indexOf(b.group.type) ||
    a.group.session.name.localeCompare(b.group.session.name));
  if (rows.length > HOME_ROOMS.length) throw new Error(`Demo routine supports ${HOME_ROOMS.length} sections with offerings, found ${rows.length}.`);

  const planSections: PlanSection[] = rows.map((s, i) => ({
    key: s.id,
    kind: s.group.type,
    homeRoom: HOME_ROOMS[i]!,
    offerings: s.offerings
      .sort((a, b) => a.course.code.localeCompare(b.course.code))
      .map((o) => ({ id: o.id, code: o.course.code, teacherId: o.teacherId, optional: o.course.isOptional })),
  }));
  // sort the plan by the display order above, not by random ids
  const order = new Map(rows.map((s, i) => [s.id, i]));
  const plan = planRoutine(planSections).sort((a, b) => order.get(a.sectionKey)! - order.get(b.sectionKey)!);

  const offeringIds = planSections.flatMap((s) => s.offerings.map((o) => o.id));
  const foreign = await prisma.routineSlot.count({
    where: { deletedAt: null, id: { not: { startsWith: 'demo-slot-' } }, offerings: { some: { courseOfferingId: { in: offeringIds } } } },
  });
  if (foreign > 0) throw new Error(`The Admin already has ${foreign} routine slot(s) for these sections; not adding a demo routine on top.`);

  const periods = await prisma.period.findMany({ where: { id: { startsWith: 'seed-period-' }, deletedAt: null } });
  const periodId = (n: number) => periods.find((p) => p.id === `seed-period-${n}`)!.id;

  const counters = new Map<string, number>();
  const keep: string[] = [];
  for (const s of plan) {
    const n = (counters.get(s.sectionKey) ?? 0) + 1;
    counters.set(s.sectionKey, n);
    const id = slotId(s.sectionKey, n);
    keep.push(id);
    const data = { day: s.day, periodId: periodId(s.period), roomId: demoRoomId(s.roomKey), deletedAt: null };
    await prisma.routineSlot.upsert({ where: { id }, create: { id, ...data }, update: data });
    await prisma.routineSlotOffering.deleteMany({ where: { routineSlotId: id } });
    await prisma.routineSlotOffering.create({ data: { routineSlotId: id, courseOfferingId: s.offeringId } });
  }
  // demo slots of these sections from an older plan that are no longer part of it
  await prisma.routineSlot.updateMany({
    where: { OR: rows.map((s) => ({ id: { startsWith: `demo-slot-${s.id}-` } })), AND: { id: { notIn: keep } }, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return { sections: rows.length, slots: plan.length };
}

/** Reads the saved (non-deleted) routine slots from the DB and reports room, teacher and section clashes. */
export async function routineClashes(prisma: PrismaClient, sectionIds?: string[]): Promise<string[]> {
  const slots = await prisma.routineSlot.findMany({
    where: {
      deletedAt: null,
      offerings: { some: { courseOffering: { endedAt: null, ...(sectionIds ? { sectionId: { in: sectionIds } } : {}) } } },
    },
    include: { offerings: { include: { courseOffering: true } } },
  });
  const seen = new Set<string>();
  const problems: string[] = [];
  const mark = (kind: string, who: string | null, s: { day: string; periodId: string }) => {
    if (!who) return;
    const k = `${kind}|${who}|${s.day}|${s.periodId}`;
    if (seen.has(k)) problems.push(`${kind} ${who} is double-booked on ${s.day} (${s.periodId})`);
    seen.add(k);
  };
  for (const s of slots) {
    mark('room', s.roomId, s);
    // one teacher / section per slot is counted once, so a combined class is not a clash
    for (const t of new Set(s.offerings.map((o) => o.courseOffering.teacherId))) mark('teacher', t, s);
    for (const sec of new Set(s.offerings.map((o) => o.courseOffering.sectionId))) mark('section', sec, s);
  }
  return problems;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const r = await seedRoutine(prisma);
    console.log(`Demo routine ready: ${r.slots} classes for ${r.sections} sections.`);
    try {
      const { generateMeetings } = await import('../apps/api/src/modules/schedule/generate');
      const g = await generateMeetings();
      console.log(`Class Meetings for the next 14 days: ${g.inserted} created, ${g.updated} updated, ${g.removed} removed.`);
    } catch (e) {
      console.warn('Routine saved, but meetings were not generated now (the nightly job will do it):', e instanceof Error ? e.message : e);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && /seed-routine\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
