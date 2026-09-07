import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';
import { closePool, ping } from './db/pool';

async function main(): Promise<void> {
  const app = createApp();
  try {
    await ping();
    logger.info('Database connection OK');
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Database connection FAILED at startup');
  }

  const server = app.listen(config.port, () => {
    logger.info(`PharmaZs API listening on http://localhost:${config.port}/api`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
