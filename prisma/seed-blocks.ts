/**
 * Demo BLOCKS (DEV / demo data only, idempotent):  npm run db:seed:blocks
 * A few students block a classmate (same section) so the blocked-users list and the hidden
 * messages in group / section chats can be seen. Fixed pairs derived from the ids; re-run changes nothing.
 * Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seeds do not run in production.');
  const prisma = new PrismaClient();
  try {
    const students = await prisma.studentProfile.findMany({ where: { user: { status: 'active' } }, select: { userId: true, sectionId: true }, orderBy: { userId: 'asc' } });
    const bySection = new Map<string, string[]>();
    for (const s of students) bySection.set(s.sectionId, [...(bySection.get(s.sectionId) ?? []), s.userId]);
    const data: { blockerId: string; blockedId: string }[] = [];
    for (const ids of bySection.values()) {
      if (ids.length < 4) continue;
      data.push({ blockerId: ids[0]!, blockedId: ids[1]! }, { blockerId: ids[2]!, blockedId: ids[1]! });
    }
    const { count } = await prisma.block.createMany({ data: data.slice(0, 12), skipDuplicates: true });
    console.log(`Blocks: ${count} added.`);
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
