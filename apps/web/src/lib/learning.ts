import type { ApiErrorBody } from '@cms/shared';
import { ApiError } from './api';

export interface OnlineClassRow {
  id: string; title: string; topic: string | null; description: string | null; startAt: string; durationMin: number;
  platform: 'meet' | 'jitsi' | 'other'; status: 'scheduled' | 'live' | 'ended' | 'cancelled'; teacher: string;
  offerings: { id: string; course: string; section: string }[]; joinUrl?: string; joinOpen: boolean;
}
export interface RecordingRow {
  id: string; title: string; description: string | null; courseId: string; course: string; chapterId: string | null; chapter: string | null;
  visibility: 'section' | 'college'; source: 'youtube' | 'drive'; url: string; embedUrl: string; mine: boolean; watched?: boolean;
}
export interface MaterialFileRow { id: string; name: string; mime: string; size: number; inline: boolean }
export interface MaterialRow {
  id: string; scope: 'offering' | 'section' | 'group' | 'college'; title: string; description: string | null; linkUrl: string | null;
  courseId: string | null; course: string | null; chapterId: string | null; chapter: string | null; chapterOrder: number | null; mine: boolean; files: MaterialFileRow[];
}
export interface PreviousRow {
  id: string; courseId: string; course: string; year: number; examType: string; board: string | null; mine: boolean;
  files: { id: string; name: string; mime: string }[]; solutionId: string | null;
}
export interface ChapterRow { id: string; name: string; order: number }
export interface CourseRow { id: string; code: string; name: string }

export const EXAM_TYPES: [string, string][] = [
  ['hsc_board', 'HSC Board'], ['test', 'Test'], ['pre_test', 'Pre-test'], ['half_yearly', 'Half-yearly'], ['model_test', 'Model test'],
];
export const examTypeLabel = (v: string): string => EXAM_TYPES.find(([k]) => k === v)?.[1] ?? v;
export const SCOPE_LABEL: Record<string, string> = { offering: 'My course', section: 'Section', group: 'Group', college: 'Whole college' };

/** Opens through the API, which checks permission and redirects to a short-lived signed URL. */
export const materialFileHref = (id: string, fileId: string, action: 'view' | 'download' = 'view'): string => `/api/materials/${id}/files/${fileId}?action=${action}`;
export const previousFileHref = (id: string, fileId: string, action: 'view' | 'download' = 'view'): string => `/api/materials/previous-questions/${id}/files/${fileId}?action=${action}`;

/** multipart POST with upload progress (fetch has none). Sends the same CSRF header as api(). */
export function uploadForm<T>(path: string, form: FormData, onProgress: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `/api${path}`);
    x.withCredentials = true;
    x.setRequestHeader('X-Requested-With', 'cms');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onerror = () => reject(new ApiError('INTERNAL_ERROR', 0, 'Network problem. Try again.'));
    x.onload = () => {
      let body: unknown = null;
      try { body = JSON.parse(x.responseText); } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300) return resolve(body as T);
      const e = (body as ApiErrorBody | null)?.error;
      reject(new ApiError(e?.code ?? 'INTERNAL_ERROR', x.status, e?.message ?? 'Something went wrong.', e?.fields));
    };
    x.send(form);
  });
}

export const bytes = (n: number): string => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
