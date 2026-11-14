import { prisma } from '../../db';
import { dhakaDate, formatDhaka, toUtc } from '../../lib/time';
import { dateOnly, hhmmOf, timeDate } from './generate';

/** Online class ↔ meeting (04 §5). Called by the online-class service in M6. */
export async function attachOrCreateMeetings(onlineClass: { id: string; startAt: Date; durationMin: number; teacherId: string; offeringIds: string[] }): Promise<void> {
  const date = dhakaDate(onlineClass.startAt);
  const endAt = new Date(onlineClass.startAt.getTime() + onlineClass.durationMin * 60_000);
  const start = formatDhaka(onlineClass.startAt, 'HH:mm');
  const end = formatDhaka(endAt, 'HH:mm');
  for (const offeringId of onlineClass.offeringIds) {
    const candidates = await prisma.classMeeting.findMany({
      where: { date: dateOnly(date), status: 'scheduled', offerings: { some: { courseOfferingId: offeringId } } },
    });
    const hit = candidates.find((m) => {
      const s = toUtc(date, hhmmOf(m.startTime));
      const e = toUtc(date, hhmmOf(m.endTime));
      return s < endAt && onlineClass.startAt < e;
    });
    if (hit) {
      await prisma.classMeeting.update({ where: { id: hit.id }, data: { onlineClassId: onlineClass.id } });
    } else {
      await prisma.classMeeting.create({
        data: {
          date: dateOnly(date), startTime: timeDate(start), endTime: timeDate(end > start ? end : '23:59'),
          teacherId: onlineClass.teacherId, onlineClassId: onlineClass.id,
          offerings: { create: [{ courseOfferingId: offeringId }] },
        },
      });
    }
  }
}

/** Cancelling an online class: routine meetings stay (detached), created extra meetings go when nothing was marked. */
export async function detachOnlineClass(onlineClassId: string): Promise<void> {
  await prisma.classMeeting.updateMany({ where: { onlineClassId, routineSlotId: { not: null } }, data: { onlineClassId: null } });
  await prisma.classMeeting.updateMany({
    where: { onlineClassId, routineSlotId: null, attendanceTakenAt: null },
    data: { status: 'removed', onlineClassId: null },
  });
}
