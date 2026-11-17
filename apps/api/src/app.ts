import { randomBytes, randomUUID } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { logger as defaultLogger } from './lib/logger';
import { errorHandler } from './middleware/errorHandler';
import { healthRouter } from './modules/health/routes';
import { AppError } from './lib/http';
import { authChain, csrfGuard } from './middleware/session';
import { authedAuthRouter, publicAuthRouter } from './modules/auth/routes';
import { meRouter } from './modules/me/routes';
import { academicsRouter } from './modules/academics/routes';
import { usersRouter } from './modules/users/routes';
import { adminStudentsRouter } from './modules/admin/students';
import { scheduleRouter } from './modules/schedule/routes';
import { adminAttendanceRouter, attendanceRouter } from './modules/attendance/routes';
import { adminExamsRouter, examsRouter } from './modules/exams/routes';
import { chatFilesRouter, chatRouter } from './modules/chat/routes';
import { publicCollegeRouter } from './modules/public/routes';
import { noticesRouter, publicNoticesRouter } from './modules/notices/routes';
import { notificationPrefsRouter, notificationsRouter } from './modules/notifications/routes';
import { materialsRouter, onlineClassesRouter } from './modules/learning/routes';
import { mentorRouter } from './modules/mentor/routes';
import { adminBooksRouter, booksRouter, publicBooksRouter } from './modules/books/routes';
import { E2E_FILES_PATH, E2E_STORAGE, e2eMemory } from './lib/files';
import { adminAiRouter, aiRouter } from './modules/ai/routes';
import { communityRouter, moderationRouter, publicProfileRouter, reportsRouter } from './modules/feed/routes';

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
    // Next.js takes the nonce for its own scripts from the request's CSP header, not from x-nonce.
    req.headers['content-security-policy'] = `script-src 'nonce-${nonce}'`;
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
          // The PDF reader runs pdf.js in a same-origin web worker (09 section 1.2).
          workerSrc: ["'self'", 'blob:'],
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

  app.use(cookieParser());
  app.use('/api/health', healthRouter);
  app.use('/api', csrfGuard);
  // Public auth routes first (never behind the session chain), then the session-protected ones.
  app.use('/api/auth', publicAuthRouter);
  app.use('/api/auth', authedAuthRouter);
  app.use('/api/public/notices', publicNoticesRouter);
  app.use('/api/public/books', publicBooksRouter);
  app.use('/api/public/college', publicCollegeRouter);
  app.use('/api/me', ...authChain, meRouter);
  app.use('/api/me', ...authChain, notificationPrefsRouter);
  app.use('/api/chat', ...authChain, chatRouter);
  app.use('/api/files', ...authChain, chatFilesRouter);
  app.use('/api/notices', ...authChain, noticesRouter);
  app.use('/api/notifications', ...authChain, notificationsRouter);
  app.use('/api/academics', ...authChain, academicsRouter);
  app.use('/api/users', ...authChain, publicProfileRouter);
  app.use('/api/users', ...authChain, usersRouter);
  app.use('/api/admin/books', ...authChain, adminBooksRouter);
  app.use('/api/admin/ai', ...authChain, adminAiRouter);
  app.use('/api/admin', ...authChain, adminStudentsRouter);
  app.use('/api/admin', ...authChain, adminAttendanceRouter);
  app.use('/api/admin', ...authChain, moderationRouter);
  app.use('/api/admin/exams', ...authChain, adminExamsRouter);
  app.use('/api/feed', ...authChain, communityRouter);
  app.use('/api/reports', ...authChain, reportsRouter);
  app.use('/api/schedule', ...authChain, scheduleRouter);
  app.use('/api/attendance', ...authChain, attendanceRouter);
  app.use('/api/exams', ...authChain, examsRouter);
  app.use('/api/classes/online', ...authChain, onlineClassesRouter);
  app.use('/api/materials', ...authChain, materialsRouter);
  app.use('/api/mentor', ...authChain, mentorRouter);
  app.use('/api/books', ...authChain, booksRouter);
  app.use('/api/ai', ...authChain, aiRouter);
  if (E2E_STORAGE)
    app.get(`${E2E_FILES_PATH}/:kind/:bucket/*`, (req, res) => {
      const buf = e2eMemory?.files.get(`${req.params.bucket}/${(req.params as Record<string, string>)[0]}`);
      if (!buf) return void res.status(404).end();
      res.type(/\.pdf$/.test(req.path) ? 'application/pdf' : /\.webp$/.test(req.path) ? 'image/webp' : 'application/octet-stream').send(buf);
    });
  app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', 404, 'Not found.')));

  const nextHandler = opts.nextHandler;
  if (nextHandler) app.all('*', (req, res) => void nextHandler(req, res));

  app.use(errorHandler);
  return app;
}
