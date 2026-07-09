import { buildApp } from './api/app.js';
import { config } from './shared/config.js';
import { logger } from './shared/logger.js';
import { closeDb } from './shared/db.js';
import { closeRedis } from './shared/redis.js';
import { closeQueues } from './shared/queue.js';

async function main(): Promise<void> {
  const app = await buildApp();

  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ port: config.port, env: config.env }, 'astraguard-backend listening');

  // Indexer streams (src/indexer-runner.ts) and queue workers (src/workers.ts) run as separate
  // processes so the API can scale independently of ingestion/scoring load.

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    await Promise.all([closeDb(), closeRedis(), closeQueues()]);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
