import { db } from '../../shared/db.js';
import { config } from '../../shared/config.js';
import { NotFoundError } from '../../shared/errors.js';
import { childLogger } from '../../shared/logger.js';
import type { VerificationResult } from '../types.js';
import {
  createInquiry,
  pollInquiryUntilTerminal,
  parsePersonaWebhookPayload,
  verifyPersonaWebhookSignature,
  type PersonaVerdict,
} from './persona.js';

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
  /** 'persona:<inquiryId>' when decided by the provider; analyst email when manual */
  decidedBy: string | null;
  /** Provider-issued inquiry ID, populated when using Persona */
  providerInquiryId: string | null;
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
    providerInquiryId: (row.provider_inquiry_id as string) ?? null,
    submittedAt: row.submitted_at as Date,
    decidedAt: (row.decided_at as Date) ?? null,
  };
}

function verdictToKycStatus(verdict: PersonaVerdict): KycStatus {
  if (verdict === 'approved') return 'verified';
  if (verdict === 'declined') return 'rejected';
  // needs_review → fall back to manual analyst review
  return 'pending';
}

/**
 * Team identity verification.
 *
 * When KYC_PROVIDER_API_KEY (+ KYC_PROVIDER_TEMPLATE_ID) are configured, we submit the
 * documentRef to Persona and poll for an auto-verdict.  The provider never receives raw
 * documents through this module — it receives only the reference_id (our document pointer)
 * and we store only the provider verdict + their inquiry ID, never PII.
 *
 * Outcomes:
 *  - Persona approved  → status 'verified',  decidedBy 'persona:<inquiryId>'
 *  - Persona declined  → status 'rejected',  decidedBy 'persona:<inquiryId>'
 *  - Persona needs_review / timeout / provider unavailable
 *                      → status 'pending' (falls back to manual analyst via recordKycDecision)
 *  - No provider configured → status 'pending' (original manual-only flow)
 */
export async function submitKyc(submission: KycSubmission): Promise<KycRecord> {
  const { providerApiKey, providerTemplateId } = config.kyc;
  const usingProvider = Boolean(providerApiKey) && Boolean(providerTemplateId);

  // Insert as pending first so the record exists regardless of what the provider returns.
  const [row] = await db('kyc_submissions')
    .insert({
      project_id: submission.projectId,
      team_member_name: submission.teamMemberName,
      document_ref: submission.documentRef,
      status: 'pending',
      provider_inquiry_id: null,
    })
    .returning('*');

  const submissionId: string = row.id;
  log.info({ projectId: submission.projectId, submissionId }, 'KYC submission received');

  if (!usingProvider) {
    log.info(
      { submissionId },
      'No KYC provider configured — submission queued for manual analyst review',
    );
    return toKycRecord(row);
  }

  // ── Persona auto-verification ──────────────────────────────────────────────
  let inquiryId: string | null = null;
  try {
    inquiryId = await createInquiry(submission.documentRef, providerTemplateId);

    log.info({ submissionId, inquiryId }, 'Persona inquiry created — polling for verdict');

    const result = await pollInquiryUntilTerminal(inquiryId);

    if (!result) {
      // Polling timed out — record the inquiry ID so the webhook can still resolve it,
      // and leave the status as pending for manual fallback.
      await db('kyc_submissions')
        .where({ id: submissionId })
        .update({ provider_inquiry_id: inquiryId });

      log.warn(
        { submissionId, inquiryId },
        'Persona polling timed out — awaiting webhook or manual review',
      );

      return toKycRecord({ ...row, provider_inquiry_id: inquiryId });
    }

    const status = verdictToKycStatus(result.verdict);
    const decidedBy = status !== 'pending' ? `persona:${result.inquiryId}` : null;
    const decidedAt = result.completedAt ? new Date(result.completedAt) : new Date();

    const [updated] = await db('kyc_submissions')
      .where({ id: submissionId })
      .update({
        status,
        provider_inquiry_id: result.inquiryId,
        decided_by: decidedBy,
        decided_at: status !== 'pending' ? decidedAt : null,
      })
      .returning('*');

    log.info(
      { submissionId, inquiryId: result.inquiryId, verdict: result.verdict, status },
      'KYC auto-verdict applied',
    );

    return toKycRecord(updated);
  } catch (err) {
    // Provider error — degrade gracefully to manual review rather than blocking the submission.
    log.error(
      { err, submissionId, inquiryId },
      'Persona provider error — submission left as pending for manual review',
    );

    if (inquiryId) {
      // Persist the inquiry ID even on error so we can correlate an eventual webhook.
      await db('kyc_submissions')
        .where({ id: submissionId })
        .update({ provider_inquiry_id: inquiryId })
        .catch(() => undefined);
    }

    return toKycRecord({ ...row, provider_inquiry_id: inquiryId });
  }
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

/**
 * Handle an inbound Persona webhook event.
 *
 * Call this from the route handler after reading the raw request body.
 * Returns the updated KycRecord, or null if the event was not relevant
 * (non-inquiry event, already in a terminal state, unknown inquiry ID).
 *
 * Security: signature verification is performed here — do NOT call this
 * function unless you have the raw (pre-parsed) request body.
 */
export async function handlePersonaWebhook(
  rawBody: Buffer,
  signatureHeader: string,
): Promise<KycRecord | null> {
  const webhookSecret = config.kyc.providerWebhookSecret;
  if (!webhookSecret) {
    log.warn('KYC_PROVIDER_WEBHOOK_SECRET not set — rejecting inbound Persona webhook');
    return null;
  }

  const valid = verifyPersonaWebhookSignature(rawBody, signatureHeader, webhookSecret);
  if (!valid) {
    log.warn('Persona webhook signature verification failed');
    return null;
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
  } catch {
    log.warn('Failed to parse Persona webhook body as JSON');
    return null;
  }

  const result = parsePersonaWebhookPayload(body);
  if (!result) {
    log.debug('Persona webhook: non-inquiry event or unrecognised payload — ignoring');
    return null;
  }

  const { inquiryId, verdict, completedAt } = result;

  const existingRow = await db('kyc_submissions')
    .where({ provider_inquiry_id: inquiryId })
    .first();

  if (!existingRow) {
    log.warn({ inquiryId }, 'Persona webhook: no matching KYC submission found — ignoring');
    return null;
  }

  // Don't downgrade a terminal decision (e.g. a delayed webhook after manual override).
  if (existingRow.status === 'verified' || existingRow.status === 'rejected') {
    log.info(
      { inquiryId, currentStatus: existingRow.status },
      'Persona webhook: submission already in terminal state — skipping',
    );
    return toKycRecord(existingRow);
  }

  const newStatus = verdictToKycStatus(verdict);
  if (newStatus === 'pending') {
    // needs_review from webhook — leave as pending for analyst
    log.info(
      { inquiryId, verdict },
      'Persona webhook: verdict is needs_review — leaving for manual review',
    );
    return toKycRecord(existingRow);
  }

  const decidedAt = completedAt ? new Date(completedAt) : new Date();
  const [updated] = await db('kyc_submissions')
    .where({ id: existingRow.id })
    .update({
      status: newStatus,
      decided_by: `persona:${inquiryId}`,
      decided_at: decidedAt,
    })
    .returning('*');

  log.info(
    { submissionId: existingRow.id, inquiryId, verdict, status: newStatus },
    'KYC status updated via Persona webhook',
  );

  return toKycRecord(updated);
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
    const detail = record.providerInquiryId
      ? `Awaiting Persona result (inquiry ${record.providerInquiryId}) or manual analyst review`
      : 'Pending manual analyst review';
    return {
      check: 'kyc',
      outcome: 'inconclusive',
      details: detail,
      checkedAt: record.submittedAt,
    };
  }

  const via = record.decidedBy?.startsWith('persona:')
    ? 'automated provider verification'
    : `analyst: ${record.decidedBy ?? 'unknown'}`;

  return {
    check: 'kyc',
    outcome: record.status === 'verified' ? 'pass' : 'fail',
    details: `Decided via ${via}`,
    checkedAt: record.decidedAt ?? record.submittedAt,
  };
}
