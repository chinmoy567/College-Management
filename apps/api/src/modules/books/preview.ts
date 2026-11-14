import { AppError } from '../../lib/http';

/** Thrown when the chosen pages do not fit the PDF; retrying cannot help. */
export class PreviewPagesError extends AppError {
  constructor(public pageCount: number) {
    super('VALIDATION_ERROR', 400, `The PDF has ${pageCount} pages; choose preview pages inside that range.`, { previewPages: 'range' });
  }
}

/** Copies the listed 1-based pages into a new PDF (pdf-lib is loaded lazily: memory on the free plan). */
export async function buildPreviewPdf(pdf: Buffer, pages: number[]): Promise<Buffer> {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(pdf, { updateMetadata: false });
  const count = src.getPageCount();
  if (!pages.length || pages.some((p) => p < 1 || p > count)) throw new PreviewPagesError(count);
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(src, pages.map((p) => p - 1))) out.addPage(page);
  return Buffer.from(await out.save());
}
