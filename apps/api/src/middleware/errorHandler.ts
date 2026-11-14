import type { ErrorRequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody, ErrorCode } from '@cms/shared';
import { AppError } from '../lib/http';
import { logger } from '../lib/logger';

function send(res: Response, status: number, code: ErrorCode, message: string, fields?: Record<string, string>) {
  const body: ApiErrorBody = { error: { code, message, ...(fields ? { fields } : {}) } };
  res.status(status).json(body);
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) return send(res, err.status, err.code, err.message, err.fields);
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of err.issues) fields[i.path.join('.') || '_'] ??= i.message;
    return send(res, 400, 'VALIDATION_ERROR', 'Some fields are invalid.', fields);
  }
  const e = err as { code?: unknown; type?: unknown } | null;
  if (e?.code === 'P2002') return send(res, 409, 'CONFLICT', 'This record already exists.');
  if (e?.code === 'P2025') return send(res, 404, 'NOT_FOUND', 'Not found.');
  if (e?.type === 'entity.parse.failed') return send(res, 400, 'VALIDATION_ERROR', 'Invalid JSON body.');
  // Stack stays in the server log only (CONV-01).
  logger.error({ err, reqId: (req as { id?: unknown }).id }, 'unhandled error');
  return send(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
};
