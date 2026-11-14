import { existsSync } from 'node:fs';
import path from 'node:path';

const FONT = process.env.SLIP_FONT_PATH ?? path.resolve(__dirname, '../../../assets/NotoSansBengali-Regular.ttf');

/** Spreadsheet formula guard: a cell that starts with = + - @ is read as a formula by Excel. */
export const csvCell = (v: string | number | null | undefined): string => {
  const s = v === null || v === undefined ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
/** UTF-8 with BOM so Excel shows Bangla correctly. */
export const csvFile = (rows: (string | number | null | undefined)[][]): Buffer =>
  Buffer.concat([Buffer.from('﻿', 'utf8'), Buffer.from(rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8')]);

export type PdfBlock = { h: string } | { p: string } | { table: string[][]; widths: number[] };

/** A small text-and-table PDF (pdfkit is loaded lazily, memory on the free plan). */
export async function simplePdf(title: string, blocks: PdfBlock[]): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const bangla = existsSync(FONT);
  if (bangla) doc.registerFont('body', FONT);
  const font = bangla ? 'body' : 'Helvetica';
  doc.font(font).fontSize(16).text(title);
  doc.moveDown(0.5);
  for (const b of blocks) {
    if ('h' in b) doc.moveDown(0.5).font(font).fontSize(12).text(b.h);
    else if ('p' in b) doc.font(font).fontSize(10).text(b.p);
    else {
      doc.font(font).fontSize(9);
      for (const row of b.table) {
        if (doc.y > doc.page.height - 70) doc.addPage();
        const y = doc.y;
        let x = 40;
        row.forEach((cell, i) => {
          doc.text(cell, x, y, { width: b.widths[i]! - 4, lineBreak: false, ellipsis: true });
          x += b.widths[i]!;
        });
        doc.x = 40;
        doc.y = y + 14;
      }
    }
  }
  doc.end();
  return done;
}
