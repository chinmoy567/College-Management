import { describe, expect, it } from 'vitest';
import { plan, type PlanExisting, type PlanInput, type PlanSlot } from './generator';

// 2030-01-07 is a Monday.
const MON = '2030-01-07';
const NOTHING = { inserts: [], updates: [], removals: [] };
const slot = (o: Partial<PlanSlot> = {}): PlanSlot => ({
  id: 's1', day: 1, periodId: 'p1', roomId: 'r1', startTime: '08:00', endTime: '08:45', deleted: false,
  offerings: [{ id: 'o1', teacherId: 't1', sessionId: 'x1' }], ...o,
});
const meeting = (o: Partial<PlanExisting> = {}): PlanExisting => ({
  id: 'm1', routineSlotId: 's1', date: MON, originalDate: null, status: 'scheduled', attended: false, manuallyEdited: false,
  teacherId: 't1', roomId: 'r1', periodId: 'p1', startTime: '08:00', endTime: '08:45', offeringIds: ['o1'], ...o,
});
const base = (o: Partial<PlanInput> = {}): PlanInput => ({
  dates: [MON], today: '2030-01-01', slots: [slot()], holidays: [], specialDays: [], existing: [], ...o,
});

describe('meeting generator plan', () => {
  it('[SCH-01] skips holidays and only creates the listed periods on a special day', () => {
    expect(plan(base({ holidays: [{ startDate: MON, endDate: MON }] })).inserts).toHaveLength(0);
    const two = [slot(), slot({ id: 's2', periodId: 'p2' })];
    const r = plan(base({ slots: two, specialDays: [{ date: MON, sessionId: null, periodIds: ['p2'] }] }));
    expect(r.inserts.map((i) => i.routineSlotId)).toEqual(['s2']);
    // a session-specific special day overrides the college-wide one for that session
    const o = plan(base({ specialDays: [{ date: MON, sessionId: null, periodIds: [] }, { date: MON, sessionId: 'x1', periodIds: ['p1'] }] }));
    expect(o.inserts).toHaveLength(1);
  });

  it('[SCH-02] is idempotent and leaves removed, cancelled, attended, moved and past meetings alone', () => {
    expect(plan(base()).inserts).toHaveLength(1);
    expect(plan(base({ existing: [meeting()] }))).toEqual(NOTHING);
    const changed = [slot({ roomId: 'r9' })];
    for (const m of [meeting({ status: 'cancelled' }), meeting({ attended: true, status: 'held' }), meeting({ manuallyEdited: true, status: 'removed' })])
      expect(plan(base({ existing: [m], slots: changed }))).toEqual(NOTHING);
    // moved to another date: original_date still blocks recreation on the original date
    const moved = meeting({ date: '2030-01-09', originalDate: MON, manuallyEdited: true });
    expect(plan(base({ existing: [moved] })).inserts).toHaveLength(0);
    // past dates are never touched
    expect(plan(base({ today: '2030-01-08' })).inserts).toHaveLength(0);
  });

  it('[SCH-03] a routine change updates unattended future meetings only', () => {
    const changed = [slot({ roomId: 'r2', offerings: [{ id: 'o1', teacherId: 't2', sessionId: 'x1' }] })];
    const r = plan(base({ existing: [meeting()], slots: changed }));
    expect(r.updates).toEqual([expect.objectContaining({ id: 'm1', roomId: 'r2', teacherId: 't2' })]);
    expect(plan(base({ today: '2030-01-08', existing: [meeting()], slots: changed })).updates).toHaveLength(0);
    expect(plan(base({ existing: [meeting({ attended: true })], slots: changed })).updates).toHaveLength(0);
  });

  it('[SCH-04] a combined slot makes one meeting covering all offerings', () => {
    const combined = slot({ offerings: [{ id: 'o1', teacherId: 't1', sessionId: 'x1' }, { id: 'o2', teacherId: 't1', sessionId: 'x1' }] });
    const r = plan(base({ slots: [combined] }));
    expect(r.inserts).toHaveLength(1);
    expect(r.inserts[0]!.offeringIds).toEqual(['o1', 'o2']);
  });

  it('removes meetings of deleted slots and blocked days; revives holiday removals', () => {
    expect(plan(base({ existing: [meeting()], slots: [slot({ deleted: true })] })).removals).toEqual(['m1']);
    expect(plan(base({ existing: [meeting()], holidays: [{ startDate: MON, endDate: MON }] })).removals).toEqual(['m1']);
    expect(plan(base({ existing: [meeting()], slots: [slot({ offerings: [] })] })).removals).toEqual(['m1']);
    const r = plan(base({ existing: [meeting({ status: 'removed' })] }));
    expect(r.updates).toEqual([expect.objectContaining({ id: 'm1', status: 'scheduled' })]);
    const held = meeting({ attended: true, status: 'held' });
    expect(plan(base({ existing: [held], holidays: [{ startDate: MON, endDate: MON }] })).removals).toHaveLength(0);
  });
});
