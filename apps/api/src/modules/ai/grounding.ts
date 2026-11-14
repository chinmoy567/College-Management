import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { readObject } from '../../lib/files';
import type { Actor } from '../../lib/permissions';
import { materialWhere } from '../learning/materials';
import { chunkText, searchTerms } from './prompt';

const MAX_PAGES = 300;
const MAX_CHUNKS_PER_FILE = 400;
/** Per-file chunk numbers live in their own range, so a retry or a second PDF never clashes. */
const FILE_RANGE = 10_000;

/** Text of a PDF, page by page (pdfjs-dist legacy build, loaded lazily: memory on the free plan). Empty for scanned PDFs. */
export async function pdfText(buf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ').trim());
      page.cleanup();
    }
    return pages.filter(Boolean).join('\n\n');
  } finally {
    await task.destroy();
  }
}

/** The `material.extract_text` job: stores ~1,500-char chunks of one PDF file of a material (09 section 2.6). */
export async function extractMaterialText(materialId: string, fileId: string): Promise<number> {
  const m = await prisma.material.findFirst({
    where: { id: materialId, deletedAt: null },
    select: { courseId: true, files: { orderBy: { order: 'asc' }, select: { fileId: true } } },
  });
  const index = m?.files.findIndex((f) => f.fileId === fileId) ?? -1;
  if (!m || index < 0) return 0;
  // Postgres text cannot hold NUL characters, which some PDFs produce.
  const text = (await pdfText(await readObject(fileId))).split('\0').join('');
  const chunks = text.trim().length < 20 ? [] : chunkText(text).slice(0, MAX_CHUNKS_PER_FILE);
  const base = index * FILE_RANGE;
  await prisma.$transaction([
    prisma.materialChunk.deleteMany({ where: { materialId, chunkNo: { gte: base, lt: base + FILE_RANGE } } }),
    prisma.materialChunk.createMany({ data: chunks.map((content, i) => ({ materialId, courseId: m.courseId, chunkNo: base + i, content })) }),
  ]);
  return chunks.length;
}

/** Courses of the student's active enrollments. */
export async function studentCourseIds(studentId: string): Promise<string[]> {
  const rows = await prisma.enrollment.findMany({ where: { studentId, status: 'active' }, select: { courseOffering: { select: { courseId: true } } } });
  return [...new Set(rows.map((r) => r.courseOffering.courseId))];
}

/**
 * Top 3 chunks for the question, only from materials the student could open and courses they are enrolled in.
 * `courseId` narrows it further; a course the student is not in gives nothing.
 */
export async function groundingSnippets(actor: Actor, question: string, courseId?: string): Promise<string[]> {
  const terms = searchTerms(question);
  if (!terms) return [];
  let courses = await studentCourseIds(actor.id);
  if (courseId) courses = courses.filter((c) => c === courseId);
  if (!courses.length) return [];
  const visible = await prisma.material.findMany({
    where: { AND: [await materialWhere(actor), { courseId: { in: courses } }] },
    select: { id: true },
    take: 5000,
  });
  if (!visible.length) return [];
  const rows = await prisma.$queryRaw<{ content: string }[]>(Prisma.sql`
    SELECT c.content FROM material_chunks c
    WHERE c.material_id = ANY(${visible.map((v) => v.id)}) AND c.course_id = ANY(${courses})
      AND c.tsv @@ websearch_to_tsquery('simple', ${terms})
    ORDER BY ts_rank(c.tsv, websearch_to_tsquery('simple', ${terms})) DESC
    LIMIT 3`);
  return rows.map((r) => r.content);
}
