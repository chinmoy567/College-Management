/**
 * Demo BOOK COVERS (DEV / demo data only, idempotent):  npm run db:seed:book-covers
 * Generates a simple cover (colour by group, title, author) for every book that has none and stores it
 * through the normal upload path (processUpload + the configured storage backend, public bucket).
 * With SUPABASE_URL set this uploads to that project's storage; without it the in-memory fake is used.
 * `--preview <dir>` only writes the first 3 PNGs into <dir> and uploads nothing.
 * Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { storeUpload } from '../apps/api/src/lib/files';

const COLORS: Record<string, [string, string]> = {
  science: ['#1d4ed8', '#0ea5e9'],
  commerce: ['#b45309', '#f59e0b'],
  arts: ['#be123c', '#fb7185'],
  common: ['#4338ca', '#a78bfa'],
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Greedy word wrap for the title (about `max` characters per line, at most `lines` lines). */
function wrap(text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/)) {
    if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1]!.replace(/.{0,2}$/, '…'); }
  return out;
}

export async function coverPng(title: string, author: string, group: string | null, level: string | null): Promise<Buffer> {
  const [a, b] = COLORS[group ?? 'common'] ?? COLORS.common!;
  const tl = wrap(title, 16, 5);
  const lines = tl.map((l, i) => `<text x="150" y="${150 + i * 34}" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" fill="#fff" text-anchor="middle">${esc(l)}</text>`).join('');
  const tag = [group ? group.toUpperCase() : '', level === 'c11' ? 'CLASS 11' : level === 'c12' ? 'CLASS 12' : level === 'both' ? 'CLASS 11-12' : ''].filter(Boolean).join('  ·  ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420" viewBox="0 0 300 420">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
  <rect width="300" height="420" fill="url(#g)"/><rect x="14" y="14" width="272" height="392" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2"/>
  <rect x="0" y="0" width="22" height="420" fill="#000" fill-opacity=".18"/>
  <text x="150" y="62" font-family="Arial, Helvetica, sans-serif" font-size="13" letter-spacing="2" fill="#fff" fill-opacity=".9" text-anchor="middle">${esc(tag)}</text>
  ${lines}
  <line x1="90" y1="352" x2="210" y2="352" stroke="#fff" stroke-opacity=".7"/>
  <text x="150" y="380" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#fff" text-anchor="middle">${esc(author.length > 28 ? author.slice(0, 27) + '…' : author)}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seeds do not run in production.');
  const prisma = new PrismaClient();
  try {
    const pi = process.argv.indexOf('--preview');
    const books = await prisma.book.findMany({ where: { coverId: null, archivedAt: null }, orderBy: { createdAt: 'asc' } });
    if (pi >= 0) {
      const dir = path.resolve(process.argv[pi + 1] ?? '.');
      fs.mkdirSync(dir, { recursive: true });
      for (const [i, b] of books.slice(0, 3).entries()) fs.writeFileSync(path.join(dir, `cover-${i + 1}.png`), await coverPng(b.title, b.author, b.groupType, b.classLevel));
      console.log(`Wrote ${Math.min(3, books.length)} preview covers to ${dir}. Nothing uploaded.`);
      return;
    }
    const admin = await prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true } });
    if (!admin) throw new Error('No Admin user. Run npm run db:seed first.');
    let n = 0;
    for (const b of books) {
      const png = await coverPng(b.title, b.author, b.groupType, b.classLevel);
      const coverId = await storeUpload(admin.id, 'book_cover', 'image', { buffer: png, originalname: 'cover.png' });
      await prisma.book.update({ where: { id: b.id }, data: { coverId } });
      n++;
    }
    console.log(`Covers: ${n} added (${books.length === 0 ? 'all books already have one' : 'books without a cover now have one'}).`);
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
