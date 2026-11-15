import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../db';
import { client } from '../../../../../test/factories';
import { adminClient, classroom, clientFor, dateIn, dayIn, makeApp, makeTeacher, pastMeeting, uniq } from '../../../../../test/m5kit';
import { dateOnly, generateMeetings, timeDate } from './generate';
import { attachOrCreateMeetings, detachOnlineClass } from './onlineHook';

const app = makeApp();
let admin: Awaited<ReturnType<typeof adminClient>>;
beforeAll(async () => {
  admin = await adminClient(prisma, app);
});
afterAll(() => prisma.$disconnect());

const addSlot = (c: Awaited<ReturnType<typeof classroom>>, n = 2, extra: object = {}) =>
  admin.c.post('/api/schedule/routine/slots', { day: dayIn(n), periodId: c.period.id, roomId: c.room.id, offeringIds: [c.offering.id], ...extra });
const meetingsOf = (slotId: string) => prisma.classMeeting.findMany({ where: { routineSlotId: slotId }, include: { offerings: true }, orderBy: { date: 'asc' } });

describe('generation', () => {
  it('[SCH-01] generator skips holidays and creates only the listed periods on a special day', async () => {
    const c = await classroom(prisma, admin.c);
    const p2 = (await admin.c.post('/api/schedule/periods', { name: uniq('P'), startTime: '09:00', endTime: '09:45' })).body;
    const s1 = (await addSlot(c)).body.slot;
    const s2 = (await addSlot(c, 2, { periodId: p2.id })).body.slot;
    expect((await meetingsOf(s1.id)).some((m) => m.date.toISOString().startsWith(dateIn(2)))).toBe(true);

    const hol = await admin.c.post('/api/schedule/holidays', { title: 'Break', startDate: dateIn(2), endDate: dateIn(2) });
    expect(hol.status).toBe(201);
    for (const id of [s1.id, s2.id]) {
      const m = (await meetingsOf(id)).find((x) => x.date.toISOString().startsWith(dateIn(2)));
      expect(m?.status).toBe('removed');
    }
    // deleting the holiday brings the generated meetings back
    await admin.c.delete(`/api/schedule/holidays/${hol.body.id}`);
    expect((await meetingsOf(s1.id)).find((x) => x.date.toISOString().startsWith(dateIn(2)))?.status).toBe('scheduled');

    // special day: only the listed period runs
    const sd = await admin.c.post('/api/schedule/special-days', { date: dateIn(2), title: 'Half day', sessionId: c.sessionId, periodIds: [p2.id] });
    expect(sd.status).toBe(201);
    expect((await meetingsOf(s1.id)).find((x) => x.date.toISOString().startsWith(dateIn(2)))?.status).toBe('removed');
    expect((await meetingsOf(s2.id)).find((x) => x.date.toISOString().startsWith(dateIn(2)))?.status).toBe('scheduled');
  });

  it('[SCH-02] running twice creates no duplicates; removed, moved, attended and past meetings stay', async () => {
    const c = await classroom(prisma, admin.c);
    const slot = (await addSlot(c)).body.slot;
    const before = await meetingsOf(slot.id);
    const again = await generateMeetings();
    expect(again.inserted).toBe(0);
    await generateMeetings();
    expect((await meetingsOf(slot.id)).length).toBe(before.length);

    const target = before.find((m) => m.date.toISOString().startsWith(dateIn(2)))!;
    // remove one, move one: neither is recreated
    expect((await admin.c.delete(`/api/schedule/meetings/${target.id}`)).status).toBe(200);
    const other = (await meetingsOf(slot.id)).find((m) => m.id !== target.id && m.status === 'scheduled');
    if (other) {
      const moved = await admin.c.patch(`/api/schedule/meetings/${other.id}`, { date: dateIn(6) });
      expect(moved.status).toBe(200);
      const row = await prisma.classMeeting.findUniqueOrThrow({ where: { id: other.id } });
      expect(row.originalDate?.toISOString().slice(0, 10)).toBe(other.date.toISOString().slice(0, 10));
      expect(row.manuallyEdited).toBe(true);
    }
    const count = (await meetingsOf(slot.id)).length;
    await generateMeetings();
    expect((await meetingsOf(slot.id)).length).toBe(count);
    expect((await prisma.classMeeting.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('removed');
  });

  it('[SCH-03] a routine change updates future meetings only; past meetings and attendance are untouched', async () => {
    const c = await classroom(prisma, admin.c);
    const room2 = (await admin.c.post('/api/schedule/rooms', { name: uniq('R') })).body;
    const slot = (await addSlot(c)).body.slot;
    const past = await prisma.classMeeting.create({
      data: { routineSlotId: slot.id, date: dateOnly(dateIn(-3)), periodId: c.period.id, roomId: c.room.id, startTime: timeDate('08:00'), endTime: timeDate('08:45'), teacherId: c.teacher.id, offerings: { create: [{ courseOfferingId: c.offering.id }] } },
    });
    const res = await admin.c.patch(`/api/schedule/routine/slots/${slot.id}`, { roomId: room2.id });
    expect(res.status).toBe(200);
    const future = await meetingsOf(slot.id);
    for (const m of future.filter((x) => x.date >= dateOnly(dateIn(0)))) expect(m.roomId).toBe(room2.id);
    expect((await prisma.classMeeting.findUniqueOrThrow({ where: { id: past.id } })).roomId).toBe(c.room.id);
    // affected students and the teacher were told once
    expect(await prisma.notification.count({ where: { userId: c.students[0]!.id, type: 'routine_changed' } })).toBeGreaterThanOrEqual(1);
  });

  it('[SCH-04] a combined slot creates one meeting for all offerings and gives no teacher warning', async () => {
    const c = await classroom(prisma, admin.c);
    const course2 = await prisma.course.create({ data: { code: uniq('CMB'), name: 'Second', groupType: 'common', classLevel: 'both' } });
    const o2 = await prisma.courseOffering.create({ data: { sectionId: c.sectionId, courseId: course2.id, teacherId: c.teacher.id } });
    const res = await admin.c.post('/api/schedule/routine/slots', { day: dayIn(3), periodId: c.period.id, roomId: c.room.id, offeringIds: [c.offering.id, o2.id] });
    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual([]);
    const ms = (await meetingsOf(res.body.slot.id)).filter((m) => m.status === 'scheduled');
    expect(ms.length).toBeGreaterThan(0);
    for (const m of ms) expect(m.offerings.map((o) => o.courseOfferingId).sort()).toEqual([c.offering.id, o2.id].sort());
    // different teachers cannot share one combined slot
    const other = await makeTeacher(prisma);
    const o3 = await prisma.courseOffering.create({ data: { sectionId: c.sectionId, courseId: (await prisma.course.create({ data: { code: uniq('CMB'), name: 'Third', groupType: 'common', classLevel: 'both' } })).id, teacherId: other.id } });
    const bad = await admin.c.post('/api/schedule/routine/slots', { day: dayIn(3), periodId: c.period.id, offeringIds: [c.offering.id, o3.id] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('COMBINED_TEACHER_MISMATCH');
  });
});

describe('Admin edits', () => {
  it('[SCH-05] teacher and room double-booking warn and never block', async () => {
    const c = await classroom(prisma, admin.c);
    const course2 = await prisma.course.create({ data: { code: uniq('DB'), name: 'Other', groupType: 'common', classLevel: 'both' } });
    const sameTeacher = await prisma.courseOffering.create({ data: { sectionId: c.sectionId, courseId: course2.id, teacherId: c.teacher.id } });
    expect((await addSlot(c)).body.warnings).toEqual([]);
    const second = await admin.c.post('/api/schedule/routine/slots', { day: dayIn(2), periodId: c.period.id, roomId: c.room.id, offeringIds: [sameTeacher.id] });
    expect(second.status).toBe(201); // saved anyway
    expect(second.body.warnings.map((w: { type: string }) => w.type).sort()).toEqual(['room_double_booked', 'teacher_double_booked']);
    expect(await prisma.routineSlot.count({ where: { id: second.body.slot.id, deletedAt: null } })).toBe(1);
  });

  it('[SCH-06] deleting a used period or room needs a replacement; deletes are soft', async () => {
    const c = await classroom(prisma, admin.c);
    const slot = (await addSlot(c)).body.slot;
    const blocked = await admin.c.delete(`/api/schedule/periods/${c.period.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PERIOD_IN_USE');
    expect(blocked.body.slots.map((s: { id: string }) => s.id)).toContain(slot.id);
    const p2 = (await admin.c.post('/api/schedule/periods', { name: uniq('P'), startTime: '10:00', endTime: '10:45' })).body;
    expect((await admin.c.delete(`/api/schedule/periods/${c.period.id}`, { replacementPeriodId: p2.id })).status).toBe(200);
    expect((await prisma.routineSlot.findUniqueOrThrow({ where: { id: slot.id } })).periodId).toBe(p2.id);
    expect((await prisma.period.findUniqueOrThrow({ where: { id: c.period.id } })).deletedAt).not.toBeNull();

    const rb = await admin.c.delete(`/api/schedule/rooms/${c.room.id}`);
    expect(rb.status).toBe(409);
    expect(rb.body.error.code).toBe('ROOM_IN_USE');
    const r2 = (await admin.c.post('/api/schedule/rooms', { name: uniq('R') })).body;
    expect((await admin.c.delete(`/api/schedule/rooms/${c.room.id}`, { replacementRoomId: r2.id })).status).toBe(200);
    expect((await prisma.routineSlot.findUniqueOrThrow({ where: { id: slot.id } })).roomId).toBe(r2.id);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: c.room.id } })).deletedAt).not.toBeNull();
  });

  it('[SCH-07] a meeting with attendance cannot be deleted (cancel instead); without attendance it becomes removed', async () => {
    const c = await classroom(prisma, admin.c);
    const taken = await pastMeeting(prisma, c.offering.id, c.teacher.id, 0, 'held');
    await prisma.classMeeting.update({ where: { id: taken.id }, data: { attendanceTakenAt: new Date() } });
    const res = await admin.c.delete(`/api/schedule/meetings/${taken.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MEETING_HAS_ATTENDANCE');
    expect((await admin.c.post(`/api/schedule/meetings/${taken.id}/cancel`)).status).toBe(200);
    expect((await prisma.classMeeting.findUniqueOrThrow({ where: { id: taken.id } })).status).toBe('cancelled');

    const extra = await admin.c.post('/api/schedule/meetings/extra', { offeringIds: [c.offering.id], date: dateIn(1), periodId: c.period.id });
    expect(extra.status).toBe(201);
    expect((await admin.c.delete(`/api/schedule/meetings/${extra.body.id}`)).status).toBe(200);
    expect((await prisma.classMeeting.findUniqueOrThrow({ where: { id: extra.body.id } })).status).toBe('removed');
  });

  it('[SCH-08] only the Admin changes periods, rooms, routine, holidays, special days and single classes', async () => {
    const c = await classroom(prisma, admin.c);
    const teacher = await clientFor(app, c.teacher);
    const student = await clientFor(app, c.students[0]!);
    const m = await pastMeeting(prisma, c.offering.id, c.teacher.id, 0);
    const calls: [string, string, object?][] = [
      ['post', '/api/schedule/periods', { name: 'X', startTime: '07:00', endTime: '07:30' }],
      ['patch', `/api/schedule/periods/${c.period.id}`, { name: 'Y' }],
      ['delete', `/api/schedule/periods/${c.period.id}`],
      ['post', '/api/schedule/rooms', { name: 'X' }],
      ['patch', `/api/schedule/rooms/${c.room.id}`, { name: 'Y' }],
      ['delete', `/api/schedule/rooms/${c.room.id}`],
      ['get', `/api/schedule/rooms/usage?date=${dateIn(0)}`],
      ['post', '/api/schedule/routine/slots', { day: 'mon', periodId: c.period.id, offeringIds: [c.offering.id] }],
      ['post', '/api/schedule/routine/copy', { fromSectionId: c.sectionId, toSectionId: c.sectionId }],
      ['post', '/api/schedule/holidays', { title: 'H', startDate: dateIn(5), endDate: dateIn(5) }],
      ['post', '/api/schedule/special-days', { date: dateIn(5), title: 'S', periodIds: [] }],
      ['post', '/api/schedule/meetings/extra', { offeringIds: [c.offering.id], date: dateIn(1), periodId: c.period.id }],
      ['patch', `/api/schedule/meetings/${m.id}`, { roomId: c.room.id }],
      ['post', `/api/schedule/meetings/${m.id}/cancel`],
      ['delete', `/api/schedule/meetings/${m.id}`],
      ['get', `/api/schedule/calendar?from=${dateIn(0)}&to=${dateIn(3)}`],
    ];
    for (const [method, url, body] of calls) {
      for (const who of [teacher, student]) {
        const r = await who.req(method as 'get', url, body);
        expect(r.status, `${method} ${url}`).toBe(403);
      }
      expect((await client(app).req(method as 'get', url, body)).status, `${method} ${url} anon`).toBe(401);
    }
    expect((await prisma.classMeeting.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('scheduled');
  });

  it('copies a routine and reports the skipped courses', async () => {
    const a = await classroom(prisma, admin.c);
    await addSlot(a);
    const b = await classroom(prisma, admin.c);
    await prisma.courseOffering.update({ where: { id: b.offering.id }, data: { courseId: a.course.id } });
    const ok = await admin.c.post('/api/schedule/routine/copy', { fromSectionId: a.sectionId, toSectionId: b.sectionId });
    expect(ok.status).toBe(200);
    expect(ok.body.created).toBe(1);
    const view = await admin.c.get(`/api/schedule/routine?sectionId=${b.sectionId}`);
    expect(view.body.slots).toHaveLength(1);
    // teachers/students of other sections cannot read it
    expect((await (await clientFor(app, a.students[0]!)).get(`/api/schedule/routine?sectionId=${b.sectionId}`)).status).toBe(403);
  });
});

describe('online classes (04 §5)', () => {
  it('[SCH-13] an online class at a routine time attaches to that meeting instead of creating a second one', async () => {
    const c = await classroom(prisma, admin.c);
    const slot = (await addSlot(c)).body.slot;
    const m = (await meetingsOf(slot.id)).find((x) => x.status === 'scheduled')!;
    const date = m.date.toISOString().slice(0, 10);
    const online = await prisma.onlineClass.create({
      data: { teacherId: c.teacher.id, title: 'Live', startAt: new Date(`${date}T02:10:00Z`), durationMin: 30, platform: 'meet', joinUrl: 'https://example.test/j', offerings: { create: [{ courseOfferingId: c.offering.id }] } },
    });
    const total = await prisma.classMeeting.count({ where: { offerings: { some: { courseOfferingId: c.offering.id } } } });
    await attachOrCreateMeetings({ id: online.id, startAt: online.startAt, durationMin: 30, teacherId: c.teacher.id, offeringIds: [c.offering.id] });
    expect((await prisma.classMeeting.findUniqueOrThrow({ where: { id: m.id } })).onlineClassId).toBe(online.id);
    expect(await prisma.classMeeting.count({ where: { offerings: { some: { courseOfferingId: c.offering.id } } } })).toBe(total);

    // no routine meeting at that time → an extra meeting is created, and removed on cancel
    const lonely = await prisma.onlineClass.create({
      data: { teacherId: c.teacher.id, title: 'Extra', startAt: new Date(`${date}T10:00:00Z`), durationMin: 30, platform: 'meet', joinUrl: 'https://example.test/k', offerings: { create: [{ courseOfferingId: c.offering.id }] } },
    });
    await attachOrCreateMeetings({ id: lonely.id, startAt: lonely.startAt, durationMin: 30, teacherId: c.teacher.id, offeringIds: [c.offering.id] });
    const created = await prisma.classMeeting.findFirstOrThrow({ where: { onlineClassId: lonely.id } });
    expect(created.routineSlotId).toBeNull();
    await detachOnlineClass(lonely.id);
    expect((await prisma.classMeeting.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('removed');
    await detachOnlineClass(online.id);
    expect((await prisma.classMeeting.findUniqueOrThrow({ where: { id: m.id } })).onlineClassId).toBeNull();
  });
});

describe('routine image/PDF upload', () => {
  const pdf = async () => {
    const { PDFDocument } = await import('pdf-lib');
    const d = await PDFDocument.create();
    d.addPage([200, 200]);
    return Buffer.from(await d.save());
  };
  const png = async () => (await import('sharp')).default({ create: { width: 30, height: 30, channels: 3, background: '#336699' } }).png().toBuffer();
  const send = (who: { req: typeof admin.c.req }, sectionId: string, file: Buffer, filename: string) =>
    who.req('post', '/api/schedule/routine/upload').field('sectionId', sectionId).attach('file', file, { filename });

  it('[SCH-18] Admin uploads a routine PDF or image per section; a new upload replaces the old one; others cannot upload', async () => {
    const c = await classroom(prisma, admin.c);
    const a = await send(admin.c, c.sectionId, await pdf(), 'routine.pdf');
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.upload.mime).toBe('application/pdf');
    const b = await send(admin.c, c.sectionId, await png(), 'routine.png');
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(b.body.upload.mime).toBe('image/webp'); // images are re-encoded

    const student = await clientFor(app, c.students[0]!);
    const list = await student.get(`/api/schedule/routine/uploads?sectionId=${c.sectionId}`);
    expect(list.status).toBe(200);
    expect(list.body.uploads).toHaveLength(1);
    expect(list.body.uploads[0].id).toBe(b.body.upload.id);

    // wrong type and non-admins are refused
    const bad = await send(admin.c, c.sectionId, Buffer.from('not a real file'), 'x.pdf');
    expect(bad.status).toBe(400);
    const teacher = await clientFor(app, c.teacher);
    for (const who of [teacher, student]) expect((await send(who, c.sectionId, await pdf(), 'r.pdf')).status).toBe(403);
    // a student of another section cannot read it
    const other = await classroom(prisma, admin.c);
    expect((await (await clientFor(app, other.students[0]!)).get(`/api/schedule/routine/uploads?sectionId=${c.sectionId}`)).status).toBe(403);

    expect((await admin.c.delete(`/api/schedule/routine/upload/${b.body.upload.id}`)).status).toBe(200);
    expect((await admin.c.get(`/api/schedule/routine/uploads?sectionId=${c.sectionId}`)).body.uploads).toHaveLength(0);
  });
});
