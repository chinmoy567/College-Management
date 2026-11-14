// Pure Class Meeting planner (docs/spec/04 §4). No database access: `plan` decides, the executor applies.
export interface PlanOffering { id: string; teacherId: string; sessionId: string }
export interface PlanSlot {
  id: string;
  day: number; // 0 = Sunday … 6
  periodId: string;
  roomId: string | null;
  startTime: string; // HH:mm of the slot's period
  endTime: string;
  deleted: boolean;
  /** Only offerings that are active in a non-closed session. */
  offerings: PlanOffering[];
}
export interface PlanHoliday { startDate: string; endDate: string }
export interface PlanSpecialDay { date: string; sessionId: string | null; periodIds: string[] }
export interface PlanExisting {
  id: string;
  routineSlotId: string;
  date: string;
  originalDate: string | null;
  status: 'scheduled' | 'held' | 'cancelled' | 'removed';
  attended: boolean;
  manuallyEdited: boolean;
  teacherId: string;
  roomId: string | null;
  periodId: string | null;
  startTime: string;
  endTime: string;
  offeringIds: string[];
}
export interface PlanInsert {
  routineSlotId: string; date: string; periodId: string; roomId: string | null;
  startTime: string; endTime: string; teacherId: string; offeringIds: string[];
}
export interface PlanUpdate {
  id: string; status?: 'scheduled'; teacherId: string; roomId: string | null; periodId: string;
  startTime: string; endTime: string; offeringIds: string[];
}
export interface PlanInput {
  dates: string[]; // Dhaka dates, already limited to the requested range
  today: string;
  slots: PlanSlot[];
  holidays: PlanHoliday[];
  specialDays: PlanSpecialDay[];
  existing: PlanExisting[];
}
export interface PlanResult { inserts: PlanInsert[]; updates: PlanUpdate[]; removals: string[] }

export const weekdayIndex = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

export function plan(input: PlanInput): PlanResult {
  const out: PlanResult = { inserts: [], updates: [], removals: [] };
  const touched = new Set<string>();
  const byKey = new Map<string, PlanExisting>();
  for (const m of input.existing) byKey.set(`${m.routineSlotId}|${m.originalDate ?? m.date}`, m);
  const slotById = new Map(input.slots.map((s) => [s.id, s]));

  for (const date of input.dates) {
    if (date < input.today) continue; // the past is never touched
    const holiday = input.holidays.some((h) => h.startDate <= date && date <= h.endDate);

    // Existing routine meetings whose slot is deleted (or gone) are removed when still untouched.
    for (const m of input.existing) {
      if ((m.originalDate ?? m.date) !== date) continue;
      const s = slotById.get(m.routineSlotId);
      if ((!s || s.deleted) && m.status === 'scheduled' && !m.attended && m.date >= input.today && !touched.has(m.id)) {
        touched.add(m.id);
        out.removals.push(m.id);
      }
    }

    for (const s of input.slots) {
      if (s.deleted || s.day !== weekdayIndex(date)) continue;
      const key = `${s.id}|${date}`;
      const existing = byKey.get(key);
      const first = s.offerings[0];
      let blocked = holiday || !first;
      if (!blocked && first) {
        const sd =
          input.specialDays.find((d) => d.date === date && d.sessionId === first.sessionId) ??
          input.specialDays.find((d) => d.date === date && d.sessionId === null);
        if (sd && !sd.periodIds.includes(s.periodId)) blocked = true;
      }
      if (blocked) {
        if (existing && existing.status === 'scheduled' && !existing.attended && !existing.manuallyEdited && !touched.has(existing.id)) {
          touched.add(existing.id);
          out.removals.push(existing.id);
        }
        continue;
      }
      const offeringIds = s.offerings.map((o) => o.id);
      const teacherId = first!.teacherId;
      if (!existing) {
        out.inserts.push({
          routineSlotId: s.id, date, periodId: s.periodId, roomId: s.roomId,
          startTime: s.startTime, endTime: s.endTime, teacherId, offeringIds,
        });
        continue;
      }
      if (existing.attended || existing.manuallyEdited || existing.status === 'cancelled' || existing.status === 'held') continue;
      const revive = existing.status === 'removed'; // removed by a holiday/special day that no longer applies
      const changed =
        existing.teacherId !== teacherId || existing.roomId !== s.roomId || existing.periodId !== s.periodId ||
        existing.startTime !== s.startTime || existing.endTime !== s.endTime || !sameSet(existing.offeringIds, offeringIds);
      if ((revive || changed) && !touched.has(existing.id)) {
        touched.add(existing.id);
        out.updates.push({
          id: existing.id, ...(revive ? { status: 'scheduled' as const } : {}), teacherId, roomId: s.roomId,
          periodId: s.periodId, startTime: s.startTime, endTime: s.endTime, offeringIds,
        });
      }
    }
  }
  return out;
}
