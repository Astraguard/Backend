import { createHash } from 'node:crypto';
import { db } from '../shared/db.js';
import { redis, scanCacheKey } from '../shared/redis.js';
import { childLogger } from '../shared/logger.js';
import { getQueue, QUEUE_NAMES } from '../shared/queue.js';
import { anchorRegistryFlag } from '../safetynet/oracle.js';
import { getReport } from './reports.js';

const log = childLogger('registry:propagation');

/**
 * Confirmed-flag fanout per ARCHITECTURE.md §2.3:
 *  1. Instant effect: overwrite the scan cache so the extension sees "danger" immediately.
 *  2. Durable + auditable: anchor a hash of the flag record on-chain via the oracle.
 * Only the hash is anchored — evidence stays off-chain (may contain victim data).
 */
export async function propagateConfirmedFlag(reportId: string): Promise<void> {
  const report = await getReport(reportId);
  if (report.status !== 'confirmed') {
    log.warn({ reportId, status: report.status }, 'propagation requested for non-confirmed report');
    return;
  }

  await redis.set(
    scanCacheKey(report.targetAddress),
    JSON.stringify({ verdict: 'danger', reasons: [`registry:${report.category}`] }),
    'EX',
    60 * 60 * 24, // confirmed flags are sticky for a day even if the score cache would expire sooner
  );

  const recordHash = createHash('sha256')
    .update(`${report.id}:${report.targetAddress}:${report.category}:${report.createdAt.toISOString()}`)
    .digest('hex');

  const txHash = await anchorRegistryFlag({
    recordHash,
    category: report.category,
    timestamp: Math.floor(Date.now() / 1000),
  });

  await db('registry_reports').where({ id: reportId }).update({ anchor_tx_hash: txHash });

  await getQueue(QUEUE_NAMES.alertDispatch).add('registry-flag', {
    targetAddress: report.targetAddress,
    category: report.category,
    reportId: report.id,
  });

  log.info({ reportId, txHash }, 'confirmed flag propagated');
}
