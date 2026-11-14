import { randomBytes, randomUUID } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { logger as defaultLogger } from './lib/logger';
import { errorHandler } from './middleware/errorHandler';
import { healthRouter } from './modules/health/routes';
import { AppError } from './lib/http';

export interface AppOptions {
  /** Hand non-API requests to Next.js. */
  nextHandler?: (req: Request, res: Response) => unknown;
  dev?: boolean;
  supabaseOrigin?: string;
  /** Override the request logger (tests capture its output). */
  logger?: Logger;
}

export function createApp(opts: AppOptions = {}): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Per-request nonce, forwarded to Next in the x-nonce request header.
  app.use((req, res, next) => {
    const nonce = randomBytes(16).toString('base64');
    res.locals.nonce = nonce;
    req.headers['x-nonce'] = nonce;
    next();
  });

  const supa = opts.supabaseOrigin ? [opts.supabaseOrigin] : [];
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            (_req, res) => `'nonce-${(res as Response).locals.nonce as string}'`,
            "'strict-dynamic'",
            ...(opts.dev ? ["'unsafe-eval'"] : []),
          ],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', ...supa],
          frameSrc: ['https://www.youtube-nocookie.com', 'https://drive.google.com'],
          connectSrc: ["'self'", 'wss:', ...supa],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
        },
      },
    }),
  );

  app.use((req, res, next) => {
    const id = randomUUID();
    res.setHeader('x-request-id', id);
    (req as Request & { id: string }).id = id;
    next();
  });
  app.use(
    pinoHttp({
      logger: opts.logger ?? defaultLogger,
      genReqId: (req) => (req as Request & { id: string }).id,
      // Request bodies are never logged (CONV-06); only method + path.
      serializers: {
        req: (r: { id: string; method: string; url?: string }) => ({
          id: r.id,
          method: r.method,
          url: r.url?.split('?')[0],
        }),
        res: (r: { statusCode: number }) => ({ statusCode: r.statusCode }),
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRouter);
  app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', 404, 'Not found.')));

  const nextHandler = opts.nextHandler;
  if (nextHandler) app.all('*', (req, res) => void nextHandler(req, res));

  app.use(errorHandler);
  return app;
}
