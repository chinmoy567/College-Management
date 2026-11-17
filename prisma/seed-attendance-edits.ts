/**
 * Demo attendance EDITS (DEV / demo data only, idempotent):  npm run db:seed:attendance-edits
 * Teachers correct some attendance records after the fact, so the edit history on the attendance
 * pages has rows. Picks about 60 records from held meetings of the last 3 weeks, changes the status
 * (absent -> excused/present, late -> present, present -> late) and writes one AttendanceEdit
 * (fixed id, so a re-run changes nothing). Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { PrismaClient, type AttendanceStatus } from '@prisma/client';

const COUNT = 60;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
const NEXT: Record<AttendanceStatus, AttendanceStatus> = { absent: 'excused', late: 'present', present: 'late', excused: 'present' } as Record<AttendanceStatus, AttendanceStatus>;

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seeds do not run in production.');
  const prisma = new PrismaClient();
  try {
    if ((await prisma.attendanceEdit.count({ where: { id: { startsWith: 'demo-att-edit-' } } })) >= COUNT) { console.log('Attendance edits: already seeded.'); return; }
    const since = new Date(Date.now() - 21 * 86400000);
    const recs = await prisma.attendanceRecord.findMany({
      where: { classMeeting: { status: 'held', date: { gte: since } }, edits: { none: {} } },
      select: { id: true, status: true, markedBy: true, markedAt: true },
      take: 3000,
    });
    const chosen = recs.sort((a, b) => hash(a.id) - hash(b.id)).slice(0, COUNT);
    let n = 0;
    for (const r of chosen) {
      const to = NEXT[r.status];
      const editId = `demo-att-edit-${r.id}`;
      await prisma.$transaction([
        prisma.attendanceEdit.create({ data: { id: editId, attendanceRecordId: r.id, oldStatus: r.status, newStatus: to, editedBy: r.markedBy, editedAt: new Date(r.markedAt.getTime() + 3 * 3600000) } }),
        prisma.attendanceRecord.update({ where: { id: r.id }, data: { status: to } }),
      ]);
      n++;
    }
    console.log(`Attendance edits: ${n} added.`);
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
