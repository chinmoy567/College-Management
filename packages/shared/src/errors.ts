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
  'SESSION_CLOSED',
  'SECTION_NOT_EMPTY',
  'CHAPTER_IN_USE',
  'TOKEN_EXPIRED',
  'SESSION_ENDED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_INACTIVE',
  'ACCOUNT_PASSED_OUT',
  'INVALID_CODE',
  'STEP_UP_REQUIRED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; fields?: Record<string, string> };
}
