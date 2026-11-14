import { z } from 'zod';
import { id } from './common';

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().min(1).max(max).optional());
const optId = z.preprocess((v) => (v === '' ? undefined : v), id.optional());

/** Pages like "1-5,9" (1-based), sorted and de-duplicated. Returns null when the text is not a valid list. */
export function parsePreviewPages(input: string): number[] | null {
  const text = input.trim();
  if (text === '') return [];
  const pages = new Set<number>();
  for (const part of text.split(',')) {
    const m = /^\s*(\d{1,5})\s*(?:-\s*(\d{1,5}))?\s*$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || b < a || b - a > 500) return null;
    for (let p = a; p <= b; p++) pages.add(p);
    if (pages.size > 500) return null;
  }
  return [...pages].sort((x, y) => x - y);
}

const previewPagesField = z
  .string()
  .max(200)
  .default('')
  .refine((v) => parsePreviewPages(v) !== null, 'Use page numbers like 1-5,9');

const bookFields = {
  title: text(200),
  author: text(200),
  publisher: optText(200),
  courseId: optId,
  groupType: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['science', 'commerce', 'arts', 'common']).optional()),
  classLevel: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['c11', 'c12', 'both']).optional()),
  description: optText(4000),
  price: z.coerce.number().min(0).max(1_000_000).transform((n) => Math.round(n * 100) / 100),
  previewPages: previewPagesField,
};

export const bookCreateBody = z.object(bookFields);
export type BookCreateBody = z.infer<typeof bookCreateBody>;

export const bookUpdateBody = z
  .object({ ...bookFields, courseId: z.preprocess((v) => (v === '' ? null : v), id.nullable()) })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change.');
export type BookUpdateBody = z.infer<typeof bookUpdateBody>;

export const bookListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  groupType: z.enum(['science', 'commerce', 'arts', 'common']).optional(),
  courseId: id.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const bookPayBody = z.object({ confirm: z.literal(true) });
export const bookPdfQuery = z.object({ download: z.enum(['0', '1']).default('0') });

export const purchaseListQuery = z.object({
  bookId: id.optional(),
  studentId: id.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  format: z.enum(['json', 'csv']).default('json'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
