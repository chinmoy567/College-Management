import http from 'node:http';
import path from 'node:path';
import next from 'next';
import { loadConfig } from './config';
import { createApp } from './app';
import { logger } from './lib/logger';
import { prisma } from './db';
import { startJobs, stopJobs } from './jobs';
import { registerEmailWorker } from './modules/mail/queue';
import { registerMeetingJob } from './modules/schedule/job';
import { createSocketServer } from './modules/realtime/socket';

async function main() {
  const config = loadConfig();
  const dev = config.NODE_ENV !== 'production';
  const nextApp = next({ dev, dir: path.resolve(__dirname, '../../web') });
  await nextApp.prepare();

  const app = createApp({
    dev,
    nextHandler: nextApp.getRequestHandler(),
    supabaseOrigin: new URL(config.SUPABASE_URL).origin,
  });
  const server = http.createServer(app);
  const io = createSocketServer(server); // chat events arrive in M9
  await startJobs(config.DATABASE_URL);
  await registerEmailWorker();
  await registerMeetingJob();

  server.listen(config.PORT, () => logger.info({ port: config.PORT }, 'server listening'));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close();
    await stopJobs();
    await io.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal');
  process.exit(1);
});
