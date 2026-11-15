/**
 * Pure planner for the demo weekly routine (no database, no randomness: a small seeded generator makes it deterministic).
 * Rules the plan always satisfies (checked by validateRoutine):
 *  - a section has at most one class in a period on a day
 *  - a teacher has at most one class in a period on a day (no combined classes are planned)
 *  - a room hosts at most one class in a period on a day
 * Working week is Sunday to Thursday, 8 periods a day.
 */
export const ROUTINE_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu'] as const;
export type RoutineDay = (typeof ROUTINE_DAYS)[number];
export const PERIOD_COUNT = 8;

export interface PlanOffering {
  id: string;
  code: string; // course code, e.g. PHY-1
  teacherId: string;
  optional?: boolean;
}
export interface PlanSection {
  key: string; // stable key, used for ordering and slot ids
  kind: 'science' | 'commerce' | 'arts';
  homeRoom: string; // room key
  offerings: PlanOffering[];
}
export interface PlannedSlot {
  sectionKey: string;
  offeringId: string;
  teacherId: string;
  day: RoutineDay;
  period: number; // 1..PERIOD_COUNT
  roomKey: string;
}

export const SPARE_ROOM = '104';
const LAB: Record<string, string> = { PHY: 'phy-lab', CHE: 'che-lab', BIO: 'bio-lab', ICT: 'ict-lab' };
const base = (code: string) => code.split('-')[0]!;

/** Classes per week: Science/Commerce 2 (ICT and optional 1); Arts 1 (Bangla and English 2). */
export function weeklyCount(kind: PlanSection['kind'], o: PlanOffering): number {
  if (kind === 'arts') return ['BAN', 'ENG'].includes(base(o.code)) ? 2 : 1;
  return o.optional || base(o.code) === 'ICT' ? 1 : 2;
}

const labFor = (code: string): string | undefined => LAB[base(code)];

function lcg(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

interface Item { section: PlanSection; offering: PlanOffering; count: number }

function attemptPlan(sections: PlanSection[], attempt: number): PlannedSlot[] | null {
  const rnd = lcg(attempt * 7919 + 17);
  const load = new Map<string, number>();
  const items: Item[] = [];
  for (const section of sections) {
    for (const offering of section.offerings) {
      const count = weeklyCount(section.kind, offering);
      items.push({ section, offering, count });
      load.set(offering.teacherId, (load.get(offering.teacherId) ?? 0) + count);
    }
  }
  // most loaded teacher first, then section key and course code (stable)
  items.sort((a, b) =>
    (load.get(b.offering.teacherId)! - load.get(a.offering.teacherId)!) ||
    a.offering.teacherId.localeCompare(b.offering.teacherId) ||
    a.section.key.localeCompare(b.section.key) || a.offering.code.localeCompare(b.offering.code));

  const sectionBusy = new Set<string>();
  const teacherBusy = new Set<string>();
  const roomBusy = new Set<string>();
  const dayLoad = new Map<string, number>();
  const out: PlannedSlot[] = [];

  for (const { section, offering, count } of items) {
    const daysUsed = new Set<string>();
    for (let n = 0; n < count; n++) {
      let best: { day: RoutineDay; period: number; room: string; score: number } | null = null;
      for (const day of ROUTINE_DAYS) {
        for (let period = 1; period <= PERIOD_COUNT; period++) {
          const at = `${day}|${period}`;
          if (sectionBusy.has(`${section.key}|${at}`) || teacherBusy.has(`${offering.teacherId}|${at}`)) continue;
          const lab = labFor(offering.code);
          const room = [lab, section.homeRoom, SPARE_ROOM].find((r) => r && !roomBusy.has(`${r}|${at}`));
          if (!room) continue;
          const score =
            (daysUsed.has(day) ? 1000 : 0) + // same course on different days
            (dayLoad.get(`${section.key}|${day}`) ?? 0) * 20 + // spread the section's load over the week
            period * 2 + rnd() * 6;
          if (!best || score < best.score) best = { day, period, room, score };
        }
      }
      if (!best) return null;
      const at = `${best.day}|${best.period}`;
      sectionBusy.add(`${section.key}|${at}`);
      teacherBusy.add(`${offering.teacherId}|${at}`);
      roomBusy.add(`${best.room}|${at}`);
      dayLoad.set(`${section.key}|${best.day}`, (dayLoad.get(`${section.key}|${best.day}`) ?? 0) + 1);
      daysUsed.add(best.day);
      out.push({ sectionKey: section.key, offeringId: offering.id, teacherId: offering.teacherId, day: best.day, period: best.period, roomKey: best.room });
    }
  }
  return out;
}

/** Plans the whole week. Throws if no clash-free plan is found, so a bad routine is never written. */
export function planRoutine(sections: PlanSection[]): PlannedSlot[] {
  for (let attempt = 0; attempt < 300; attempt++) {
    const plan = attemptPlan(sections, attempt);
    if (plan && validateRoutine(plan).length === 0) {
      return plan.sort((a, b) =>
        a.sectionKey.localeCompare(b.sectionKey) || ROUTINE_DAYS.indexOf(a.day) - ROUTINE_DAYS.indexOf(b.day) || a.period - b.period);
    }
  }
  throw new Error('Could not plan a clash-free demo routine (too few periods, rooms or teachers for the offerings).');
}

/** Returns one message per room, teacher or section overlap; empty means the routine is clean. */
export function validateRoutine(slots: PlannedSlot[]): string[] {
  const problems: string[] = [];
  const seen = { room: new Set<string>(), teacher: new Set<string>(), section: new Set<string>() };
  for (const s of slots) {
    const at = `${s.day} P${s.period}`;
    for (const [kind, who] of [['room', s.roomKey], ['teacher', s.teacherId], ['section', s.sectionKey]] as const) {
      const key = `${who}|${at}`;
      if (seen[kind].has(key)) problems.push(`${kind} ${who} is used twice on ${at}`);
      seen[kind].add(key);
    }
  }
  return problems;
}
