import { db } from '../shared/db.js';
import { ConflictError, NotFoundError, ValidationError } from '../shared/errors.js';
import { childLogger } from '../shared/logger.js';
import { getQueue, QUEUE_NAMES } from '../shared/queue.js';
import type { ClaimStatus } from '../shared/types.js';

const log = childLogger('safetynet:claims');

export interface FileClaimInput {
  projectId: string;
  victimAddress: string;
  amount: string;
  assetCode: string;
  evidenceHash: string;
}

export interface Claim {
  id: string;
  projectId: string;
  victimAddress: string;
  amount: string;
  assetCode: string;
  status: ClaimStatus;
  payoutTxHash: string | null;
  filedAt: Date;
  decidedAt: Date | null;
}

function toClaim(row: Record<string, unknown>): Claim {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    victimAddress: row.victim_address as string,
    amount: String(row.amount),
    assetCode: row.asset_code as string,
    status: row.status as ClaimStatus,
    payoutTxHash: (row.payout_tx_hash as string) ?? null,
    filedAt: row.filed_at as Date,
    decidedAt: (row.decided_at as Date) ?? null,
  };
}

export async function fileClaim(input: FileClaimInput): Promise<Claim> {
  if (Number(input.amount) <= 0) throw new ValidationError('amount must be positive');

  const [row] = await db('claims')
    .insert({
      project_id: input.projectId,
      victim_address: input.victimAddress,
      amount: input.amount,
      asset_code: input.assetCode,
      evidence_hash: input.evidenceHash,
      status: 'filed',
    })
    .returning('*');

  log.info({ claimId: row.id, projectId: input.projectId }, 'claim filed');

  await getQueue(QUEUE_NAMES.claimTracing).add('trace', { claimId: row.id });

  return toClaim(row);
}

export async function getClaim(id: string): Promise<Claim> {
  const row = await db('claims').where({ id }).first();
  if (!row) throw new NotFoundError('Claim');
  return toClaim(row);
}

export async function moveClaimToReview(id: string): Promise<Claim> {
  const claim = await getClaim(id);
  if (claim.status !== 'filed') throw new ConflictError(`Claim is ${claim.status}, expected filed`);

  const [row] = await db('claims').where({ id }).update({ status: 'in_review' }).returning('*');
  return toClaim(row);
}

export async function decideClaim(
  id: string,
  decision: Extract<ClaimStatus, 'approved' | 'rejected'>,
): Promise<Claim> {
  const claim = await getClaim(id);
  if (claim.status !== 'in_review') {
    throw new ConflictError(`Claim is ${claim.status}, expected in_review`);
  }

  const [row] = await db('claims')
    .where({ id })
    .update({ status: decision, decided_at: new Date() })
    .returning('*');

  log.info({ claimId: id, decision }, 'claim decided');
  return toClaim(row);
}

/** Payout requires M-of-N claims-committee multisig approval on-chain — recorded here once that tx confirms. */
export async function recordPayout(id: string, txHash: string): Promise<Claim> {
  const claim = await getClaim(id);
  if (claim.status !== 'approved') {
    throw new ConflictError(`Claim is ${claim.status}, expected approved`);
  }

  const [row] = await db('claims')
    .where({ id })
    .update({ status: 'paid', payout_tx_hash: txHash })
    .returning('*');

  return toClaim(row);
}
