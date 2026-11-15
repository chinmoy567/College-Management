import { describe, expect, it } from 'vitest';
import { planRoutine, validateRoutine, weeklyCount, type PlanSection, type PlannedSlot } from '../../../../../prisma/seed-routine-plan';

// Same shape as the demo DB: 6 sections, shared teachers (T-0002 teaches English and ICT everywhere, T-0010 Bangla).
const T: Record<string, string> = {
  BAN: 'T-0010', ENG: 'T-0002', PHY: 'T-0001', CHE: 'T-0001', BIO: 'T-0004', HM: 'T-0005', AGR: 'T-0021',
  ACC: 'T-0003', BO: 'T-0006', FB: 'T-0007', PMM: 'T-0008', STA: 'T-0009',
  HIS: 'T-0011', ISH: 'T-0016', IST: 'T-0017', GEO: 'T-0012', CIV: 'T-0013', ECO: 'T-0014', SOC: 'T-0015', SWK: 'T-0019', LOG: 'T-0018', PSY: 'T-0020',
};
const BASES = {
  science: ['BAN', 'ENG', 'PHY', 'CHE', 'BIO', 'HM', 'AGR'],
  commerce: ['BAN', 'ENG', 'ACC', 'BO', 'FB', 'PMM', 'STA'],
  arts: ['BAN', 'ENG', 'HIS', 'ISH', 'IST', 'GEO', 'CIV', 'ECO', 'SOC', 'SWK', 'LOG', 'PSY'],
} as const;

function demoSections(): PlanSection[] {
  const out: PlanSection[] = [];
  let room = 0;
  const homes = ['101', '102', '103', '201', '202', '203'];
  for (const cls of [11, 12]) {
    for (const kind of ['science', 'commerce', 'arts'] as const) {
      const key = `c${cls}-${kind}`;
      const offerings = [
        ...BASES[kind].flatMap((b) => [1, 2].map((p) => ({ id: `${key}-${b}-${p}`, code: `${b}-${p}`, teacherId: T[b]!, optional: b === 'AGR' }))),
        { id: `${key}-ICT`, code: 'ICT', teacherId: 'T-0002' },
      ];
      out.push({ key, kind, homeRoom: homes[room++]!, offerings });
    }
  }
  return out;
}

describe('demo routine plan', () => {
  const sections = demoSections();
  const plan = planRoutine(sections);

  it('[SCH-DEMO-01] every offering of every section gets its weekly classes', () => {
    for (const s of sections) {
      for (const o of s.offerings) {
        const n = plan.filter((p) => p.offeringId === o.id).length;
        expect(n, `${s.key} ${o.code}`).toBe(weeklyCount(s.kind, o));
      }
    }
    // never twice on the same day for the same course
    const keys = plan.map((p) => `${p.offeringId}|${p.day}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('[SCH-DEMO-02] no room, teacher or section is booked twice in the same period on the same day', () => {
    expect(validateRoutine(plan)).toEqual([]);
  });

  it('[SCH-DEMO-02] the validator really catches a clash', () => {
    const a = plan[0]!;
    const other = plan.find((p) => p.sectionKey !== a.sectionKey)!;
    const bad: PlannedSlot[] = [
      a,
      { ...other, day: a.day, period: a.period, roomKey: a.roomKey, teacherId: a.teacherId, sectionKey: a.sectionKey },
    ];
    expect(validateRoutine(bad).length).toBe(3); // same room, teacher and section
  });

  it('[SCH-DEMO-03] the plan is deterministic', () => {
    expect(planRoutine(demoSections())).toEqual(plan);
  });
});
