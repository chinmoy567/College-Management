export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'FIRST_LOGIN_REQUIRED',
  'NOT_FOUND',
  'CONFLICT',
  'SECTION_FULL',
  'EXAM_LOCKED',
  'ATTEMPT_IN_PROGRESS',
  'TOKEN_EXPIRED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; fields?: Record<string, string> };
}
