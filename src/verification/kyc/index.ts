import { db } from '../../shared/db.js';
import { config } from '../../shared/config.js';
import { NotFoundError } from '../../shared/errors.js';
import { childLogger } from '../../shared/logger.js';
import type { VerificationResult } from '../types.js';

const log = childLogger('verification:kyc');

export type KycStatus = 'pending' | 'verified' | 'rejected';

export interface KycSubmission {
  projectId: string;
  teamMemberName: string;
  documentRef: string; // pointer into encrypted storage, never the raw document
}

export interface KycRecord {
  id: string;
  projectId: string;
  teamMemberName: string;
  documentRef: string;
  status: KycStatus;
  decidedBy: string | null;
  submittedAt: Date;
  decidedAt: Date | null;
}

function toKycRecord(row: Record<string, unknown>): KycRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    teamMemberName: row.team_member_name as string,
    documentRef: row.document_ref as string,
    status: row.status as KycStatus,
    decidedBy: (row.decided_by as string) ?? null,
    submittedAt: row.submitted_at as Date,
    decidedAt: (row.decided_at as Date) ?? null,
  };
}

/**
 * Team identity verification. Two paths per ARCHITECTURE.md §6:
 *  1. Manual review by an analyst (default until a provider is wired up)
 *  2. A vetted third-party KYC provider (KYC_PROVIDER_API_KEY) so raw documents never touch our infra
 *
 * No provider has been selected yet, so every submission is persisted as 'pending' for manual
 * review via recordKycDecision — nothing here silently approves or rejects.
 */
export async function submitKyc(submission: KycSubmission): Promise<KycRecord> {
  const usingProvider = Boolean(config.kyc.providerApiKey);
  if (usingProvider) {
    // TODO: call the third-party provider once one is selected; do not log or persist raw
    // document contents here — only the provider's verdict + a reference ID.
    log.warn('KYC_PROVIDER_API_KEY set but no provider integration implemented yet');
  }

  const [row] = await db('kyc_submissions')
    .insert({
      project_id: submission.projectId,
      team_member_name: submission.teamMemberName,
      document_ref: submission.documentRef,
      status: 'pending',
    })
    .returning('*');

  log.info({ projectId: submission.projectId, submissionId: row.id }, 'KYC submission received');
  return toKycRecord(row);
}

export async function recordKycDecision(
  submissionId: string,
  status: Extract<KycStatus, 'verified' | 'rejected'>,
  decidedBy: string,
): Promise<KycRecord> {
  const [row] = await db('kyc_submissions')
    .where({ id: submissionId })
    .update({ status, decided_by: decidedBy, decided_at: new Date() })
    .returning('*');

  if (!row) throw new NotFoundError('KYC submission');

  log.info({ submissionId, status, decidedBy }, 'KYC decision recorded');
  return toKycRecord(row);
}

export async function latestKycRecord(projectId: string): Promise<KycRecord | null> {
  const row = await db('kyc_submissions')
    .where({ project_id: projectId })
    .orderBy('submitted_at', 'desc')
    .first();

  return row ? toKycRecord(row) : null;
}

export function kycRecordToVerificationResult(record: KycRecord | null): VerificationResult {
  if (!record) {
    return {
      check: 'kyc',
      outcome: 'inconclusive',
      details: 'No KYC submission on file for this project',
      checkedAt: new Date(),
    };
  }

  if (record.status === 'pending') {
    return {
      check: 'kyc',
      outcome: 'inconclusive',
      details: 'Pending manual analyst review',
      checkedAt: record.submittedAt,
    };
  }

  return {
    check: 'kyc',
    outcome: record.status === 'verified' ? 'pass' : 'fail',
    details: `Decided by ${record.decidedBy ?? 'unknown'}`,
    checkedAt: record.decidedAt ?? record.submittedAt,
  };
}
