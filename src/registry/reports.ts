import { db } from '../shared/db.js';
import { ValidationError, NotFoundError } from '../shared/errors.js';
import type { ReportStatus } from '../shared/types.js';

export type ReportCategory = 'phishing' | 'rug_pull' | 'honeypot' | 'impersonation' | 'other';

export interface FileReportInput {
  targetAddress: string;
  category: ReportCategory;
  evidence: Record<string, unknown>;
  reporterId?: string;
}

export interface RegistryReport {
  id: string;
  targetAddress: string;
  category: ReportCategory;
  status: ReportStatus;
  reporterId: string | null;
  endorsedBy: string | null;
  confirmedBy: string | null;
  anchorTxHash: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

function toReport(row: Record<string, unknown>): RegistryReport {
  return {
    id: row.id as string,
    targetAddress: row.target_address as string,
    category: row.category as ReportCategory,
    status: row.status as ReportStatus,
    reporterId: (row.reporter_id as string) ?? null,
    endorsedBy: (row.endorsed_by as string) ?? null,
    confirmedBy: (row.confirmed_by as string) ?? null,
    anchorTxHash: (row.anchor_tx_hash as string) ?? null,
    createdAt: row.created_at as Date,
    resolvedAt: (row.resolved_at as Date) ?? null,
  };
}

export async function fileReport(input: FileReportInput): Promise<RegistryReport> {
  if (!input.targetAddress) throw new ValidationError('targetAddress is required');

  const [row] = await db('registry_reports')
    .insert({
      target_address: input.targetAddress,
      category: input.category,
      evidence: JSON.stringify(input.evidence ?? {}),
      reporter_id: input.reporterId ?? null,
      status: 'pending',
    })
    .returning('*');

  return toReport(row);
}

export async function getReport(id: string): Promise<RegistryReport> {
  const row = await db('registry_reports').where({ id }).first();
  if (!row) throw new NotFoundError('Registry report');
  return toReport(row);
}

export async function listReportsForAddress(targetAddress: string): Promise<RegistryReport[]> {
  const rows = await db('registry_reports')
    .where({ target_address: targetAddress })
    .orderBy('created_at', 'desc');
  return rows.map(toReport);
}

export async function hasConfirmedReport(targetAddress: string): Promise<boolean> {
  const row = await db('registry_reports')
    .where({ target_address: targetAddress, status: 'confirmed' })
    .first();
  return Boolean(row);
}
