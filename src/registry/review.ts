import { db } from '../shared/db.js';
import { ConflictError, NotFoundError } from '../shared/errors.js';
import { childLogger } from '../shared/logger.js';
import { getQueue, QUEUE_NAMES } from '../shared/queue.js';
import { getReport, type RegistryReport } from './reports.js';

const log = childLogger('registry:review');

/**
 * Two-person rule: one analyst endorses, a *different* analyst confirms. No single analyst can
 * take a report from pending straight to confirmed.
 */
export async function endorseReport(reportId: string, analystId: string): Promise<RegistryReport> {
  const report = await getReport(reportId);

  if (report.status !== 'pending') {
    throw new ConflictError(`Report is ${report.status}, expected pending`);
  }
  if (report.reporterId === analystId) {
    throw new ConflictError('Reporter cannot endorse their own report');
  }

  const [row] = await db('registry_reports')
    .where({ id: reportId })
    .update({ status: 'endorsed', endorsed_by: analystId })
    .returning('*');

  log.info({ reportId, analystId }, 'report endorsed');
  return rowToReport(row);
}

export async function confirmReport(reportId: string, analystId: string): Promise<RegistryReport> {
  const report = await getReport(reportId);

  if (report.status !== 'endorsed') {
    throw new ConflictError(`Report is ${report.status}, expected endorsed`);
  }
  if (report.endorsedBy === analystId) {
    throw new ConflictError('Confirming analyst must differ from the endorsing analyst');
  }
  if (report.reporterId === analystId) {
    throw new ConflictError('Reporter cannot confirm their own report');
  }

  const [row] = await db('registry_reports')
    .where({ id: reportId })
    .update({ status: 'confirmed', confirmed_by: analystId, resolved_at: new Date() })
    .returning('*');

  log.warn({ reportId, analystId }, 'report confirmed — propagating flag');

  await getQueue(QUEUE_NAMES.registryPropagation).add('propagate', { reportId });

  return rowToReport(row);
}

export async function rejectReport(reportId: string, analystId: string): Promise<RegistryReport> {
  const report = await getReport(reportId);

  if (report.status === 'confirmed') {
    throw new ConflictError('Cannot reject a confirmed report');
  }

  const [row] = await db('registry_reports')
    .where({ id: reportId })
    .update({ status: 'rejected', resolved_at: new Date() })
    .returning('*');

  log.info({ reportId, analystId }, 'report rejected');
  if (!row) throw new NotFoundError('Registry report');
  return rowToReport(row);
}

function rowToReport(row: Record<string, unknown>): RegistryReport {
  return {
    id: row.id as string,
    targetAddress: row.target_address as string,
    category: row.category as RegistryReport['category'],
    status: row.status as RegistryReport['status'],
    reporterId: (row.reporter_id as string) ?? null,
    endorsedBy: (row.endorsed_by as string) ?? null,
    confirmedBy: (row.confirmed_by as string) ?? null,
    anchorTxHash: (row.anchor_tx_hash as string) ?? null,
    createdAt: row.created_at as Date,
    resolvedAt: (row.resolved_at as Date) ?? null,
  };
}
