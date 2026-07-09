import { startHorizonStream } from './indexer/horizon.js';
import { startSorobanPoller } from './indexer/soroban.js';
import { logger } from './shared/logger.js';
import { closeDb } from './shared/db.js';
import { closeRedis } from './shared/redis.js';
import { closeQueues } from './shared/queue.js';
import { config } from './shared/config.js';

/**
 * Ingestion process — separate from the API and worker processes so a slow Horizon/Soroban
 * connection can never block request latency or job processing. Run via `npm run indexer`.
 */

const trackedContracts = config.contracts.registryAnchorId
  ? [config.contracts.registryAnchorId, ...(config.contracts.insurancePoolId ? [config.contracts.insurancePoolId] : [])]
  : [];

const stopHorizon = startHorizonStream();
const stopSoroban = trackedContracts.length > 0 ? startSorobanPoller(trackedContracts) : null;

if (!stopSoroban) {
  logger.warn('no contract IDs configured — Soroban event polling disabled');
}

logger.info('indexer started');

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'indexer shutting down');
  stopHorizon();
  stopSoroban?.();
  await Promise.all([closeDb(), closeRedis(), closeQueues()]);
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
