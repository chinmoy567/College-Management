import fileType from 'file-type';
import sharp from 'sharp';
import { UPLOAD_LIMITS } from '@cms/shared';
import { AppError } from './http';

export type UploadKind = 'image' | 'document' | 'book_pdf' | 'routine';

const ALLOWED: Record<UploadKind, { mimes: string[]; maxBytes: number }> = {
  image: { mimes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: UPLOAD_LIMITS.imageBytes },
  document: {
    mimes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // file-type reports legacy .doc/.ppt and OOXML containers as these:
      'application/x-cfb',
      'application/zip',
    ],
    maxBytes: UPLOAD_LIMITS.documentBytes,
  },
  book_pdf: { mimes: ['application/pdf'], maxBytes: UPLOAD_LIMITS.bookPdfBytes },
  // Routine upload: a photo or a PDF of the timetable (PRD 5.17).
  routine: { mimes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], maxBytes: UPLOAD_LIMITS.documentBytes },
};

const OFFICE_EXT = new Set(['doc', 'docx', 'ppt', 'pptx']);

export interface ProcessedUpload {
  body: Buffer;
  ext: string;
  contentType: string;
}

/** Validates by real content (never the client's MIME or name); images are re-encoded (00 §7). */
export async function processUpload(kind: UploadKind, buffer: Buffer, originalName = ''): Promise<ProcessedUpload> {
  const rule = ALLOWED[kind];
  if (buffer.length === 0 || buffer.length > rule.maxBytes) {
    throw new AppError('VALIDATION_ERROR', 400, 'File is empty or too large.', { file: 'size' });
  }
  const type = await fileType.fromBuffer(buffer);
  const claimedExt = originalName.split('.').pop()?.toLowerCase() ?? '';
  const isOffice =
    kind === 'document' &&
    OFFICE_EXT.has(claimedExt) &&
    (type?.mime === 'application/x-cfb' || type?.mime === 'application/zip' || type?.ext === claimedExt);

  if (!isOffice && (!type || !rule.mimes.includes(type.mime) || type.mime === 'application/x-cfb' || type.mime === 'application/zip')) {
    throw new AppError('VALIDATION_ERROR', 400, 'This file type is not allowed.', { file: 'type' });
  }

  if (kind === 'image' || (kind === 'routine' && type!.mime.startsWith('image/'))) {
    // Rotate by EXIF, cap the long edge at 1600 px, WebP q80, metadata stripped (sharp drops it by default).
    const body = await sharp(buffer)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return { body, ext: 'webp', contentType: 'image/webp' };
  }
  if (isOffice) return { body: buffer, ext: claimedExt, contentType: 'application/octet-stream' };
  return { body: buffer, ext: type!.ext, contentType: type!.mime };
}
