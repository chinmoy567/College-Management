import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ErrorCode } from '@cms/shared';
import type { ZodTypeAny } from 'zod';

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public status: number,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler =
  (fn: Handler): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/** Parses with Zod (unknown keys stripped) and replaces req.body/query/params with the parsed value. */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    try {
      for (const key of ['body', 'query', 'params'] as const) {
        const schema = schemas[key];
        if (schema) {
          const parsed: unknown = schema.parse(req[key] ?? {});
          Object.defineProperty(req, key, { value: parsed, writable: true, configurable: true });
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
