import type { ApiErrorBody, ErrorCode } from '@cms/shared';

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    public status: number,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** 401 -> /login, FIRST_LOGIN_REQUIRED -> /complete-profile (Admin: /admin/setup) (FE-07). Wrong-password errors on the forms are left to the form. */
export function redirectFor(code: string | undefined, status: number, path: string): void {
  if (typeof window === 'undefined') return;
  const here = window.location.pathname;
  const target = code === 'FIRST_LOGIN_REQUIRED' ? (here.startsWith('/admin') ? '/admin/setup' : '/complete-profile') : status === 401 && code !== 'INVALID_CREDENTIALS' && !path.startsWith('/auth/login') ? '/login' : null;
  if (target && !here.startsWith(target.split('?')[0]!) && !PUBLIC_PATHS.some((p) => here === p)) window.location.assign(target);
}
const PUBLIC_PATHS = ['/', '/login', '/forgot-password', '/reset-password'];

/** Fetch wrapper: same-origin cookie, CSRF header on writes, parses the shared error shape. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: {
      'X-Requested-With': 'cms',
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    redirectFor(body?.error.code, res.status, path);
    throw new ApiError(
      body?.error.code ?? 'INTERNAL_ERROR',
      res.status,
      body?.error.message ?? 'Something went wrong.',
      body?.error.fields,
    );
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('json') ? res.json() : res.text()) as Promise<T>;
}
