import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomToken } from '../../lib/crypto';

export interface Slip {
  role: 'student' | 'teacher';
  name: string;
  loginId: string;
  password: string;
  /** "2024–25 · Science · 11-A" for students. */
  placement?: string;
}

/** Spreadsheet formula guard: a cell that starts with = + - @ is read as a formula by Excel. */
const cell = (v: string): string => {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** UTF-8 with BOM so Excel shows Bangla names correctly. */
export function slipsCsv(slips: Slip[]): Buffer {
  const lines = [['role', 'name', 'loginId', 'password', 'placement'].join(',')];
  for (const s of slips) lines.push([s.role, s.name, s.loginId, s.password, s.placement ?? ''].map(cell).join(','));
  return Buffer.concat([Buffer.from('﻿', 'utf8'), Buffer.from(lines.join('\r\n') + '\r\n', 'utf8')]);
}

const FONT = process.env.SLIP_FONT_PATH ?? path.resolve(__dirname, '../../../assets/NotoSansBengali-Regular.ttf');

/** Printable slips, 6 per A4 page. pdfkit is loaded lazily (memory on the free plan). */
export async function slipsPdf(slips: Slip[]): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const hasBangla = existsSync(FONT);
  if (hasBangla) doc.registerFont('body', FONT);
  const body = hasBangla ? 'body' : 'Helvetica';
  const bold = hasBangla ? 'body' : 'Helvetica-Bold';
  const w = (doc.page.width - 72 - 12) / 2;
  const h = (doc.page.height - 72 - 24) / 3;
  slips.forEach((s, i) => {
    if (i > 0 && i % 6 === 0) doc.addPage();
    const pos = i % 6;
    const x = 36 + (pos % 2) * (w + 12);
    const y = 36 + Math.floor(pos / 2) * (h + 12);
    doc.rect(x, y, w, h).dash(3, { space: 3 }).stroke().undash();
    doc.font(bold).fontSize(12).text('College login slip', x + 10, y + 10, { width: w - 20 });
    doc.font(body).fontSize(10).text(`${s.role === 'student' ? 'Student' : 'Teacher'}: ${s.name}`, x + 10, y + 34, { width: w - 20 });
    if (s.placement) doc.text(s.placement, x + 10, y + 50, { width: w - 20 });
    doc.font(bold).fontSize(11).text(`Login ID: ${s.loginId}`, x + 10, y + 74, { width: w - 20 });
    doc.text(`Password: ${s.password}`, x + 10, y + 92, { width: w - 20 });
    doc.font(body).fontSize(8).text('You must change this password and complete your profile on first login. Keep this slip private.', x + 10, y + 118, { width: w - 20 });
  });
  if (!slips.length) doc.text('No accounts.');
  doc.end();
  return done;
}

// ───── one-time download store (not persisted; memory only, 15 minutes) ─────
const TTL_MS = 15 * 60 * 1000;
interface Entry {
  actorId: string;
  slips: Slip[];
  expires: number;
  taken: Set<'pdf' | 'csv'>;
}
const store = new Map<string, Entry>();

export function stashSlips(actorId: string, slips: Slip[]): { token: string; expiresAt: Date } {
  const now = Date.now();
  for (const [k, e] of store) if (e.expires < now) store.delete(k);
  const token = randomToken(24);
  store.set(token, { actorId, slips, expires: now + TTL_MS, taken: new Set() });
  return { token, expiresAt: new Date(now + TTL_MS) };
}

/** Each format can be downloaded once; the passwords are dropped from memory after both (or the TTL). */
export async function takeSlips(actorId: string, token: string, format: 'pdf' | 'csv'): Promise<Buffer | null> {
  const e = store.get(token);
  if (!e || e.expires < Date.now() || e.actorId !== actorId || e.taken.has(format)) return null;
  e.taken.add(format);
  const out = format === 'pdf' ? await slipsPdf(e.slips) : slipsCsv(e.slips);
  if (e.taken.size === 2) store.delete(token);
  return out;
}
