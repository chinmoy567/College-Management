export const SECTION_MAX = 30;
export const PIN_DAYS_DEFAULT = 7;
export const MAX_IMAGES = 10;
export const EXAM_DURATIONS = [15, 30, 45, 60, 90, 120] as const;

export const UPLOAD_LIMITS = {
  imageBytes: 5 * 1024 * 1024,
  documentBytes: 20 * 1024 * 1024,
  bookPdfBytes: 50 * 1024 * 1024,
} as const;

export const TEXT_LIMITS = {
  post: 5000,
  comment: 2000,
  message: 4000,
  noticeBody: 20000,
  aiPrompt: 4000,
} as const;

export const PAGINATION = { defaultLimit: 20, maxLimit: 50 } as const;
export const DISPLAY_TZ = 'Asia/Dhaka';
